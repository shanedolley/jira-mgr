import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  joinSprint,
  launch,
  logIn,
  logWork,
  refuseNextEdit,
  releaseEdit,
  showEverything,
} from './harness.js'

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

const HOUR = 3600
const DAY_MS = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString()

const MEMBERS = ['PSAPAC-3', 'PSAPAC-4', 'PSAPAC-13']

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const prop = (key: RegExp, name: string) => item(key).locator(`[data-prop=${name}]`)
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const sprintRow = (key: string) => sprintPage().locator(`[data-issue-key=${key}]`)
const modal = (key: string) => window.getByRole('dialog', { name: `Log work on ${key}` })
const form = (key: string) => modal(key).getByRole('form', { name: 'Log work' })
const slot = (key: RegExp) => item(key).getByRole('button', { name: /^Log work on / })

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1)

/** PSAPAC-4 (2h estimate) holds 30m of it. The Logged, Remaining and Remaining % slots are on. */
async function open() {
  await joinSprint(app, MEMBERS, 5)
  await logWork(app, 'PSAPAC-4', daysAgo(1), 0.5 * HOUR)
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
  await window.getByRole('button', { name: 'Display', exact: true }).click()
  const chips = window.getByRole('group', { name: 'Display properties', exact: true })
  for (const name of ['Logged', 'Remaining', 'Remaining %']) {
    await chips.getByRole('button', { name, exact: true }).click()
  }
  await window.keyboard.press('Escape')
  await expect(prop(/PSAPAC-4,/, 'logged')).toHaveText('Logged 30m')
}

async function openSprint() {
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
}

/** Whether focus sits inside the element, which a restored focus does. */
const holdsFocus = (scope: () => ReturnType<typeof tree>) =>
  scope().evaluate((el) => el.contains(document.activeElement))

test('a click on the Logged slot opens the modal, not the Peek, and a save updates the row', async () => {
  await open()
  await prop(/PSAPAC-4,/, 'logged').click()

  await expect(modal('PSAPAC-4')).toBeVisible()
  await expect(peek()).toHaveCount(0)
  await expect(issuePage()).toHaveCount(0)
  await expect(form('PSAPAC-4').getByLabel('Time spent')).toBeFocused()

  await form('PSAPAC-4').getByLabel('Time spent').fill('1h')
  await form('PSAPAC-4').getByLabel('Comment').fill('Wired it up')
  await form('PSAPAC-4').getByLabel('Time spent').press('Enter')

  await expect.poll(writes).toBe(1)
  expect(await lastBody()).toMatchObject({
    worklog: 'add',
    key: 'PSAPAC-4',
    adjustEstimate: 'auto',
    timeSpent: '1h',
  })
  await releaseEdit(app)

  await expect(modal('PSAPAC-4')).toHaveCount(0)
  // 1h 30m of 2h is 75% used; Jira lowered the remaining estimate by the hour.
  await expect(prop(/PSAPAC-4,/, 'logged')).toHaveText('Logged 1h 30m')
  await expect(prop(/PSAPAC-4,/, 'remaining')).toHaveText('Remaining 1h')
  await expect(prop(/PSAPAC-4,/, 'remainingPercent')).toHaveText('Remaining percent 25%')
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')
  await expect(tree()).toBeFocused()
  await expect(peek()).toHaveCount(0)
})

test('an empty Logged slot opens the modal too', async () => {
  await open()
  await expect(prop(/PSAPAC-13,/, 'logged')).toHaveText('')
  await prop(/PSAPAC-13,/, 'logged').click()
  await expect(modal('PSAPAC-13')).toBeVisible()
})

test('an Epic offers no target, and W does nothing on it', async () => {
  await open()
  await expect(slot(/PSAPAC-10,/)).toHaveCount(0)
  await prop(/PSAPAC-10,/, 'logged').click({ force: true })
  await window.keyboard.press('w')
  await expect(window.getByRole('dialog', { name: /^Log work on / })).toHaveCount(0)
})

test('the Logged slot is a button named for the issue', async () => {
  await open()
  await expect(slot(/PSAPAC-4,/)).toHaveAccessibleName('Log work on PSAPAC-4')
})

test('Esc and Cancel close the modal with no write and return focus to the Tree', async () => {
  await open()
  await prop(/PSAPAC-4,/, 'logged').click()
  await form('PSAPAC-4').getByLabel('Time spent').fill('1h')
  await window.keyboard.press('Escape')
  await expect(modal('PSAPAC-4')).toHaveCount(0)
  await expect(tree()).toBeFocused()

  await prop(/PSAPAC-4,/, 'logged').click()
  await form('PSAPAC-4').getByRole('button', { name: 'Cancel' }).click()
  await expect(modal('PSAPAC-4')).toHaveCount(0)
  await expect(tree()).toBeFocused()
  expect(await writes()).toBe(0)
  await expect(prop(/PSAPAC-4,/, 'logged')).toHaveText('Logged 30m')
})

test('keeps the modal open with the text and the error when Jira refuses', async () => {
  await open()
  await refuseNextEdit(app)
  await prop(/PSAPAC-4,/, 'logged').click()
  await form('PSAPAC-4').getByLabel('Time spent').fill('1h')
  await form('PSAPAC-4').getByLabel('Comment').fill('Refused')
  await form('PSAPAC-4').getByRole('button', { name: 'Log work' }).click()

  await expect.poll(writes).toBe(1)
  await releaseEdit(app)
  await expect(form('PSAPAC-4').getByRole('alert')).toContainText('Could not save the worklog.')
  await expect(form('PSAPAC-4').getByLabel('Time spent')).toHaveValue('1h')
  await expect(form('PSAPAC-4').getByLabel('Comment')).toHaveValue('Refused')
  await expect(prop(/PSAPAC-4,/, 'logged')).toHaveText('Logged 30m')
})

test('W, the context menu and the palette open the same modal', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await expect(peek()).toBeVisible()

  await window.keyboard.press('w')
  await expect(modal('PSAPAC-4')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(modal('PSAPAC-4')).toHaveCount(0)

  await item(/PSAPAC-4,/).click({ button: 'right' })
  const entry = window.getByRole('menu').getByRole('menuitem', { name: 'Log work', exact: true })
  await expect(entry).toHaveAttribute('aria-keyshortcuts', 'W')
  await entry.click()
  await expect(modal('PSAPAC-4')).toBeVisible()
  await expect(issuePage()).toHaveCount(0)
  await window.keyboard.press('Escape')
  await expect(modal('PSAPAC-4')).toHaveCount(0)

  await window.keyboard.press('ControlOrMeta+k')
  const palette = window.getByRole('dialog', { name: 'Search issues' })
  await palette.getByRole('combobox').fill('log work')
  await palette.getByRole('option', { name: /^Log work/ }).click()
  await expect(modal('PSAPAC-4')).toBeVisible()
  await expect(form('PSAPAC-4').getByLabel('Time spent')).toBeFocused()
})

test('the Sprint page offers the same target, without opening the issue', async () => {
  await open()
  await openSprint()
  await sprintRow('PSAPAC-4').locator('[data-prop=logged]').click()

  await expect(modal('PSAPAC-4')).toBeVisible()
  await expect(issuePage()).toHaveCount(0)
  await form('PSAPAC-4').getByLabel('Time spent').fill('30m')
  await form('PSAPAC-4').getByLabel('Time spent').press('Enter')
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)

  await expect(modal('PSAPAC-4')).toHaveCount(0)
  await expect(sprintRow('PSAPAC-4').locator('[data-prop=logged]')).toHaveText('Logged 1h')
  await expect.poll(() => holdsFocus(sprintPage)).toBe(true)
})

test('lays the modal out inside the window in a wide font', async () => {
  await open()
  await prop(/PSAPAC-4,/, 'logged').click()
  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  const box = await modal('PSAPAC-4').evaluate((el) => {
    const { left, right } = el.getBoundingClientRect()
    return { overflow: el.scrollWidth - el.clientWidth, inside: left >= 0 && right <= innerWidth }
  })
  expect(box).toEqual({ overflow: 0, inside: true })
  await expect(form('PSAPAC-4').getByRole('button', { name: 'Cancel' })).toBeInViewport()
})
