import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { joinSprint, launch, logIn, logWork, readState, showEverything } from './harness.js'

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

const TIME = ['estimate', 'logged', 'remaining', 'remainingPercent'] as const
const CHIPS = ['Original estimate', 'Logged', 'Remaining', 'Remaining %']

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const prop = (key: RegExp, name: string) => item(key).locator(`[data-prop=${name}]`)
const displayButton = () => window.getByRole('button', { name: 'Display', exact: true })
const chip = (name: string) =>
  window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name, exact: true })
const sidebar = () => window.getByRole('navigation', { name: 'Main' })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const sprintRow = (key: string) => sprintPage().locator(`[data-issue-key=${key}]`)

/** PSAPAC-4 (2h estimate) and PSAPAC-3 (none) join the active sprint. */
const MEMBERS = ['PSAPAC-3', 'PSAPAC-4', 'PSAPAC-13']

async function open() {
  await joinSprint(app, MEMBERS, 5)
  // PSAPAC-4: 30m of its 2h. PSAPAC-3 has no estimate and 1h logged.
  await logWork(app, 'PSAPAC-4', daysAgo(1), 0.5 * HOUR)
  await logWork(app, 'PSAPAC-3', daysAgo(1), HOUR)
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
}

/** Opens the Display menu, presses each chip, and closes the menu. */
async function toggle(...names: string[]) {
  await displayButton().click()
  await expect(chip('Logged')).toBeVisible()
  for (const name of names) await chip(name).click()
  await window.keyboard.press('Escape')
  await expect(chip('Logged')).toBeHidden()
}

const savedProperties = async () =>
  (await readState<{ display?: { properties: string[] } }>(stateDir, 'settings.json'))?.display
    ?.properties

test('lists the four chips, shows their slots in the Tree and hides them again', async () => {
  await open()
  for (const name of TIME) await expect(prop(/PSAPAC-4,/, name)).toHaveCount(0)

  await displayButton().click()
  for (const name of CHIPS) await expect(chip(name)).toHaveAttribute('aria-pressed', 'false')
  await window.keyboard.press('Escape')
  await toggle(...CHIPS)
  await expect.poll(savedProperties).toEqual([...TIME, 'updated'])

  // 2h estimate, 30m logged; the fake leaves the remaining estimate at the estimate.
  await expect(prop(/PSAPAC-4,/, 'estimate')).toContainText('2h')
  await expect(prop(/PSAPAC-4,/, 'logged')).toContainText('30m')
  await expect(prop(/PSAPAC-4,/, 'remaining')).toContainText('2h')
  await expect(prop(/PSAPAC-4,/, 'remainingPercent')).toContainText('75%')
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(
    /, original estimate 2h, logged 30m, remaining 2h, remaining percent 75%$/,
  )

  // No estimate: the slots keep their place, empty where Jira holds nothing.
  await expect(prop(/PSAPAC-3,/, 'logged')).toContainText('1h')
  for (const name of ['estimate', 'remaining', 'remainingPercent']) {
    await expect(prop(/PSAPAC-3,/, name)).toHaveText('')
  }
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/, logged 1h$/)

  // An Epic and a Customer header show none of the four.
  for (const name of TIME) await expect(prop(/PSAPAC-10,/, name)).toHaveText('')
  await expect(item(/PSAPAC-10,/)).not.toHaveAccessibleName(/estimate|logged|remaining/)
  await expect(tree().locator('[role=treeitem][aria-level="1"]').first()).not.toHaveAccessibleName(
    /estimate|logged|remaining/,
  )

  await toggle(...CHIPS)
  for (const name of TIME) await expect(prop(/PSAPAC-4,/, name)).toHaveCount(0)
  await expect.poll(savedProperties).toEqual(['updated'])
})

test('floors Remaining % at 0% once more is logged than estimated', async () => {
  // With the 30m `open` logs, PSAPAC-4 holds 2h 30m against its 2h estimate.
  await logWork(app, 'PSAPAC-4', daysAgo(2), 2 * HOUR)
  await open()
  await toggle('Logged', 'Remaining %')
  await expect(prop(/PSAPAC-4,/, 'logged')).toContainText('2h 30m')
  await expect(prop(/PSAPAC-4,/, 'remainingPercent')).toContainText('0%')
})

test('shows the chosen slots on the Sprint page and follows the Display menu', async () => {
  await open()
  await toggle('Original estimate', 'Logged', 'Remaining %')

  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
  const row = sprintRow('PSAPAC-4')
  await expect(row.locator('[data-prop=estimate]')).toHaveText('Original estimate 2h')
  await expect(row.locator('[data-prop=remainingPercent]')).toHaveText('Remaining percent 75%')
  await expect(row.locator('[data-prop=logged]')).toContainText('30m')
  await expect(row.locator('[data-prop=remainingPercent]')).toContainText('75%')
  await expect(row.locator('[data-prop=remaining]')).toHaveCount(0)
  // No estimate: empty slots, so the columns line up.
  await expect(sprintRow('PSAPAC-3').locator('[data-prop=estimate]')).toHaveText('')
  await expect(sprintRow('PSAPAC-3').locator('[data-prop=logged]')).toContainText('1h')

  await sprintPage().getByRole('button', { name: 'Back to issues' }).click()
  await expect(sprintPage()).toHaveCount(0)
  await toggle('Original estimate', 'Logged', 'Remaining %')
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintRow('PSAPAC-4')).toBeVisible()
  for (const name of TIME)
    await expect(sprintRow('PSAPAC-4').locator(`[data-prop=${name}]`)).toHaveCount(0)
})

test('fits the four slots beside Due date and Updated in a wide font, in the Tree and on the Sprint page', async () => {
  await open()
  await toggle('Due date', ...CHIPS)
  await expect(prop(/PSAPAC-4,/, 'estimate')).toContainText('2h')
  const style = await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  const slots =
    '[data-prop=estimate], [data-prop=logged], [data-prop=remaining], [data-prop=remainingPercent]'
  /** The widest value each slot takes, set by hand, must stay inside its cell. */
  const measure = (scope: Element) =>
    [...scope.querySelectorAll<HTMLElement>('[data-prop]')]
      .filter((cell) =>
        ['estimate', 'logged', 'remaining', 'remainingPercent'].includes(cell.dataset.prop ?? ''),
      )
      .map((cell) => {
        cell.textContent = cell.dataset.prop === 'remainingPercent' ? '100%' : '999h 59m'
        return cell.scrollWidth <= cell.clientWidth
      })
  const inTree = await item(/PSAPAC-4,/).evaluate(measure)
  const rowOverflow = await tree()
    .getByRole('treeitem')
    .evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth).length)
  expect(inTree).toEqual([true, true, true, true])
  expect(rowOverflow).toBe(0)

  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintRow('PSAPAC-4')).toBeVisible()
  const onSprint = await sprintRow('PSAPAC-4').evaluate(measure)
  expect(onSprint).toEqual([true, true, true, true])
  const sprintOverflow = await sprintPage()
    .locator('[data-row]')
    .evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth).length)
  expect(sprintOverflow).toBe(0)
  await style.evaluate((node) => {
    node.parentNode?.removeChild(node)
  })
  await expect(sprintRow('PSAPAC-4').locator(slots)).toHaveCount(4)
})

test('keeps the title and the avatar with all nine properties on, dropping the trailing slots', async () => {
  await open()
  await toggle('Labels', 'Sprint', 'Created', 'Due date', ...CHIPS)
  await expect(prop(/PSAPAC-4,/, 'estimate')).toContainText('2h')
  const style = await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  const rows = await tree()
    .getByRole('treeitem')
    .evaluateAll((all) =>
      all
        .filter((row) => row.querySelector('.tree-key') !== null)
        .map((row) => {
          const box = row.getBoundingClientRect()
          const avatar = row.querySelector('[data-pick=assignee]')?.getBoundingClientRect()
          return {
            title:
              row.querySelector('.tree-key')?.nextElementSibling?.getBoundingClientRect().width ??
              0,
            overflowing: row.scrollWidth > row.clientWidth,
            avatarShown:
              avatar !== undefined && avatar.right <= box.right && avatar.left >= box.left,
          }
        }),
    )
  await style.evaluate((node) => {
    node.parentNode?.removeChild(node)
  })
  expect(rows.length).toBeGreaterThan(5)
  expect(rows.filter((r) => r.title < 80)).toEqual([])
  expect(rows.filter((r) => r.overflowing)).toEqual([])
  expect(rows.filter((r) => !r.avatarShown)).toEqual([])
})
