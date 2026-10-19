import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, joinSprint, launch, logIn, notices } from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  // Twelve open Stories, "Bulk story 1" to "Bulk story 12" (PSAPAC-1000 to PSAPAC-1011), under one Epic.
  ;({ app, window } = await launch(stateDir, { JM_E2E_BULK: '12', TZ: 'Etc/UTC' }))
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

/** The key that toggles on this machine: Cmd on macOS, Ctrl elsewhere. */
const TOGGLE = 'ControlOrMeta'

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: string | RegExp) => tree().getByRole('treeitem', { name })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const bar = () => window.getByRole('toolbar', { name: 'Selected issues' })
const checkedRows = () => tree().locator('[role="treeitem"][aria-checked="true"]')
const menu = () => window.getByRole('menu')
const dialog = (name: string) => window.getByRole('dialog', { name })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const sidebar = () => window.getByRole('navigation', { name: 'Main' })

/** The row of "Bulk story n", anchored: an Epic's row ends "N of M done". */
const story = (n: number) => item(new RegExp(`^PSAPAC-${String(999 + n)}, Story, `))
const keyOf = (n: number) => `PSAPAC-${String(999 + n)}`

async function openBulk() {
  await logIn(window)
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
  await window.getByLabel('Filter by key or summary').fill('Bulk story')
  await expect(story(1)).toBeVisible()
  await expect(story(12)).toBeVisible()
}

/** The keys of the Tree's checked rows. */
const checkedKeys = () =>
  checkedRows().evaluateAll((rows) =>
    rows.map((r) => /^PSAPAC-\d+/.exec(r.getAttribute('aria-label') ?? '')?.[0] ?? '').sort(),
  )

const selectedText = () => window.evaluate(() => globalThis.getSelection()?.toString() ?? '')

test.describe('on the Tree', () => {
  test.beforeEach(async () => {
    await openBulk()
  })

  test('a Cmd+click on the summary, status dot, avatar and blank space toggles the issue and opens nothing', async () => {
    // The summary: a plain click here would open the Edit summary modal.
    await story(1)
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    await expect(story(1)).toHaveAttribute('aria-checked', 'true')
    await expect(dialog('Edit summary')).toHaveCount(0)
    await expect(peek()).toHaveCount(0)

    // The status dot and the avatar: a plain click would open a cell editor.
    await story(2)
      .locator('[data-pick=status]')
      .click({ modifiers: [TOGGLE] })
    await story(3)
      .locator('[data-pick=assignee]')
      .click({ modifiers: [TOGGLE] })
    await expect(story(2)).toHaveAttribute('aria-checked', 'true')
    await expect(story(3)).toHaveAttribute('aria-checked', 'true')
    await expect(window.locator('.menu:popover-open')).toHaveCount(0)

    // Blank row space opens no page.
    await story(4).click({ modifiers: [TOGGLE], position: { x: 300, y: 16 } })
    await expect(story(4)).toHaveAttribute('aria-checked', 'true')
    await expect(window.getByRole('region', { name: 'Issue page' })).toHaveCount(0)
    await expect(peek()).toHaveCount(0)
    expect(await checkedKeys()).toEqual([keyOf(1), keyOf(2), keyOf(3), keyOf(4)])
    await expect(bar()).toContainText('4 selected')
  })

  test('a second Cmd+click unchecks the row and leaves the others', async () => {
    await story(1)
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    await story(2)
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    await story(1)
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    await expect(story(1)).toHaveAttribute('aria-checked', 'false')
    expect(await checkedKeys()).toEqual([keyOf(2)])
  })

  test('Cmd+click and Shift+click combine around the anchor', async () => {
    await story(1).locator('[data-check]').click()
    await story(3)
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    // Row 3 is the anchor, so the range runs from it to row 5 and row 2 stays unchecked.
    await story(5)
      .locator('[data-summary]')
      .click({ modifiers: ['Shift'] })
    expect(await checkedKeys()).toEqual([keyOf(1), keyOf(3), keyOf(4), keyOf(5)])
    await expect(story(2)).toHaveAttribute('aria-checked', 'false')
    await expect(dialog('Edit summary')).toHaveCount(0)
    await expect(peek()).toHaveCount(0)
  })

  test('a Shift+click or Cmd+click selects no text', async () => {
    await story(2)
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    await story(6)
      .locator('[data-summary]')
      .click({ modifiers: ['Shift'] })
    await story(9)
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    expect(await selectedText()).toBe('')
    await expect(tree()).toBeFocused()
  })

  test('off macOS a Ctrl+click toggles and a Cmd+click does not', async () => {
    await window.evaluate(() => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome',
        configurable: true,
      })
    })
    // A press with Ctrl is a right-click on a Mac host, so the toggle is tested by the page alone.
    await story(2).locator('[data-check]').click()
    await expect(story(2)).toHaveAttribute('aria-checked', 'true')
    await story(3).dispatchEvent('click', { ctrlKey: true, detail: 1 })
    await expect(story(3)).toHaveAttribute('aria-checked', 'true')
    await story(4).dispatchEvent('click', { metaKey: true, detail: 1 })
    await expect(story(4)).toHaveAttribute('aria-checked', 'false')
    expect(await checkedKeys()).toEqual([keyOf(2), keyOf(3)])
  })

  test('on macOS a Ctrl+click opens the context menu and changes no check', async () => {
    test.skip(process.platform !== 'darwin', 'the Ctrl+click is a right-click on macOS only')
    await story(2).locator('[data-check]').click()
    await story(5).click({ modifiers: ['Control'], position: { x: 300, y: 16 } })
    await expect(menu()).toBeVisible()
    expect(await checkedKeys()).toEqual([keyOf(2)])
  })

  test('a Cmd+click writes nothing to Jira', async () => {
    await story(1)
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    await story(2)
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    const sent = await counts(app)
    expect(sent.edits).toBe(0)
    expect(sent.bulk).toHaveLength(0)
  })
})

/** PSAPAC-13 starts in the active sprint. These six join it, so it holds seven. */
const MEMBERS = [
  'PSAPAC-1',
  'PSAPAC-2',
  'PSAPAC-4',
  'PSAPAC-11',
  'PSAPAC-13',
  'PSAPAC-14',
  'PSAPAC-22',
]

const row = (key: string) => sprintPage().locator(`li[data-issue-key=${key}]`)
const checkbox = (key: string) => row(key).locator('[data-check]')
const checkedOnPage = () =>
  sprintPage()
    .locator('li[data-checked=true]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-issue-key') ?? '').sort())
/** The page's issue keys in page order: the status sections top to bottom. */
const pageOrder = () =>
  sprintPage()
    .locator('li[data-issue-key]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-issue-key') ?? ''))

async function openSprint() {
  await joinSprint(app, MEMBERS, 5)
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
  await expect(row('PSAPAC-2')).toBeVisible()
}

/** Hovers a row over its key, which makes it the active row. */
async function hover(key: string) {
  await window.mouse.move(2, 2)
  await row(key).hover({ position: { x: 60, y: 16 } })
  await expect(row(key)).toHaveAttribute('data-active', 'true')
}

test.describe('on the Sprint page', () => {
  test.beforeEach(async () => {
    await openSprint()
  })

  test('the gutter checkbox checks a row and the bulk bar shows', async () => {
    await expect(bar()).toHaveCount(0)
    await hover('PSAPAC-2')
    await checkbox('PSAPAC-2').click()
    await expect(row('PSAPAC-2')).toHaveAttribute('data-checked', 'true')
    await expect(checkbox('PSAPAC-2')).toHaveAttribute('aria-checked', 'true')
    await expect(bar()).toContainText('1 selected')
    // Once any row is checked every row shows its box.
    await expect(checkbox('PSAPAC-4')).toHaveCSS('opacity', '1')
    // The group headings hold no checkbox.
    await expect(
      sprintPage().getByRole('heading', { level: 2 }).locator('[data-check]'),
    ).toHaveCount(0)
    await expect(peek()).toHaveCount(0)
  })

  test('X toggles the hovered row, Cmd+A checks every row and Esc clears before it leaves', async () => {
    await hover('PSAPAC-2')
    await window.keyboard.press('x')
    await expect(row('PSAPAC-2')).toHaveAttribute('data-checked', 'true')
    await window.keyboard.press('X')
    await expect(row('PSAPAC-2')).not.toHaveAttribute('data-checked', 'true')

    await window.keyboard.press('ControlOrMeta+a')
    expect((await checkedOnPage()).length).toBe(MEMBERS.length)
    await expect(bar()).toContainText('7 selected')

    await window.keyboard.press('Escape')
    await expect(bar()).toHaveCount(0)
    expect(await checkedOnPage()).toEqual([])
    await expect(sprintPage()).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(sprintPage()).toHaveCount(0)
  })

  test('Shift+Down and Shift+Up move the active row and check the rows they cross', async () => {
    const order = await pageOrder()
    await hover(order[1] ?? '')
    await window.keyboard.press('Shift+ArrowDown')
    await window.keyboard.press('Shift+ArrowDown')
    expect(await checkedOnPage()).toEqual([order[1], order[2], order[3]].sort())
    await expect(row(order[3] ?? '')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Shift+ArrowUp')
    // Up from the third row steps back onto a row already checked, and unchecks nothing.
    expect(await checkedOnPage()).toEqual([order[1], order[2], order[3]].sort())
    await expect(row(order[2] ?? '')).toHaveAttribute('data-active', 'true')
  })

  test('Shift+click checks a range across the status sections and Cmd+click toggles one', async () => {
    const order = await pageOrder()
    expect(order).toHaveLength(MEMBERS.length)
    const [a, b, c, d, e] = order
    await checkbox(a ?? '').click({ force: true })
    // Cmd+click on the summary toggles and opens neither the modal nor the page.
    await row(c ?? '')
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    await expect(dialog('Edit summary')).toHaveCount(0)
    await row(e ?? '')
      .locator('[data-summary]')
      .click({ modifiers: ['Shift'] })
    expect(await checkedOnPage()).toEqual([a, c, d, e].sort())
    await expect(row(b ?? '')).not.toHaveAttribute('data-checked', 'true')
    await expect(dialog('Edit summary')).toHaveCount(0)
    await expect(sprintPage().getByRole('region', { name: 'Issue page' })).toHaveCount(0)
    expect(await selectedText()).toBe('')

    // Cmd+click on the status dot and the avatar toggles, with no editor.
    await row(b ?? '')
      .locator('[data-pick=status]')
      .click({ modifiers: [TOGGLE] })
    await row(b ?? '')
      .locator('[data-pick=assignee]')
      .click({ modifiers: [TOGGLE] })
    await expect(row(b ?? '')).not.toHaveAttribute('data-checked', 'true')
    await expect(window.locator('.menu:popover-open')).toHaveCount(0)
  })

  test('a bulk action from the page goes to the fake Jira and keeps the page checked', async () => {
    await hover('PSAPAC-2')
    await window.keyboard.press('x')
    await hover('PSAPAC-4')
    await window.keyboard.press('x')
    await expect(bar()).toContainText('2 selected')

    await bar().getByRole('button', { name: 'Actions', exact: true }).click()
    await window.getByRole('button', { name: 'Priority', exact: true }).click()
    await window.getByRole('option', { name: /^High( High)?$/ }).click()

    await expect.poll(async () => (await counts(app)).bulk.length).toBe(1)
    const call = (await counts(app)).bulk[0]
    const body = call?.body as { selectedIssueIdsOrKeys?: string[] }
    expect([...(body.selectedIssueIdsOrKeys ?? [])].sort()).toEqual(['PSAPAC-2', 'PSAPAC-4'])
    await expect(notices(window).getByText(/Priority changed to High on 2 issues/)).toBeVisible()
    await expect(bar()).toContainText('2 selected')
  })

  test('leaving the page clears its set, and the Tree keeps its own', async () => {
    await hover('PSAPAC-2')
    await window.keyboard.press('x')
    await expect(bar()).toContainText('1 selected')
    await sprintPage().getByRole('button', { name: 'Back to issues' }).click()
    await expect(sprintPage()).toHaveCount(0)
    await expect(bar()).toHaveCount(0)

    await sidebar()
      .getByRole('region', { name: 'Sprints' })
      .getByRole('button', { name: /^Current/ })
      .click()
    await expect(row('PSAPAC-2')).toBeVisible()
    expect(await checkedOnPage()).toEqual([])
    await expect(bar()).toHaveCount(0)
  })

  test('a Shift+click and a Cmd+click write nothing to Jira', async () => {
    await row('PSAPAC-2')
      .locator('[data-summary]')
      .click({ modifiers: [TOGGLE] })
    await row('PSAPAC-4')
      .locator('[data-summary]')
      .click({ modifiers: ['Shift'] })
    const sent = await counts(app)
    expect(sent.edits).toBe(0)
    expect(sent.bulk).toHaveLength(0)
  })
})
