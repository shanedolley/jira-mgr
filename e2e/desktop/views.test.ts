import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { launch, logIn, readState } from './harness.js'

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
/** `views.json`, or `null` before the app first writes it. A rename or delete shows, then writes. */
const storedOrAbsent = () => readState<StoredView[]>(stateDir, 'views.json')
const settings = () => readState<{ toggles: Record<string, boolean> }>(stateDir, 'settings.json')

const STARTERS = ['My issues', 'Created by me', 'Current sprint', 'Active', 'Backlog']

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const toggle = (name: string) => window.getByRole('button', { name, exact: true })
const list = () => window.getByRole('list', { name: 'Saved views' })
const tabs = () => window.getByRole('group', { name: 'View tabs' })
const tab = (name: string) => tabs().getByRole('button', { name, exact: true })
const apply = (name: string) => list().getByRole('button', { name, exact: true })
const update = (name: string) =>
  window.getByRole('button', { name: `Update view ${name}`, exact: true })
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
  await expect(list().getByRole('listitem')).toHaveCount(5)

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
  await expect.poll(async () => (await settings())?.toggles.assigneeMe).toBe(true)

  // Changing a toggle or a filter leaves the view.
  await toggle('Assignee: me').click()
  await expect(apply('My issues')).not.toHaveAttribute('aria-current', 'true')
})

test('highlights Issues only when no saved view matches', async () => {
  await open()
  const issues = window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /^Issues/ })
  await expect(issues).toHaveAttribute('aria-current', 'page')
  const current = await issues.evaluate((el) => getComputedStyle(el).backgroundColor)

  await apply('My issues').click()
  await expect(apply('My issues')).toHaveAttribute('aria-current', 'true')
  await expect(issues).not.toHaveAttribute('aria-current')
  await expect(issues).not.toHaveClass(/is-current/)
  // One item is lit: the view, by fill and weight, with no edge or bar.
  const lit = await apply('My issues')
    .locator('xpath=..')
    .evaluate((el) => {
      const s = getComputedStyle(el)
      return {
        fill: s.backgroundColor,
        weight: s.fontWeight,
        shadow: s.boxShadow,
        left: s.borderLeftWidth,
      }
    })
  expect(lit).toEqual({ fill: current, weight: '500', shadow: 'none', left: '0px' })

  // Leaving the view gives the highlight back to Issues.
  await toggle('Assignee: me').click()
  await expect(issues).toHaveAttribute('aria-current', 'page')
  await expect(apply('My issues')).not.toHaveAttribute('aria-current', 'true')
})

test('creates a view from the filter bar, and the file the CLI reads holds it', async () => {
  await open()
  await filterToBugs()
  await toggle('Hide done').click()

  await createView('  Open bugs ')

  await expect(apply('Open bugs')).toBeVisible()
  await expect(apply('Open bugs')).toHaveAttribute('aria-current', 'true')
  // A create waits for main, which answers once the file is written, so the row means it landed.
  const views = await stored()
  expect(views.map((v) => v.name)).toEqual([...STARTERS, 'Open bugs'])
  expect(views[5]).toEqual({
    id: 'open-bugs',
    name: 'Open bugs',
    filters: { type: ['Bug'] },
    toggles: { hideDone: false, assigneeMe: false, hideEmptyCustomers: true },
    display: { properties: ['updated'], order: 'key', direction: 'desc' },
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
  expect(await storedOrAbsent()).toBeNull()

  await window.getByLabel('New view name').fill('Fresh')
  await window.keyboard.press('Enter')
  await expect(apply('Fresh')).toBeVisible()
  await expect(window.getByRole('alert')).toHaveCount(0)

  await window.getByRole('button', { name: 'New view' }).click()
  await window.getByLabel('New view name').fill('Never saved')
  await window.keyboard.press('Escape')
  await expect(window.getByLabel('New view name')).toHaveCount(0)
  await expect(window.getByRole('button', { name: 'New view' })).toBeFocused()
  expect((await stored()).map((v) => v.name)).toEqual([...STARTERS, 'Fresh'])
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
  await expect
    .poll(async () => (await storedOrAbsent())?.map((v) => v.name))
    .toContain('This sprint')
  // The id stays, so `jm issue list --view current-sprint` keeps working.
  expect((await stored()).map((v) => v.id)).toEqual([
    'my-issues',
    'created-by-me',
    'current-sprint',
    'active',
    'backlog',
  ])

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
  expect((await stored()).map((v) => v.name)).toEqual([
    'My issues',
    'Created by me',
    'This sprint',
    'Active',
    'Backlog',
  ])
})

test('ignores a blank rename, leaving the name and the file as they were', async () => {
  await open()
  await createView('Keep me')
  await expect(apply('Keep me')).toBeVisible()
  const before = await stored()

  await window.getByRole('button', { name: 'Rename view Keep me' }).click()
  await window.getByLabel('Rename view Keep me').fill('   ')
  await window.keyboard.press('Enter')

  await expect(apply('Keep me')).toBeFocused()
  await expect(window.getByRole('alert')).toHaveCount(0)
  await expect(list().getByRole('listitem')).toHaveCount(6)
  expect(await stored()).toEqual(before)
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
  await expect(list().getByRole('listitem')).toHaveCount(5)

  await window.getByRole('button', { name: 'Delete view My issues' }).click()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(apply('My issues')).toBeVisible()

  await window.getByRole('button', { name: 'Delete view My issues' }).click()
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(apply('My issues')).toHaveCount(0)
  await expect(apply('Created by me')).toBeFocused()
  await expect
    .poll(async () => (await storedOrAbsent())?.map((v) => v.id))
    .toEqual(['created-by-me', 'current-sprint', 'active', 'backlog'])

  for (const name of ['Created by me', 'Current sprint', 'Active', 'Backlog']) {
    await window.getByRole('button', { name: `Delete view ${name}` }).click()
    await window
      .getByRole('group', { name: `Delete view ${name}` })
      .getByRole('button', { name: 'Delete', exact: true })
      .click()
    await expect(apply(name)).toHaveCount(0)
  }
  await expect(window.getByText('No saved views')).toBeVisible()
  await expect.poll(storedOrAbsent).toEqual([])
})

test('moves between views with the arrow keys and renames with F2', async () => {
  await open()
  await apply('My issues').focus()
  await window.keyboard.press('ArrowDown')
  await expect(apply('Created by me')).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(apply('Current sprint')).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowDown')
  await expect(apply('Backlog')).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(apply('Backlog')).toBeFocused()
  for (let i = 0; i < 4; i++) await window.keyboard.press('ArrowUp')
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
  expect(await storedOrAbsent()).toBeNull()
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

test('seeds Active and Backlog for a new user, and each filters by status', async () => {
  await open()
  await apply('Active').click()
  await expect(chips()).toContainText('Status: In Progress, Review')
  await expect(apply('Active')).toHaveAttribute('aria-current', 'true')

  await apply('Backlog').click()
  await expect(chips()).toContainText('Status: Opportunity, To Do, Hold')
  await expect(apply('Backlog')).toHaveAttribute('aria-current', 'true')
  expect(await storedOrAbsent()).toBeNull()
})

test('shows the views as tabs over the list, and a tab applies its view', async () => {
  await open()
  await expect(tabs().getByRole('button')).toHaveText(STARTERS)

  await tab('Current sprint').click()
  await expect(chips()).toContainText('Sprint: Current sprint')
  await expect(tab('Current sprint')).toHaveAttribute('aria-current', 'true')
  await expect(apply('Current sprint')).toHaveAttribute('aria-current', 'true')
  await expect(tab('My issues')).not.toHaveAttribute('aria-current', 'true')
  await expect(item(/PSAPAC-13,/)).toBeVisible()
  await expect(tree()).toBeFocused()

  // A view made in the sidebar joins the tabs, and a delete leaves them.
  await createView('Fresh')
  await expect(tab('Fresh')).toBeVisible()
  await window.getByRole('button', { name: 'Delete view Fresh' }).click()
  await window
    .getByRole('group', { name: 'Delete view Fresh' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(tab('Fresh')).toHaveCount(0)
})

test('updates a view with the current filters, in place, and the file the CLI reads holds them', async () => {
  await open()
  await apply('Active').click()
  await expect(update('Active')).toBeDisabled()

  await filterToBugs()
  await expect(apply('Active')).not.toHaveAttribute('aria-current', 'true')
  await expect(update('Active')).toBeEnabled()
  await update('Active').click()

  await expect(apply('Active')).toHaveAttribute('aria-current', 'true')
  await expect(update('Active')).toBeDisabled()
  // The button that was pressed is now disabled, so focus goes to the view, not the page.
  await expect(apply('Active')).toBeFocused()
  const views = await stored()
  expect(views.map((v) => v.id)).toEqual([
    'my-issues',
    'created-by-me',
    'current-sprint',
    'active',
    'backlog',
  ])
  expect(views[3]).toEqual({
    id: 'active',
    name: 'Active',
    filters: { status: ['In Progress', 'Review'], type: ['Bug'] },
    toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
    display: { properties: ['updated'], order: 'key', direction: 'desc' },
  })
})

test('duplicates a view to just after it, with the same filters', async () => {
  await open()
  await window.getByRole('button', { name: 'Duplicate view Active', exact: true }).click()

  await expect(apply('Active copy')).toBeFocused()
  await expect(tab('Active copy')).toBeVisible()
  const views = await stored()
  expect(views.map((v) => v.name)).toEqual([
    'My issues',
    'Created by me',
    'Current sprint',
    'Active',
    'Active copy',
    'Backlog',
  ])
  expect(views[4]).toEqual({ ...views[3], id: 'active-copy', name: 'Active copy' })

  await window.getByRole('button', { name: 'Duplicate view Active', exact: true }).click()
  await expect(apply('Active copy 2')).toBeVisible()
})

test('lights the copy you applied, not its identical original', async () => {
  await open()
  await window.getByRole('button', { name: 'Duplicate view Active', exact: true }).click()
  await expect(apply('Active copy')).toBeVisible()

  await apply('Active copy').click()
  for (const lit of [apply('Active copy'), tab('Active copy')]) {
    await expect(lit).toHaveAttribute('aria-current', 'true')
  }
  for (const unlit of [apply('Active'), tab('Active')]) {
    await expect(unlit).not.toHaveAttribute('aria-current', 'true')
  }
  // Both equal the bar, so neither has anything to update.
  await expect(update('Active copy')).toBeDisabled()
  await expect(update('Active')).toBeDisabled()

  await tab('Active').click()
  await expect(tab('Active')).toHaveAttribute('aria-current', 'true')
  await expect(apply('Active')).toHaveAttribute('aria-current', 'true')
  await expect(tab('Active copy')).not.toHaveAttribute('aria-current', 'true')
  await expect(apply('Active copy')).not.toHaveAttribute('aria-current', 'true')
})

test('does not light a new view that reuses the id of an applied view that was deleted', async () => {
  await open()
  const duplicateActive = () =>
    window.getByRole('button', { name: 'Duplicate view Active', exact: true }).click()
  await duplicateActive()
  await apply('Active copy').click()
  await expect(apply('Active copy')).toHaveAttribute('aria-current', 'true')

  await window.getByRole('button', { name: 'Delete view Active copy' }).click()
  await window
    .getByRole('group', { name: 'Delete view Active copy' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(apply('Active copy')).toHaveCount(0)
  await expect(apply('Active')).toHaveAttribute('aria-current', 'true')

  // The bar still equals Active, and the new copy has the old copy's id.
  await duplicateActive()
  await expect(apply('Active copy')).toBeVisible()
  await expect(apply('Active copy')).not.toHaveAttribute('aria-current', 'true')
  await expect(tab('Active copy')).not.toHaveAttribute('aria-current', 'true')
  await expect(apply('Active')).toHaveAttribute('aria-current', 'true')
})

/** The view names in the sidebar, top to bottom. */
const sidebarOrder = () =>
  list().evaluate((ul) =>
    [...ul.querySelectorAll<HTMLElement>('[data-view-apply]')].map((b) => b.dataset.viewApply),
  )

test('reorders with Alt and the arrow keys, and the order survives a restart', async () => {
  await open()
  await apply('Backlog').focus()
  await window.keyboard.press('Alt+ArrowUp')
  // Focus follows the view once the new order shows, and the next press moves it again.
  await expect.poll(async () => (await sidebarOrder())[3]).toBe('backlog')
  await expect(apply('Backlog')).toBeFocused()
  await window.keyboard.press('Alt+ArrowUp')
  await expect
    .poll(sidebarOrder)
    .toEqual(['my-issues', 'created-by-me', 'backlog', 'current-sprint', 'active'])
  await expect(apply('Backlog')).toBeFocused()
  await expect(tabs().getByRole('button')).toHaveText([
    'My issues',
    'Created by me',
    'Backlog',
    'Current sprint',
    'Active',
  ])
  await expect
    .poll(async () => (await storedOrAbsent())?.map((v) => v.id))
    .toEqual(['my-issues', 'created-by-me', 'backlog', 'current-sprint', 'active'])

  // The top view cannot go higher, and the bottom one cannot go lower.
  await apply('My issues').focus()
  await window.keyboard.press('Alt+ArrowUp')
  await apply('Active').focus()
  await window.keyboard.press('Alt+ArrowDown')
  await expect(apply('Active')).toBeFocused()

  await app.close()
  ;({ app, window } = await launch(stateDir))
  await open()
  await expect
    .poll(sidebarOrder)
    .toEqual(['my-issues', 'created-by-me', 'backlog', 'current-sprint', 'active'])
  await expect(tabs().getByRole('button').nth(2)).toHaveText('Backlog')
})

test('reorders by dragging a view onto another, and the file holds the order', async () => {
  await open()
  // The drag carries its own type and no text, so a text field has nothing to take. A listener on
  // the document runs after the row's own dragstart handler and records what it put on the drag.
  await window.evaluate(() => {
    document.addEventListener('dragstart', (event) => {
      ;(window as unknown as { dragTypes: string[] }).dragTypes = [
        ...(event.dataTransfer?.types ?? []),
      ]
    })
  })
  await apply('Backlog').dragTo(apply('My issues'))
  const types = await window.evaluate(
    () => (window as unknown as { dragTypes: string[] }).dragTypes,
  )
  expect(types).toContain('application/x-jm-view')
  expect(types).not.toContain('text/plain')
  await expect
    .poll(sidebarOrder)
    .toEqual(['backlog', 'my-issues', 'created-by-me', 'current-sprint', 'active'])
  await expect
    .poll(async () => (await storedOrAbsent())?.map((v) => v.id))
    .toEqual(['backlog', 'my-issues', 'created-by-me', 'current-sprint', 'active'])

  // Down the list the view lands on the row it was dropped on.
  await apply('Backlog').dragTo(apply('Current sprint'))
  await expect
    .poll(async () => (await storedOrAbsent())?.map((v) => v.id))
    .toEqual(['my-issues', 'created-by-me', 'current-sprint', 'backlog', 'active'])
})
