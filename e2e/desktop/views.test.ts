import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { launch, logIn } from './harness.js'

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

interface StoredView {
  id: string
  name: string
  filters: Record<string, unknown>
  toggles: Record<string, boolean>
}

/** `views.json` as the CLI's `jm view list` reads it. */
const stored = async () =>
  JSON.parse(await readFile(join(stateDir, 'views.json'), 'utf8')) as StoredView[]
const settings = async () =>
  JSON.parse(await readFile(join(stateDir, 'settings.json'), 'utf8')) as {
    toggles: Record<string, boolean>
  }

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const toggle = (name: string) => window.getByRole('button', { name, exact: true })
const list = () => window.getByRole('list', { name: 'Saved views' })
const apply = (name: string) => list().getByRole('button', { name, exact: true })
const chips = () => window.getByRole('list', { name: 'Active filters' })

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
}

/** Filters the Tree to Bugs through the Filter menu. */
async function filterToBugs() {
  await window.getByRole('button', { name: 'Filter', exact: true }).click()
  await window.getByText('Type', { exact: true }).click()
  await window.getByRole('checkbox', { name: 'Bug' }).check()
  await window.keyboard.press('Escape')
  await expect(chips()).toContainText('Type: Bug')
}

async function createView(name: string) {
  await window.getByRole('button', { name: 'New view' }).click()
  await window.getByLabel('New view name').fill(name)
  await window.keyboard.press('Enter')
}

test('lists the starter views, and applying one sets the filters and the toggles', async () => {
  await open()
  await expect(list().getByRole('listitem')).toHaveCount(2)

  await apply('Current sprint').click()
  await expect(chips()).toContainText('Sprint: Current sprint')
  await expect(apply('Current sprint')).toHaveAttribute('aria-current', 'true')
  await expect(apply('My issues')).not.toHaveAttribute('aria-current', 'true')
  // PSAPAC-13 is the one issue in the active sprint.
  await expect(item(/PSAPAC-13,/)).toBeVisible()
  await expect(item(/PSAPAC-4,/)).toHaveCount(0)

  await apply('My issues').click()
  await expect(chips()).toHaveCount(0)
  await expect(toggle('Assignee: me')).toHaveAttribute('aria-pressed', 'true')
  await expect(apply('My issues')).toHaveAttribute('aria-current', 'true')
  await expect(item(/PSAPAC-2,/)).toBeVisible()
  await expect(item(/PSAPAC-13,/)).toHaveCount(0)
  await expect(item(/PSAPAC-3,/)).toHaveCount(0)
  // The toggles the view set are the toggles now, and settings.json holds them.
  await expect.poll(async () => (await settings()).toggles.assigneeMe).toBe(true)

  // Changing a toggle or a filter leaves the view.
  await toggle('Assignee: me').click()
  await expect(apply('My issues')).not.toHaveAttribute('aria-current', 'true')
})

test('creates a view from the filter bar, and the file the CLI reads holds it', async () => {
  await open()
  await filterToBugs()
  await toggle('Hide done').click()

  await createView('  Open bugs ')

  await expect(apply('Open bugs')).toBeVisible()
  await expect(apply('Open bugs')).toHaveAttribute('aria-current', 'true')
  const views = await stored()
  expect(views.map((v) => v.name)).toEqual(['My issues', 'Current sprint', 'Open bugs'])
  expect(views[2]).toEqual({
    id: 'open-bugs',
    name: 'Open bugs',
    filters: { type: ['Bug'] },
    toggles: { hideDone: false, assigneeMe: false, hideEmptyCustomers: true },
  })

  // Applying it from a clean bar brings the same filters back.
  await window.getByRole('button', { name: 'Clear' }).click()
  await expect(chips()).toHaveCount(0)
  await apply('Open bugs').click()
  await expect(chips()).toContainText('Type: Bug')
  await expect(toggle('Hide done')).toHaveAttribute('aria-pressed', 'false')
})

test('keeps the new view field open on a taken name, and Escape cancels it', async () => {
  await open()
  await createView('my ISSUES')
  await expect(window.getByRole('alert')).toContainText('already exists')
  await expect(window.getByLabel('New view name')).toHaveValue('my ISSUES')
  expect(await stored().catch(() => [])).toHaveLength(0)

  await window.getByLabel('New view name').fill('Fresh')
  await window.keyboard.press('Enter')
  await expect(apply('Fresh')).toBeVisible()
  await expect(window.getByRole('alert')).toHaveCount(0)

  await window.getByRole('button', { name: 'New view' }).click()
  await window.getByLabel('New view name').fill('Never saved')
  await window.keyboard.press('Escape')
  await expect(window.getByLabel('New view name')).toHaveCount(0)
  await expect(window.getByRole('button', { name: 'New view' })).toBeFocused()
  expect((await stored()).map((v) => v.name)).toEqual(['My issues', 'Current sprint', 'Fresh'])
})

test('renames a view inline with Enter, cancels with Escape, and restores a refused name', async () => {
  await open()
  await window.getByRole('button', { name: 'Rename view Current sprint' }).click()
  const field = window.getByLabel('Rename view Current sprint')
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('Current sprint')

  await field.fill('This sprint')
  await window.keyboard.press('Enter')
  await expect(apply('This sprint')).toBeVisible()
  await expect(apply('This sprint')).toBeFocused()
  await expect(apply('Current sprint')).toHaveCount(0)
  await expect.poll(async () => (await stored()).map((v) => v.name)).toContain('This sprint')
  // The id stays, so `jm issue list --view current-sprint` keeps working.
  expect((await stored()).map((v) => v.id)).toEqual(['my-issues', 'current-sprint'])

  await window.getByRole('button', { name: 'Rename view This sprint' }).click()
  await window.getByLabel('Rename view This sprint').fill('Discarded')
  await window.keyboard.press('Escape')
  await expect(apply('This sprint')).toBeFocused()
  await expect(apply('Discarded')).toHaveCount(0)

  // A name another view holds is refused: the list shows the old name again and says why.
  await window.getByRole('button', { name: 'Rename view This sprint' }).click()
  await window.getByLabel('Rename view This sprint').fill('my issues')
  await window.keyboard.press('Enter')
  await expect(window.getByRole('alert')).toContainText('already exists')
  await expect(apply('This sprint')).toBeVisible()
  expect((await stored()).map((v) => v.name)).toEqual(['My issues', 'This sprint'])
})

test('deletes a view only after an inline confirmation', async () => {
  await open()
  await window.getByRole('button', { name: 'Delete view My issues' }).click()
  const confirm = window.getByRole('group', { name: 'Delete view My issues' })
  await expect(confirm).toContainText('Delete “My issues”?')
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()

  await window.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  await expect(apply('My issues')).toBeFocused()
  await expect(list().getByRole('listitem')).toHaveCount(2)

  await window.getByRole('button', { name: 'Delete view My issues' }).click()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(apply('My issues')).toBeVisible()

  await window.getByRole('button', { name: 'Delete view My issues' }).click()
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(apply('My issues')).toHaveCount(0)
  await expect(apply('Current sprint')).toBeFocused()
  await expect.poll(async () => (await stored()).map((v) => v.id)).toEqual(['current-sprint'])

  await window.getByRole('button', { name: 'Delete view Current sprint' }).click()
  await window
    .getByRole('group', { name: 'Delete view Current sprint' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(window.getByText('No saved views')).toBeVisible()
  await expect.poll(stored).toEqual([])
})

test('moves between views with the arrow keys and renames with F2', async () => {
  await open()
  await apply('My issues').focus()
  await window.keyboard.press('ArrowDown')
  await expect(apply('Current sprint')).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(apply('Current sprint')).toBeFocused()
  await window.keyboard.press('ArrowUp')
  await expect(apply('My issues')).toBeFocused()

  // Letters typed into a name field are text, never shortcuts.
  await window.keyboard.press('F2')
  const field = window.getByLabel('Rename view My issues')
  await expect(field).toBeFocused()
  await field.fill('')
  await window.keyboard.type('jk Mine')
  await window.keyboard.press('Enter')
  await expect(apply('jk Mine')).toBeFocused()
  await expect(tree()).not.toBeFocused()
})

test('shows a view that was added to the file by another program', async () => {
  await open()
  const views = await stored().catch(() => null)
  expect(views).toBeNull()
  // Created in the app first, so the file exists; then a second writer appends, as the CLI would.
  await createView('First')
  await expect(apply('First')).toBeVisible()
  const file = await stored()
  await writeFile(
    join(stateDir, 'views.json'),
    JSON.stringify([
      ...file,
      { id: 'cli', name: 'From the CLI', filters: {}, toggles: file[0]?.toggles },
    ]),
  )
  // A window focus refetches the list.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send('window:focus', false)
    win?.webContents.send('window:focus', true)
  })
  await expect(apply('From the CLI')).toBeVisible()
})
