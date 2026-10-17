import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { joinSprint, launch, logIn, moveIssue, setEstimate, showEverything } from './harness.js'

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

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const sidebar = () => window.getByRole('navigation', { name: 'Main' })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const epicsPage = () => window.getByRole('region', { name: 'Epics' })
const palette = () => window.getByRole('dialog', { name: 'Search issues' })

/** The opacity a field is drawn at: the product of its own and every ancestor's. */
const effective = (locator: Locator) =>
  locator.evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return Math.round(opacity * 100) / 100
  })

/** Waits for every locator to draw at `opacity`. */
async function expectDrawnAt(opacity: number, ...fields: Locator[]) {
  for (const field of fields) {
    await expect(field).toBeVisible()
    await expect.poll(() => effective(field)).toBe(opacity)
  }
}

/** Opens the Tree with the Labels and Original estimate slots on. */
async function open() {
  // PSAPAC-11 holds a label, the Tree's one progress pill (a Subtask) and Other User's initials.
  await setEstimate(app, 'PSAPAC-11', 2 * 3600)
  await setEstimate(app, 'PSAPAC-2', 2 * 3600)
  await joinSprint(app, ['PSAPAC-2', 'PSAPAC-11'], 5)
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
  await window.getByRole('button', { name: 'Display', exact: true }).click()
  const chips = window.getByRole('group', { name: 'Display properties', exact: true })
  for (const name of ['Labels', 'Original estimate']) {
    await chips.getByRole('button', { name, exact: true }).click()
  }
  await window.keyboard.press('Escape')
}

test('fades every field of a Hold row in the Tree to 30% and no other row', async () => {
  await moveIssue(app, 'PSAPAC-11', 'hold')
  await open()

  const row = item(/PSAPAC-11,/)
  // The row's own surface (focus ring, selection, hover) is never faded.
  await expect(row).toHaveCSS('opacity', '1')
  await expectDrawnAt(
    0.3,
    row.locator('[data-glyph="status"]'),
    row.locator('.tree-key'),
    row.locator('span.truncate.font-medium'),
    row.locator('[data-slot="priority"]'),
    row.locator('[data-prop="labels"]'),
    row.locator('[data-prop="estimate"]'),
    row.locator('[data-progress]'),
    row.locator('[data-avatar]'),
  )
  // The status ring is faded once, by itself: 30%, not 9%.
  await expect(row.locator('[data-glyph="status"]')).toHaveCSS('opacity', '1')

  const other = item(/PSAPAC-2,/)
  await expectDrawnAt(
    1,
    other.locator('[data-glyph="status"]'),
    other.locator('.tree-key'),
    other.locator('span.truncate.font-medium'),
    other.locator('[data-prop="estimate"]'),
    other.locator('[data-avatar]'),
  )
})

test('fades every field of a Hold row on the Sprint page to 30% and no other row', async () => {
  await moveIssue(app, 'PSAPAC-11', 'hold')
  await open()
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()

  const row = sprintPage().locator('[data-issue-key=PSAPAC-11]')
  await expect(row).toHaveCSS('opacity', '1')
  await expectDrawnAt(
    0.3,
    row.getByText('PSAPAC-11', { exact: true }),
    row.getByText('Draft the runbook'),
    row.locator('[data-prop="labels"]'),
    row.locator('[data-prop="estimate"]'),
    row.locator('[data-avatar]'),
  )
  // The group heading's ring is outside the row, at its own 30%.
  await expectDrawnAt(0.3, sprintPage().getByRole('region', { name: 'Hold' }).locator('svg'))

  const other = sprintPage().locator('[data-issue-key=PSAPAC-2]')
  await expectDrawnAt(
    1,
    other.getByText('PSAPAC-2', { exact: true }),
    other.getByText('Review the data model'),
    other.locator('[data-prop="estimate"]'),
    other.locator('[data-avatar]'),
  )
})

test('fades every cell of a Hold Epic on the Epics page to 30% and no other row', async () => {
  await moveIssue(app, 'PSAPAC-10', 'hold')
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await sidebar().getByRole('link', { name: 'Epics', exact: true }).click()
  await expect(epicsPage()).toBeVisible()

  const row = epicsPage().locator('tr', { has: window.locator('[data-overview-key="PSAPAC-10"]') })
  await expect(row).toHaveCSS('opacity', '1')
  const cells = row.locator('th, td')
  expect(await cells.count()).toBe(8)
  // The first cell holds the row's focus control, so its content fades inside the button instead.
  await expectDrawnAt(1, cells.nth(0))
  for (let i = 1; i < 8; i++) await expectDrawnAt(0.3, cells.nth(i))
  await expectDrawnAt(
    0.3,
    row.getByText('PSAPAC-10', { exact: true }),
    row.getByText('Customer onboarding'),
    row.locator('[data-glyph="status"]'),
  )

  // Reached by the keyboard, the button's outline stays at full strength while its text is faded.
  const button = row.locator('[data-overview-key]')
  await epicsPage().locator('[data-overview-key="PSAPAC-30"]').focus()
  for (
    let step = 0;
    step < 4 && !(await button.evaluate((el) => el === document.activeElement));
    step++
  ) {
    await window.keyboard.press('ArrowDown')
  }
  await expect(button).toBeFocused()
  expect(await button.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
  await expect(button).toHaveCSS('outline-style', 'solid')
  await expectDrawnAt(1, button)
  await expectDrawnAt(
    0.3,
    row.getByText('PSAPAC-10', { exact: true }),
    row.getByText('Customer onboarding'),
  )

  const other = epicsPage().locator('tr', {
    has: window.locator('[data-overview-key="PSAPAC-30"]'),
  })
  const otherCells = other.locator('th, td')
  for (let i = 0; i < 8; i++) await expectDrawnAt(1, otherCells.nth(i))
})

test('fades every field of a Hold row in the palette to 30% and no other row', async () => {
  await moveIssue(app, 'PSAPAC-11', 'hold')
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await window.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  await palette().getByRole('combobox').fill('PSAPAC-1')

  const row = palette().getByRole('option').filter({ hasText: 'Draft the runbook' })
  await expect(row).toHaveCSS('opacity', '1')
  await expectDrawnAt(
    0.3,
    row.locator('[data-glyph="status"]'),
    row.getByText('PSAPAC-11', { exact: true }),
    row.getByText('Draft the runbook'),
    row.getByText('Hold', { exact: true }),
  )

  const other = palette().getByRole('option').filter({ hasText: 'Outline the sections' })
  await expectDrawnAt(
    1,
    other.locator('[data-glyph="status"]'),
    other.getByText('PSAPAC-12', { exact: true }),
    other.getByText('Outline the sections'),
  )
})
