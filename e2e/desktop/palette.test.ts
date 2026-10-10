import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { SITE, counts, launch, logIn, notices, releaseEdit } from './harness.js'

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
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const props = () => issuePage().getByRole('complementary', { name: 'Properties' })
const palette = () => window.getByRole('dialog', { name: 'Search issues' })
const search = () => palette().getByRole('combobox')
const actions = () => palette().getByRole('group', { name: 'Actions' })
const action = (name: string) => actions().getByRole('option', { name, exact: true })
const option = (name: string | RegExp) => window.getByRole('option', { name })
const dialog = () => window.getByRole('dialog', { name: 'New issue' })
const peekPicker = (label: string) => peek().getByRole('button', { name: new RegExp(`^${label}:`) })

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under a click.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Makes the row active and closes the Peek the click opened: the state a key starts from. */
async function select(row: RegExp) {
  await item(row).click()
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
}

/** Opens the palette and runs the action named `name` from the field, as the keyboard would. */
async function run(name: string) {
  await window.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  await search().fill(name)
  await expect(action(name)).toHaveAttribute('aria-selected', 'true')
  await window.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0)
}

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1)
const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText())

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

test('Cmd+K names the issue in context as a chip and lists its actions with their keys', async () => {
  await open()
  await select(/PSAPAC-4,/)
  await window.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()

  const chip = palette().getByTitle('Migrate the dashboards')
  await expect(chip).toContainText('PSAPAC-4')
  await expect(search()).toHaveAccessibleDescription(/PSAPAC-4/)

  // The key beside each action is the key that does the same thing; the rest show none.
  const rows: [string, string | null][] = [
    ['Assign', 'A'],
    ['Assign to me', 'I'],
    ['Change status', 'S'],
    ['Change priority', 'P'],
    ['Add labels', 'L'],
    ['Set sprint', null],
    ['Create sub-issue', null],
    ['Copy key', 'Y'],
    ['Copy link', 'U'],
    ['Open in Jira', null],
  ]
  await expect(actions().getByRole('option')).toHaveCount(rows.length)
  for (const [name, key] of rows) {
    const keycap = action(name).locator('kbd')
    if (key === null) await expect(keycap).toHaveCount(0)
    else await expect(keycap).toHaveText(key)
  }
  expect((await action('Assign').boundingBox())?.height).toBe(36)
  // The first action is highlighted, so Enter runs it.
  await expect(action('Assign')).toHaveAttribute('aria-selected', 'true')

  // Saved views follow the actions.
  await expect(palette().getByRole('option', { name: 'Go to view My issues' })).toBeVisible()
})

test('with no issue in context the palette has no chip and no actions, only views and search', async () => {
  await open()
  await window.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  await expect(actions()).toHaveCount(0)
  await expect(search()).not.toHaveAccessibleDescription(/PSAPAC/)
  await expect(palette().getByRole('option', { name: 'Go to view My issues' })).toBeVisible()
})

test('Assign to me writes what I writes, and the toast offers Undo', async () => {
  await open()
  await select(/PSAPAC-3,/)
  const before = await writes()

  await run('Assign to me')
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/Test User/)
  await settle(before + 1)
  expect(await lastBody()).toEqual({ fields: { assignee: { accountId: 'u1' } } })
  await expect(notices(window).getByText('PSAPAC-3: assignee changed to Test User')).toBeVisible()
  await expect(window.getByRole('button', { name: 'Undo' })).toBeVisible()
  await expect(tree()).toBeFocused()
})

test('Change status and Change priority open the Peek pickers, whose picks write', async () => {
  await open()
  await select(/PSAPAC-4,/)
  const before = await writes()

  await run('Change status')
  await expect(peek()).toBeVisible()
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('Enter')
  await expect(peekPicker('Status')).toHaveAccessibleName('Status: To Do')
  await settle(before + 1)
  expect(await lastBody()).toEqual({ transition: { id: 't1' } })
  await expect(tree()).toBeFocused()

  await run('Change priority')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await expect(peekPicker('Priority')).toHaveAccessibleName('Priority: Low')
  await settle(before + 2)
  await expect(tree()).toBeFocused()
})

test('Assign and Add labels open their pickers on the Peek', async () => {
  await open()
  await select(/PSAPAC-4,/)

  await run('Assign')
  await expect(window.getByRole('combobox', { name: 'Search Assignee' })).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('combobox', { name: 'Search Assignee' })).toHaveCount(0)

  await run('Add labels')
  await expect(window.getByRole('combobox', { name: 'Search Labels' })).toBeFocused()
})

test('Set sprint opens the issue page on its Sprint picker, whose pick moves the issue', async () => {
  await open()
  await select(/PSAPAC-13,/)

  // The Peek has no Sprint picker, so the page opens first.
  await run('Set sprint')
  await expect(issuePage()).toBeVisible()
  await expect(props().getByRole('listbox', { name: 'Sprint' })).toBeFocused()
  await option(/^Sprint 6/).click()
  await expect(props().getByRole('button', { name: 'Sprint: Sprint 6' })).toBeVisible()
})

test('Copy key and Copy link copy for the issue, and Open in Jira opens its page on the site', async () => {
  await open()
  await select(/PSAPAC-4,/)

  await run('Copy key')
  await expect.poll(clipboardText).toBe('PSAPAC-4')
  await expect(notices(window).getByText('Copied the key of PSAPAC-4')).toBeVisible()

  await run('Copy link')
  await expect.poll(clipboardText).toBe(`${SITE}/browse/PSAPAC-4`)
  await expect(notices(window).getByText('Copied the link of PSAPAC-4')).toBeVisible()

  expect((await counts(app)).openExternal).toEqual([])
  await run('Open in Jira')
  await expect
    .poll(async () => (await counts(app)).openExternal)
    .toEqual([`${SITE}/browse/PSAPAC-4`])
  expect(await writes()).toBe(0)
})

test('Create sub-issue opens the create modal as a Subtask under the issue', async () => {
  await open()
  await select(/PSAPAC-2,/)

  await run('Create sub-issue')
  await expect(dialog()).toBeVisible()
  await expect(dialog().getByRole('button', { name: 'Type: Subtask' })).toBeVisible()
  await expect(
    dialog().getByRole('button', { name: 'Parent: PSAPAC-2 Review the data model' }),
  ).toBeVisible()
  // The form is the whole create form: the description editor is there to type in.
  await expect(dialog().getByRole('textbox', { name: 'Description' })).toBeVisible()
})

test('an Epic is offered neither Set sprint nor Create sub-issue', async () => {
  await open()
  await select(/PSAPAC-10,/)
  await window.keyboard.press('Meta+k')
  await expect(action('Assign')).toBeVisible()
  await expect(action('Set sprint')).toHaveCount(0)
  await expect(action('Create sub-issue')).toHaveCount(0)
})

test('Go to view applies the saved view, as a click in the sidebar does', async () => {
  await open()
  await window.keyboard.press('Meta+k')
  await search().fill('my issues')
  await window.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0)
  await expect(window.getByRole('button', { name: 'Assignee: me', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('on the issue page the chip and the actions are that page issue', async () => {
  await open()
  await select(/PSAPAC-4,/)
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()

  await window.keyboard.press('Meta+k')
  await expect(palette().getByTitle('Migrate the dashboards')).toContainText('PSAPAC-4')
  await search().fill('Change status')
  await window.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0)
  await expect(props().getByRole('listbox', { name: 'Status' })).toBeFocused()
  // The page covers the Peek; nothing opened behind it.
  await expect(peek()).toHaveCount(0)
})

test('searching still finds issues beside the actions, and Enter opens the top issue', async () => {
  await open()
  await select(/PSAPAC-4,/)
  await window.keyboard.press('Meta+k')

  await search().fill('runbook')
  await expect(actions()).toHaveCount(0)
  await expect(palette().getByRole('option')).toHaveCount(1)
  await expect(option(/PSAPAC-11/)).toContainText('Draft the runbook')
  await window.keyboard.press('Enter')
  await expect(issuePage().getByRole('heading', { name: 'Draft the runbook' })).toBeVisible()
})
