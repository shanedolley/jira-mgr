import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, refuseNextBulk, releaseDone, releaseEdit } from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  // Twelve open Stories, "Bulk story 1" to "Bulk story 12" (PSAPAC-1000 to PSAPAC-1011), under one Epic.
  ;({ app, window } = await launch(stateDir, { JM_E2E_BULK: '12' }))
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: string | RegExp, exact = false) => tree().getByRole('treeitem', { name, exact })
const master = () => window.getByRole('checkbox', { name: 'Select all rows' })
const toggle = (name: string) => window.getByRole('button', { name, exact: true })
const bar = () => window.getByRole('toolbar', { name: 'Selected issues' })
const checkedRows = () => tree().locator('[role="treeitem"][aria-checked="true"]')
const selectedRows = () => tree().locator('[role="treeitem"][aria-selected="true"]')
const dash = () => master().evaluate((el: HTMLInputElement) => el.indeterminate)

/** The row of "Bulk story n", anchored: an Epic's row ends "N of M done". */
const story = (n: number) => item(new RegExp(`^PSAPAC-${String(999 + n)}, Story, `))
const check = (n: number) => story(n).locator('[data-check]').click()

/** Logs in and shows only the Bulk stories, with their Epic as context. */
async function openBulk() {
  await logIn(window)
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
  await window.getByLabel('Filter by key or summary').fill('Bulk story')
  await expect(story(1)).toBeVisible()
  await expect(story(12)).toBeVisible()
}

/** Logs in on the seeded Tree, whose Done phase has loaded. */
async function openSeeds() {
  await app.close()
  ;({ app, window } = await launch(stateDir))
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await releaseDone(app)
  await expect(window.getByText('Loading Done issues:')).toHaveCount(0)
}

test('the master shows once a row is checked, with a dash for some and a tick for all', async () => {
  await openBulk()
  await expect(master()).toHaveCount(0)

  await check(3)
  await expect(master()).toBeVisible()
  await expect(master()).not.toBeChecked()
  await expect.poll(dash).toBe(true)

  await master().click()
  // A mouse click hands focus back to the Tree, as the toggles do.
  await expect(tree()).toBeFocused()
  await expect(checkedRows()).toHaveCount(12)
  await expect(selectedRows()).toHaveCount(12)
  await expect(master()).toBeChecked()
  await expect.poll(dash).toBe(false)
  await expect(bar()).toContainText('12 selected')
  // The Epic shows only as context to the filter, so it stays unchecked.
  await expect(item(/^PSAPAC-900, Epic, /)).not.toHaveAttribute('aria-checked', /.*/)

  // One row unchecked: the dash is back.
  await check(5)
  await expect(checkedRows()).toHaveCount(11)
  await expect.poll(dash).toBe(true)
  await expect(master()).not.toBeChecked()
})

test('clicking the master with all rows checked clears them, and the master goes', async () => {
  await openBulk()
  await check(1)
  await master().click()
  await expect(master()).toBeChecked()

  await master().click()
  await expect(checkedRows()).toHaveCount(0)
  await expect(selectedRows()).toHaveCount(0)
  await expect(bar()).toHaveCount(0)
  await expect(master()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('the master sits left of Hide done on the same line, in a wide font too', async () => {
  await openBulk()
  const before = await toggle('Hide done').boundingBox()
  await check(1)
  await expect(master()).toBeVisible()
  // The master joins the line without pushing the toggles onto another.
  expect((await toggle('Hide done').boundingBox())?.y).toBe(before?.y)
  const same = async () => {
    const [m, d] = await Promise.all([master().boundingBox(), toggle('Hide done').boundingBox()])
    expect(m).not.toBeNull()
    expect(d).not.toBeNull()
    expect((m?.x ?? 0) + (m?.width ?? 0)).toBeLessThanOrEqual(d?.x ?? 0)
    expect(
      Math.abs((m?.y ?? 0) + (m?.height ?? 0) / 2 - ((d?.y ?? 0) + (d?.height ?? 0) / 2)),
    ).toBeLessThan(4)
  }
  await same()
  const style = await window.addStyleTag({
    content: '* { font-family: Verdana, sans-serif !important }',
  })
  await same()
  await style.evaluate((node) => {
    node.parentNode?.removeChild(node)
  })
})

test('Tab reaches the master, and Space checks all then clears', async () => {
  await openBulk()
  await check(2)
  await toggle('Hide done').focus()
  await window.keyboard.press('Shift+Tab')
  await expect(master()).toBeFocused()

  await window.keyboard.press('Space')
  await expect(checkedRows()).toHaveCount(12)
  await expect(master()).toBeChecked()
  // Space keeps focus on the box, so a second press can clear.
  await expect(master()).toBeFocused()
  await window.keyboard.press('Space')
  await expect(checkedRows()).toHaveCount(0)
  await expect(master()).toHaveCount(0)
})

test('a filter limits the master to the matches, and clearing the filter adds nothing', async () => {
  await openBulk()
  // "Bulk story 1" matches stories 1, 10, 11 and 12.
  await window.getByLabel('Filter by key or summary').fill('Bulk story 1')
  await expect(story(2)).toHaveCount(0)
  await check(1)
  await master().click()
  await expect(checkedRows()).toHaveCount(4)
  await expect(bar()).toContainText('4 selected')

  await window.getByLabel('Filter by key or summary').fill('Bulk story')
  await expect(story(2)).toBeVisible()
  await expect(story(2)).toHaveAttribute('aria-checked', 'false')
  await expect(checkedRows()).toHaveCount(4)
  await expect.poll(dash).toBe(true)
})

test('Hide done and a collapsed group keep their rows out of the master', async () => {
  await openSeeds()
  await item(/PSAPAC-3,/)
    .locator('[data-check]')
    .click()
  await expect(master()).toBeVisible()

  // A collapsed Customer hides its issues, so the master skips them.
  await item('Beta Ltd, 5 issues', true).click()
  await expect(item('Beta Ltd, 5 issues', true)).toHaveAttribute('aria-expanded', 'false')
  await master().click()
  const shown = await checkedRows().count()
  expect(shown).toBeGreaterThan(1)
  await expect(master()).toBeChecked()

  await item('Beta Ltd, 5 issues', true).click()
  await expect(item('Beta Ltd, 5 issues', true)).toHaveAttribute('aria-expanded', 'true')
  await expect(checkedRows()).toHaveCount(shown)
  await expect.poll(dash).toBe(true)
  await master().click()
  const afterExpand = await checkedRows().count()
  expect(afterExpand).toBeGreaterThan(shown)
  await expect(master()).toBeChecked()

  // Hide done off brings the Done chips back, and the Done issues behind them stay unchecked.
  await toggle('Hide done').click()
  await expect(item('2 done', true)).toBeVisible()
  await expect(checkedRows()).toHaveCount(afterExpand)
  await item('2 done', true).click()
  await expect(item(/PSAPAC-14,/)).toBeVisible()
  await expect(item(/PSAPAC-14,/)).toHaveAttribute('aria-checked', 'false')
  await expect(checkedRows()).toHaveCount(afterExpand)
  await expect.poll(dash).toBe(true)
})

test('the master writes nothing to Jira', async () => {
  await openBulk()
  await check(1)
  await master().click()
  await master().click()
  const sent = await counts(app)
  expect(sent.edits).toBe(0)
  expect(sent.bulk).toHaveLength(0)
})

test('the master is disabled while a batch runs', async () => {
  await openBulk()
  await check(1)
  await master().click()
  await refuseNextBulk(app)
  await bar().getByRole('button', { name: 'Status' }).click()
  await window.getByRole('option', { name: 'In Progress' }).click()
  await expect(bar()).toContainText('Updating 0 of 12')
  await expect(master()).toBeDisabled()
  for (let settled = 1; settled <= 12; settled++) {
    await expect.poll(async () => (await counts(app)).edits).toBeGreaterThanOrEqual(settled)
    await releaseEdit(app)
  }
  await expect(bar()).not.toContainText('Updating')
})
