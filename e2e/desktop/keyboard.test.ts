import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  launch,
  logIn,
  moveIssue,
  refuseNextEdit,
  releaseDone,
  releaseEdit,
} from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  ;({ app, window } = await launch(stateDir))
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: string | RegExp, exact = false) => tree().getByRole('treeitem', { name, exact })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const props = () => issuePage().getByRole('complementary', { name: 'Properties' })
const palette = () => window.getByRole('dialog', { name: 'Search issues' })
const search = () => palette().getByRole('combobox')
const peekPicker = (label: string) => peek().getByRole('button', { name: new RegExp(`^${label}:`) })
const option = (name: string | RegExp) => window.getByRole('option', { name })
const undoButton = () => window.getByRole('button', { name: 'Undo' })
const notice = (text: string | RegExp) => window.getByText(text)

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Makes the row active and shows its Peek, then closes the Peek: the state `S` starts from. */
async function select(row: RegExp) {
  await item(row).click()
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
}

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1)

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

test('Cmd+K searches the loaded issues by key and summary, and Enter opens the page', async () => {
  await open()
  await window.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  await expect(search()).toBeFocused()

  await search().fill('runbook')
  await expect(palette().getByRole('option')).toHaveCount(1)
  await expect(option(/PSAPAC-11/)).toContainText('Draft the runbook')
  await expect(search()).toHaveAttribute('aria-activedescendant', /.+/)

  await window.keyboard.press('Enter')
  await expect(issuePage().getByRole('heading', { name: 'Draft the runbook' })).toBeVisible()
  await expect(palette()).toHaveCount(0)
  await expect(issuePage()).toBeFocused()
  expect(await writes()).toBe(0)

  // Leaving the page lands on the row the palette chose.
  await window.keyboard.press('Escape')
  await expect(item(/PSAPAC-11,/)).toHaveAttribute('data-active', 'true')
})

test('the palette shows each result with its type icon', async () => {
  await open()
  await window.keyboard.press('Meta+k')
  await search().fill('dashboards')
  await expect(option(/PSAPAC-4\b/).getByRole('img', { name: 'Story' })).toBeVisible()
})

test('the palette finds by key, moves with the arrows, opens on a click, and says when nothing matches', async () => {
  await open()
  await window.keyboard.press('Meta+k')

  await search().fill('psapac-3')
  await expect(palette().getByRole('option').first()).toContainText('PSAPAC-3')
  await expect(palette().getByRole('option').first()).toContainText('Fix the export timeout')

  await search().fill('psapac')
  const results = palette().getByRole('option')
  await expect(results.first()).toHaveAttribute('aria-selected', 'true')
  await window.keyboard.press('ArrowDown')
  await expect(results.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(results.first()).toHaveAttribute('aria-selected', 'false')

  await search().fill('zzzz')
  await expect(palette().getByText('No issues match')).toBeVisible()

  await search().fill('outline')
  await option(/PSAPAC-12/).click()
  await expect(issuePage().getByRole('heading', { name: 'Outline the sections' })).toBeVisible()
})

test('the palette reaches a Done issue the Tree hides, and the letters then act on its page', async () => {
  await open()
  await releaseDone(app)
  await expect(item('2 done', true)).toBeVisible()
  await expect(item(/PSAPAC-22,/)).toHaveCount(0)

  await window.keyboard.press('Meta+k')
  await search().fill('schema')
  await window.keyboard.press('Enter')
  await expect(issuePage().getByRole('heading', { name: 'Migrate the schema' })).toBeVisible()
  // The active row is a header, yet the page's issue is the target.
  await window.keyboard.press('a')
  await expect(props().getByRole('combobox', { name: 'Search Assignee' })).toBeFocused()
})

test('the palette takes letters as text, and Esc closes it and returns focus', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await window.keyboard.press('Escape')
  await window.keyboard.press('Meta+k')

  await search().pressSequentially('sapl')
  await expect(search()).toHaveValue('sapl')
  await expect(peek()).toHaveCount(0)
  await expect(window.getByRole('listbox', { name: 'Status' })).toHaveCount(0)

  await window.keyboard.press('Escape')
  await expect(palette()).toHaveCount(0)
  await expect(tree()).toBeFocused()

  // From a text field it opens too, and Esc goes back to that field.
  const filter = window.getByLabel('Filter by key or summary')
  await filter.focus()
  await window.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(filter).toBeFocused()
})

test('S, A, P and L open the Peek pickers for the active row, and a pick returns focus to the Tree', async () => {
  await open()
  await select(/PSAPAC-4,/)
  const before = await writes()

  // S: the Peek opens with the status list focused.
  await window.keyboard.press('s')
  await expect(peek()).toBeVisible()
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await expect(option('To Do')).toBeVisible()
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('Enter')
  await expect(peekPicker('Status')).toHaveAccessibleName('Status: To Do')
  await expect(tree()).toBeFocused()
  await settle(before + 1)
  expect(await lastBody()).toEqual({ transition: { id: 't1' } })

  // The next key goes to the Tree again.
  await window.keyboard.press('j')
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'false')
  await window.keyboard.press('k')
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')

  // A: the search field of the assignee picker, closed by Esc.
  await window.keyboard.press('A')
  await expect(window.getByRole('combobox', { name: 'Search Assignee' })).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('combobox', { name: 'Search Assignee' })).toHaveCount(0)
  await expect(peek()).toBeVisible()
  await expect(tree()).toBeFocused()

  // P: a priority from the list.
  await window.keyboard.press('p')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeFocused()
  await expect(option('Low')).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Low')
  await expect(tree()).toBeFocused()
  await settle(before + 2)

  // L: type a new label and add it.
  await window.keyboard.press('l')
  const labels = window.getByRole('combobox', { name: 'Search Labels' })
  await expect(labels).toBeFocused()
  await labels.pressSequentially('urgent')
  await expect(option('Create "urgent"')).toBeVisible()
  await window.keyboard.press('Enter')
  await expect(peekPicker('Labels')).toHaveAccessibleName('Labels: urgent')
  await settle(before + 3)
  await window.keyboard.press('Escape')
  await expect(tree()).toBeFocused()
  await expect(peek()).toBeVisible()
})

test('E edits the summary in the Peek, and Cmd+Z puts the old one back', async () => {
  await open()
  await select(/PSAPAC-4,/)
  const before = await writes()

  await window.keyboard.press('e')
  const field = peek().getByLabel('Summary')
  await expect(field).toBeFocused()
  await field.fill('Migrate the dashboards, again')
  await field.press('Enter')
  await expect(peek().getByRole('heading', { name: 'Migrate the dashboards, again' })).toBeVisible()
  await expect(tree()).toBeFocused()
  await settle(before + 1)
  await expect(notice('PSAPAC-4: summary changed to "Migrate the dashboards, again"')).toBeVisible()

  await window.keyboard.press('Meta+z')
  await expect(peek().getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
  await settle(before + 2)
  await expect(notice('Undid PSAPAC-4: summary back to "Migrate the dashboards"')).toBeVisible()
})

test('on the page the letters open the sidebar, Esc closes the picker and then leaves the page', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeFocused()

  await window.keyboard.press('a')
  await expect(props().getByRole('combobox', { name: 'Search Assignee' })).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(props().getByRole('combobox', { name: 'Search Assignee' })).toHaveCount(0)
  await expect(issuePage()).toBeVisible()
  // Focus goes back to where the key was pressed, the page itself.
  await expect(issuePage()).toBeFocused()

  await window.keyboard.press('e')
  await expect(issuePage().getByLabel('Summary')).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(issuePage()).toBeVisible()

  // Focus is on the page again, so Esc leaves it.
  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('Esc closes a picker, then the Peek, from wherever focus is', async () => {
  await open()
  await select(/PSAPAC-4,/)

  await window.keyboard.press('s')
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  // The first Esc closes only the picker.
  await window.keyboard.press('Escape')
  await expect(window.getByRole('listbox', { name: 'Status' })).toHaveCount(0)
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)

  // Focus on a button in the Peek is outside the Tree, and Esc still closes it.
  await window.keyboard.press(' ')
  await expect(peek()).toBeVisible()
  await peek().getByRole('button', { name: 'Migrate the dashboards' }).focus()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()

  // The page covers the Peek, so it leaves first. Focus on the sidebar is outside both.
  await window.keyboard.press(' ')
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  await window.getByRole('button', { name: 'Log out' }).focus()
  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)
  await expect(peek()).toBeVisible()
  await window.getByRole('button', { name: 'Log out' }).focus()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
})

test('the letters do nothing with no issue selected, in a text field, with a modifier or in a dialog', async () => {
  await open()
  const before = await writes()
  const nothingOpen = async () => {
    await expect(peek()).toHaveCount(0)
    await expect(window.getByRole('listbox')).toHaveCount(0)
    await expect(window.getByRole('combobox')).toHaveCount(0)
  }

  // A Customer header is active at first, which is no issue.
  await expect(tree()).toHaveAttribute('aria-activedescendant', /tree-row-c:/)
  for (const key of ['s', 'a', 'l', 'p', 'e']) await window.keyboard.press(key)
  await nothingOpen()

  // The filter field keeps its letters.
  const filter = window.getByLabel('Filter by key or summary')
  await filter.pressSequentially('sapl')
  await expect(filter).toHaveValue('sapl')
  await nothingOpen()
  await filter.fill('')

  // An issue is active, but the keys carry a modifier.
  await item(/PSAPAC-4,/).click()
  await window.keyboard.press('Escape')
  for (const key of ['Alt+s', 'Control+a', 'Meta+l']) await window.keyboard.press(key)
  await nothingOpen()

  // The create modal keeps its letters.
  await window.keyboard.press('c')
  await expect(window.getByRole('dialog')).toBeVisible()
  await window.keyboard.press('s')
  await expect(window.getByRole('dialog').getByLabel('Summary')).toHaveValue('s')
  await expect(peek()).toHaveCount(0)
  expect(await writes()).toBe(before)
})

test('Cmd+Z undoes the status, newest edit first, and the toast offers Undo', async () => {
  await open()
  await select(/PSAPAC-4,/)
  const before = await writes()

  await window.keyboard.press('s')
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await expect(option('To Do')).toBeVisible()
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('Enter')
  await settle(before + 1)
  await expect(notice('PSAPAC-4: status changed to To Do')).toBeVisible()
  await expect(undoButton()).toBeVisible()

  await window.keyboard.press('p')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeFocused()
  await expect(option('Low')).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await settle(before + 2)
  await expect(notice('PSAPAC-4: priority changed to Low')).toBeVisible()

  // The priority goes first.
  await window.keyboard.press('Meta+z')
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Medium')
  await expect(peekPicker('Status')).toHaveAccessibleName('Status: To Do')
  await settle(before + 3)
  expect(await lastBody()).toEqual({ fields: { priority: { id: '3' } } })
  await expect(notice('Undid PSAPAC-4: priority back to Medium')).toBeVisible()
  // The undo's own toast offers no Undo, since Cmd+Z walks on.
  await expect(undoButton()).toHaveCount(0)

  // Then the status, moved back by the old status's transition.
  await window.keyboard.press('Meta+z')
  await expect(peekPicker('Status')).toHaveAccessibleName('Status: In Progress')
  await settle(before + 4)
  expect(await lastBody()).toEqual({ transition: { id: 't2' } })
  await expect(notice('Undid PSAPAC-4: status back to In Progress')).toBeVisible()

  // An undo is not itself undoable, and the stack is now empty.
  await window.keyboard.press('Meta+z')
  await expect(notice('Nothing to undo')).toBeVisible()
  expect(await writes()).toBe(before + 4)
})

test("the toast's Undo button does the same as Cmd+Z", async () => {
  await open()
  await select(/PSAPAC-4,/)
  const before = await writes()

  await window.keyboard.press('a')
  await window.getByRole('combobox', { name: 'Search Assignee' }).pressSequentially('cy')
  await option('Cy Young').click()
  await expect(peekPicker('Assignee')).toHaveAccessibleName('Assignee: Cy Young')
  await settle(before + 1)
  await expect(notice('PSAPAC-4: assignee changed to Cy Young')).toBeVisible()

  await undoButton().click()
  await expect(peekPicker('Assignee')).toHaveAccessibleName('Assignee: Test User')
  await settle(before + 2)
  expect(await lastBody()).toEqual({ fields: { assignee: { accountId: 'u1' } } })
  await expect(notice('Undid PSAPAC-4: assignee back to Test User')).toBeVisible()
  await expect(tree()).toBeFocused()
})

test('Cmd+Z leaves native undo to a text field, and a refused edit leaves nothing to undo', async () => {
  await open()
  await select(/PSAPAC-4,/)
  const before = await writes()

  await window.keyboard.press('p')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeFocused()
  await expect(option('Low')).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await settle(before + 1)

  const filter = window.getByLabel('Filter by key or summary')
  await filter.fill('abc')
  await filter.press('Meta+z')
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Low')
  await expect(notice(/^Undid/)).toHaveCount(0)
  expect(await writes()).toBe(before + 1)

  // From the Tree it undoes. Now an edit Jira refuses: Highest is refused by the fake.
  await filter.fill('')
  await item(/PSAPAC-4,/).click()
  await window.keyboard.press('Escape')
  await window.keyboard.press('Meta+z')
  await settle(before + 2)
  await window.keyboard.press(' ')
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Medium')

  await window.keyboard.press('p')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeFocused()
  await expect(option('Highest')).toBeVisible()
  await window.keyboard.press('Home')
  await window.keyboard.press('Enter')
  await expect.poll(writes).toBe(before + 3)
  await releaseEdit(app)
  await expect(window.getByRole('alert')).toContainText('Could not change the priority')
  await window.keyboard.press('Meta+z')
  await expect(notice('Nothing to undo')).toBeVisible()
})

test('Cmd+Z refuses to overwrite a change made elsewhere since', async () => {
  await open()
  await select(/PSAPAC-3,/)
  const before = await writes()

  await window.keyboard.press('s')
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await expect(option('In Progress')).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await settle(before + 1)
  await expect(peekPicker('Status')).toHaveAccessibleName('Status: In Progress')

  // Someone moves the issue back to To Do; the next window focus reads it.
  await moveIssue(app, 'PSAPAC-3', 'todo')
  await app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows()
    first?.emit('blur')
    first?.emit('focus')
  })
  await expect(peekPicker('Status')).toHaveAccessibleName('Status: To Do')

  await window.keyboard.press('Meta+z')
  await expect(notice('Did not undo the status of PSAPAC-3')).toBeVisible()
  await expect(notice(/changed since/)).toBeVisible()
  // Nothing was sent, and the issue keeps what Jira holds.
  expect(await writes()).toBe(before + 1)
  await expect(peekPicker('Status')).toHaveAccessibleName('Status: To Do')
})

test('a refused undo shows the value as it was, says why, and is not retried', async () => {
  await open()
  await select(/PSAPAC-4,/)
  const before = await writes()

  await window.keyboard.press('p')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeFocused()
  await expect(option('Low')).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await settle(before + 1)
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Low')

  await refuseNextEdit(app)
  await window.keyboard.press('Meta+z')
  // The old value shows at once, then goes back to where it was when Jira refuses.
  await expect.poll(writes).toBe(before + 2)
  await releaseEdit(app)
  await expect(window.getByRole('alert')).toContainText('Could not undo the priority of PSAPAC-4')
  await expect(window.getByRole('alert')).toContainText('The fake refuses this edit.')
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Low')

  // The refused entry is gone, so another Cmd+Z has nothing to retry and sends nothing.
  await window.keyboard.press('Meta+z')
  await expect(notice('Nothing to undo')).toBeVisible()
  expect(await writes()).toBe(before + 2)
})

const filter = () => window.getByRole('textbox', { name: 'Filter by key or summary' })
const skipLink = () => window.getByRole('link', { name: 'Skip to issues' })

test('/ focuses the filter, and Enter lands on the first issue row with the query kept', async () => {
  await open()
  await expect(tree()).toBeFocused()

  await window.keyboard.press('/')
  await expect(filter()).toBeFocused()
  await window.keyboard.type('runbook')
  await expect(filter()).toHaveValue('runbook')
  await expect(item(/PSAPAC-11,/)).toBeVisible()

  await window.keyboard.press('Enter')
  await expect(tree()).toBeFocused()
  await expect(filter()).toHaveValue('runbook')
  // The first row is the Customer header; the active row is the first issue under it, the Epic.
  await expect(tree().getByRole('treeitem').first()).toHaveAttribute('data-active', 'false')
  await expect(tree().locator('[data-active="true"]')).toHaveAccessibleName(/^PSAPAC-10,/)
  expect(await writes()).toBe(0)

  // The active row is an issue, so a letter acts on it.
  await window.keyboard.press('s')
  await expect(peek()).toBeVisible()
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
})

test('ArrowDown in the filter also moves to the first issue row, and a typed / stays in the field', async () => {
  await open()
  await window.keyboard.press('/')
  await window.keyboard.type('a/b')
  await expect(filter()).toHaveValue('a/b')
  await filter().fill('PSAPAC')

  await window.keyboard.press('ArrowDown')
  await expect(tree()).toBeFocused()
  await expect(filter()).toHaveValue('PSAPAC')
  await expect(tree().getByRole('treeitem').first()).toHaveAttribute('data-active', 'false')
  await expect(tree().locator('[data-active="true"]')).toHaveAccessibleName(/^PSAPAC-\d+,/)
})

test('/ selects the text already in the filter, and does nothing with a modifier', async () => {
  await open()
  await window.keyboard.press('/')
  await window.keyboard.type('old')
  await window.keyboard.press('Enter')
  await expect(tree()).toBeFocused()

  await window.keyboard.press('Meta+/')
  await expect(tree()).toBeFocused()
  await window.keyboard.press('/')
  await expect(filter()).toBeFocused()
  await window.keyboard.type('new')
  await expect(filter()).toHaveValue('new')
})

test('letters do nothing on a sidebar button, and still act in the Tree', async () => {
  await open()
  await select(/PSAPAC-2,/)
  const logout = window.getByRole('button', { name: 'Log out' })
  await logout.focus()
  await expect(logout).toBeFocused()

  for (const letter of ['t', 'c', 's']) await window.keyboard.press(letter)
  await expect(notice(/Started the timer/)).toHaveCount(0)
  await expect(window.getByRole('dialog')).toHaveCount(0)
  await expect(peek()).toHaveCount(0)
  await expect(logout).toBeFocused()

  await tree().focus()
  await window.keyboard.press('t')
  await expect(notice('Started the timer on PSAPAC-2')).toBeVisible()
})

test('letters do nothing on a toolbar button either', async () => {
  await open()
  await select(/PSAPAC-2,/)
  const toggle = window.getByRole('button', { name: 'Hide done' })
  await toggle.focus()
  await window.keyboard.press('c')
  await expect(window.getByRole('dialog')).toHaveCount(0)
})

test('the first Tab stop is Skip to issues, which shows on focus and moves focus to the Tree', async () => {
  await open()
  await window.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await window.keyboard.press('Tab')
  await expect(skipLink()).toBeFocused()
  const box = await skipLink().boundingBox()
  expect(box).not.toBeNull()
  expect(box?.y).toBeGreaterThanOrEqual(0)
  expect(box?.x).toBeGreaterThanOrEqual(0)

  await window.keyboard.press('Enter')
  await expect(tree()).toBeFocused()
})

test('an empty Tree still shows focus, painted over the No issues match panel', async () => {
  await open()
  await filter().fill('zzzzzz')
  await expect(window.getByText('No issues match')).toBeVisible()
  const wrapper = tree().locator('xpath=..')
  const box = await wrapper.boundingBox()
  expect(box).not.toBeNull()
  // A strip along the top edge, where the 2px ring sits.
  const clip = { x: box?.x ?? 0, y: box?.y ?? 0, width: box?.width ?? 0, height: 4 }
  const unfocused = await window.screenshot({ clip })

  await window.keyboard.press('Enter')
  await expect(tree()).toBeFocused()
  const focused = await window.screenshot({ clip })
  // The strip is plain canvas until the ring is painted over the panel.
  expect(focused.equals(unfocused)).toBe(false)
})

test('Dismiss on a toast hands focus back, so a letter works again', async () => {
  await open()
  await select(/PSAPAC-2,/)
  await window.keyboard.press('t')
  await expect(notice('Started the timer on PSAPAC-2')).toBeVisible()

  await window.getByRole('button', { name: 'Dismiss' }).click()
  await expect(notice('Started the timer on PSAPAC-2')).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await window.keyboard.press('c')
  await expect(window.getByRole('dialog', { name: 'New issue' })).toBeVisible()
})

const help = () => window.getByRole('dialog', { name: 'Keyboard shortcuts' })

test('? lists every table and row of docs/reference/shortcuts.md, and Esc returns to the Tree', async () => {
  await open()
  await select(/PSAPAC-2,/)
  await window.keyboard.press('?')
  await expect(help()).toBeVisible()

  // The page is the source: count its tables and the rows of each against the overlay.
  const doc = await readFile(new URL('../../docs/reference/shortcuts.md', import.meta.url), 'utf8')
  const tables: { title: string; rows: number }[] = []
  let table: { title: string; rows: number } | null = null
  for (const line of doc.split('\n')) {
    if (line.startsWith('## ')) tables.push((table = { title: line.slice(3), rows: -2 }))
    // The header and the rule line are not shortcuts.
    else if (line.startsWith('|') && table !== null) table.rows += 1
  }
  // Prose sections such as Tab have no table.
  const listed = tables.filter((t) => t.rows > 0)
  expect(listed.map((t) => t.title)).toEqual(['Global', 'Tree', 'Fields and Dialogs'])
  for (const { title, rows } of listed) {
    await expect(help().getByRole('region', { name: title }).locator('tbody tr')).toHaveCount(rows)
  }
  await expect(
    help().getByRole('region', { name: 'Global' }).locator('kbd', { hasText: '?' }),
  ).toBeVisible()

  await window.keyboard.press('Escape')
  await expect(help()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('? types into a field, and does nothing over the palette', async () => {
  await open()
  await window.keyboard.press('/')
  await window.keyboard.type('a?b')
  await expect(filter()).toHaveValue('a?b')
  await expect(help()).toHaveCount(0)

  await window.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  await window.keyboard.type('?')
  await expect(search()).toHaveValue('?')
  await expect(help()).toHaveCount(0)
})

test('the header Shortcuts button opens the same list', async () => {
  await open()
  await window.getByRole('button', { name: 'Shortcuts' }).click()
  await expect(help()).toBeVisible()
})

test('hovering a Peek picker shows its key as a keycap', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await expect(peek()).toBeVisible()
  for (const [label, letter] of [
    ['Status', 'S'],
    ['Assignee', 'A'],
    ['Labels', 'L'],
    ['Priority', 'P'],
  ] as const) {
    const keycap = peekPicker(label).locator('kbd')
    await expect(keycap).toBeHidden()
    await peekPicker(label).hover()
    await expect(keycap).toHaveText(letter)
    await expect(keycap).toBeVisible()
    await window.mouse.move(0, 0)
  }
})

test('the palette draws its keys as keycaps on 36px rows', async () => {
  await open()
  await expect(window.getByRole('button', { name: 'Search' }).locator('kbd')).toHaveText('⌘K')
  await window.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  await search().fill('runbook')
  await expect(palette().getByRole('option')).toHaveCount(1)
  expect((await option(/PSAPAC-11/).boundingBox())?.height).toBe(36)
  await expect(palette().locator('kbd')).toHaveText(['Enter', 'Esc'])
})

/** Slows the renderer, so the Tree's deferred rows lag the text the filter holds. */
async function throttle(rate: number) {
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
}

for (const key of ['Enter', 'ArrowDown']) {
  test(`${key} in a filter whose Tree is still catching up lands on the first issue row`, async () => {
    await open()
    await window.keyboard.press('/')
    await window.keyboard.type('a/b')
    await expect(window.getByText('No issues match')).toBeVisible()
    await throttle(20)
    await filter().fill('PSAPAC')

    await window.keyboard.press(key)
    await expect(tree()).toBeFocused()
    await expect(filter()).toHaveValue('PSAPAC')
    await expect(item(/PSAPAC-10,/)).toBeVisible()
    await expect(tree().getByRole('treeitem').first()).toHaveAttribute('data-active', 'false')
    await expect(tree().locator('[data-active="true"]')).toHaveAccessibleName(/^PSAPAC-\d+,/)
  })
}
