import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { joinSprint, launch, logIn, readState, showEverything } from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  ;({ app, window } = await launch(stateDir, { TZ: 'Etc/UTC' }))
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

interface Display {
  properties: string[]
  priority?: boolean
}

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const slot = (row: RegExp) => item(row).locator('[data-pick=priority]')
const summary = (row: RegExp) => item(row).locator('[data-summary]')
const header = () => window.getByRole('group', { name: 'Column widths' })
const displayButton = () => window.getByRole('button', { name: 'Display', exact: true })
const chip = (name: string) =>
  window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name, exact: true })
const view = (name: string) =>
  window.getByRole('list', { name: 'Saved views' }).getByRole('button', { name, exact: true })
const update = (name: string) =>
  window.getByRole('button', { name: `Update view ${name}`, exact: true })
const sidebar = () => window.getByRole('navigation', { name: 'Main' })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const sprintSlot = (key: string) =>
  sprintPage().getByRole('button', { name: new RegExp(`^Priority of ${key}:`) })

const savedDisplay = async () =>
  (await readState<{ display?: Display }>(stateDir, 'settings.json'))?.display
const savedViews = async () =>
  (await readState<{ id: string; name: string; display?: Display }[]>(stateDir, 'views.json')) ?? []

const ROW = /PSAPAC-11,/
const MEMBERS = [
  'PSAPAC-1',
  'PSAPAC-2',
  'PSAPAC-4',
  'PSAPAC-11',
  'PSAPAC-13',
  'PSAPAC-14',
  'PSAPAC-22',
]

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
}

/** Clicks the Priority chip and closes the menu. */
async function togglePriority() {
  await displayButton().click()
  await expect(chip('Updated')).toBeVisible()
  await chip('Priority').click()
  await window.keyboard.press('Escape')
  await expect(chip('Updated')).toBeHidden()
}

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('not on screen')
  return box
}

test('the Priority chip is on by default and hides and restores the Tree slot in place', async () => {
  await open()
  await displayButton().click()
  await expect(chip('Priority')).toHaveAttribute('aria-pressed', 'true')
  await window.keyboard.press('Escape')
  await expect(slot(ROW)).toBeVisible()
  const titleOn = (await boxOf(summary(ROW))).width
  const headerOn = await boxOf(header().locator('[data-col=updated]'))
  const cellOn = await boxOf(item(ROW).locator('[data-prop=updated]'))

  await togglePriority()
  await expect(slot(ROW)).toHaveCount(0)
  await expect(slot(/PSAPAC-10,/)).toHaveCount(0)
  await expect.poll(async () => (await savedDisplay())?.priority).toBe(false)
  // The title gains the slot's 16px and its gap, and the header still sits over its column.
  await expect
    .poll(async () => (await boxOf(summary(ROW))).width)
    .toBeGreaterThanOrEqual(titleOn + 16)
  const headerOff = await boxOf(header().locator('[data-col=updated]'))
  const cellOff = await boxOf(item(ROW).locator('[data-prop=updated]'))
  expect(Math.abs(headerOff.x - cellOff.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(headerOff.x - headerOn.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(cellOff.x - cellOn.x)).toBeLessThanOrEqual(1)

  await togglePriority()
  await expect(slot(ROW)).toBeVisible()
  await expect.poll(async () => (await boxOf(summary(ROW))).width).toBeCloseTo(titleOn, 0)
  await expect.poll(async () => (await savedDisplay())?.priority).toBe(true)
})

test('with Priority off, Shift+click still checks a range and P still opens the list', async () => {
  await open()
  await togglePriority()
  await item(/PSAPAC-4,/).click()
  await window.keyboard.press('Escape')
  await item(/PSAPAC-3,/).click({ modifiers: ['Shift'] })
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('aria-checked', 'true')

  await window.keyboard.press('Escape')
  await item(/PSAPAC-3,/).click()
  await window.keyboard.press('Escape')
  await window.keyboard.press('p')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeFocused()
})

test('the Sprint page hides its priority slot with the Tree and brings it back', async () => {
  await joinSprint(app, MEMBERS, 5)
  await open()
  await togglePriority()
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
  await expect(sprintPage().getByRole('status')).toHaveText('7 issues')
  await expect(sprintSlot('PSAPAC-4')).toHaveCount(0)
  await expect(sprintPage().locator('li[data-issue-key=PSAPAC-4]')).toBeVisible()

  await sprintPage().getByRole('button', { name: 'Back to issues' }).click()
  await togglePriority()
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintSlot('PSAPAC-4')).toBeVisible()
})

test('a saved view carries Priority: applying restores it and Update view saves it', async () => {
  await open()
  await togglePriority()
  await window.getByRole('button', { name: 'New view' }).click()
  await window.getByLabel('New view name').fill('Quiet')
  await window.keyboard.press('Enter')
  await expect(view('Quiet')).toHaveAttribute('aria-current', 'true')
  await expect
    .poll(async () => (await savedViews()).find((v) => v.name === 'Quiet')?.display?.priority)
    .toBe(false)

  // Turning it on differs from the view, which wakes Update view.
  await expect(update('Quiet')).toBeDisabled()
  await togglePriority()
  await expect(slot(ROW)).toBeVisible()
  await expect(update('Quiet')).toBeEnabled()

  // Applying the view puts Priority back off.
  await view('My issues').click()
  await view('Quiet').click()
  await expect(slot(ROW)).toHaveCount(0)
  await expect.poll(async () => (await savedDisplay())?.priority).toBe(false)
  await expect(update('Quiet')).toBeDisabled()

  // Update view saves the current setting.
  await togglePriority()
  await expect(update('Quiet')).toBeEnabled()
  await update('Quiet').click()
  await expect(update('Quiet')).toBeDisabled()
  await expect
    .poll(async () => (await savedViews()).find((v) => v.name === 'Quiet')?.display?.priority)
    .toBe(true)
})
