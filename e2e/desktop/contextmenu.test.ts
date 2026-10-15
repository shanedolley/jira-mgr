import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { SITE, counts, inboxChange, joinSprint, launch, logIn, releaseEdit } from './harness.js'

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
const menu = () => window.getByRole('menu')
const entry = (name: string) => menu().getByRole('menuitem', { name, exact: true })
const option = (name: string | RegExp) => window.getByRole('option', { name })
const dialog = (name: string) => window.getByRole('dialog', { name })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under a click.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Makes the row active, then closes the Peek the click opened: the state a key starts from. */
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

/** The menu's items in order, each as its label and the keycap beside it. */
const entries = () =>
  menu()
    .getByRole('menuitem')
    .evaluateAll((items) =>
      items.map(
        (el) =>
          `${el.querySelector('span')?.textContent ?? ''}|${el.querySelector('kbd')?.textContent ?? ''}`,
      ),
    )

const ALL = [
  'View full screen|↵',
  'Status|S',
  'Assignee|A',
  'Start date|',
  'Due date|⇧D',
  'Sprint|⇧C',
  'Rename|E',
  'Parent|⇧P',
  'Type|',
  'Labels|L',
  'Priority|P',
  'Original estimate|⇧E',
  'Log work|',
  'Related issues|',
  'Copy|',
  'Open in Jira|',
  'Add comment|',
  'Delete|',
]

test('right-click on a Tree row opens the menu at the pointer without selecting the row or opening the Peek', async () => {
  await open()
  await select(/PSAPAC-3,/)
  // The first row, so the whole menu fits below the pointer.
  const box = await item(/PSAPAC-10,/).boundingBox()
  const x = (box?.x ?? 0) + 120
  const y = (box?.y ?? 0) + 10

  await window.mouse.click(x, y, { button: 'right' })
  await expect(menu()).toBeVisible()
  await expect(menu()).toHaveAccessibleName('Actions for PSAPAC-10')
  expect((await entries()).map((e) => e.split('|')[0])).toContain('Status')
  // The menu opens at the pointer.
  const shown = await menu().boundingBox()
  expect(Math.abs((shown?.x ?? 0) - x)).toBeLessThanOrEqual(1)
  expect(Math.abs((shown?.y ?? 0) - y)).toBeLessThanOrEqual(1)
  // The selection and the Peek stay where they were.
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')
  await expect(item(/PSAPAC-10,/)).toHaveAttribute('data-active', 'false')
  await expect(peek()).toHaveCount(0)

  // Esc closes it and the Tree has focus again.
  await window.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  expect(await writes()).toBe(0)
})

test('the menu stays inside a small window when the pointer is at its edge', async () => {
  await open()
  await window.setViewportSize({ width: 1000, height: 420 })
  const box = await item(/PSAPAC-3,/).boundingBox()
  await window.mouse.click((box?.x ?? 0) + (box?.width ?? 0) - 4, (box?.y ?? 0) + 10, {
    button: 'right',
  })
  await expect(menu()).toBeVisible()
  const shown = await menu().boundingBox()
  expect((shown?.x ?? 0) + (shown?.width ?? 0)).toBeLessThanOrEqual(1000)
  expect((shown?.y ?? 0) + (shown?.height ?? 0)).toBeLessThanOrEqual(420)
  expect(shown?.x).toBeGreaterThanOrEqual(0)
  expect(shown?.y).toBeGreaterThanOrEqual(0)
})

test('changes a status from the menu, closes it and keeps the row active', async () => {
  await open()
  await select(/PSAPAC-3,/)
  await item(/PSAPAC-4,/).click({ button: 'right' })
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/In Progress/)

  await entry('Status').click()
  await option('To Do').click()

  // Optimistic: the row shows it before Jira answers, and the menu is gone.
  await expect(menu()).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/To Do/)
  await settle(1)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')
})

test('sets a due date from the menu with one write', async () => {
  await open()
  await item(/PSAPAC-4,/).click({ button: 'right' })

  await entry('Due date').click()
  const due = menu().getByRole('textbox', { name: 'Due date' })
  await expect(due).toBeFocused()
  await due.fill('2026-12-24')
  await window.keyboard.press('Enter')

  await expect(menu()).toHaveCount(0)
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { duedate: '2026-12-24' } })
})

test('Esc in the date field abandons the edit and returns to the menu', async () => {
  await open()
  await item(/PSAPAC-4,/).click({ button: 'right' })
  await entry('Due date').click()
  await menu().getByRole('textbox', { name: 'Due date' }).fill('2026-12-24')

  await window.keyboard.press('Escape')
  await expect(menu().getByRole('textbox', { name: 'Due date' })).toBeHidden()
  await expect(menu()).toBeVisible()
  await expect(entry('Due date')).toBeFocused()
  await window.waitForTimeout(200)
  expect(await writes()).toBe(0)
})

test('cancelling the delete leaves the issue, writes nothing and returns focus to the Tree', async () => {
  await open()
  await item(/PSAPAC-4,/).click({ button: 'right' })

  await entry('Delete').click()
  const confirm = dialog('Delete PSAPAC-4?')
  await expect(confirm).toBeVisible()
  await expect(menu()).toHaveCount(0)
  await confirm.getByRole('button', { name: 'Cancel' }).click()

  await expect(confirm).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).toBeVisible()
  await expect(tree()).toBeFocused()
  expect(await writes()).toBe(0)
})

test('opens the same menu on a Sprint page row and returns focus to that row', async () => {
  await joinSprint(app, ['PSAPAC-4', 'PSAPAC-13'], 5)
  await open()
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Current Sprint 5' })
    .click()
  await expect(sprintPage()).toBeVisible()
  const row = sprintPage().getByRole('button', { name: /^PSAPAC-4\b/ })

  await row.click({ button: 'right' })
  await expect(menu()).toBeVisible()
  await expect(menu()).toHaveAccessibleName('Actions for PSAPAC-4')
  expect(await entries()).toEqual(ALL)
  // The page stays open under it.
  await expect(sprintPage()).toBeVisible()

  await entry('Priority').click()
  await option(/^High\b/).click()
  await expect(menu()).toHaveCount(0)
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { priority: { id: '2' } } })
  await expect(row).toBeFocused()
})

test('opens on an Epics page row, listing what an Epic allows', async () => {
  await open()
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /^Epics/ })
    .click()
  const epics = window.getByRole('region', { name: 'Epics' })
  await expect(epics).toBeVisible()
  await epics.getByRole('row', { name: /PSAPAC-10/ }).click({ button: 'right' })
  await expect(menu()).toHaveAccessibleName('Actions for PSAPAC-10')
  // An Epic has no sprint, parent, type change, estimate or worklog.
  expect((await entries()).map((e) => e.split('|')[0])).toEqual([
    'View full screen',
    'Status',
    'Assignee',
    'Start date',
    'Due date',
    'Rename',
    'Labels',
    'Priority',
    'Related issues',
    'Copy',
    'Open in Jira',
    'Add comment',
    'Delete',
  ])
  await window.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
})

test('opens on an Inbox row without opening the entry or marking it read', async () => {
  await inboxChange(app, 'PSAPAC-2', 'other', [
    { field: 'status', fromString: 'To Do', toString: 'In Progress' },
  ])
  await open()
  await window.getByRole('link', { name: /^Inbox/ }).click()
  const entry2 = window
    .getByRole('region', { name: 'Inbox' })
    .getByRole('button', { name: /PSAPAC-2/ })
  await expect(entry2).toBeVisible()

  await entry2.click({ button: 'right' })
  await expect(menu()).toHaveAccessibleName('Actions for PSAPAC-2')
  // Right-click does not open the entry's page or mark it read.
  await expect(issuePage()).toHaveCount(0)
  await expect(entry2).toHaveAttribute('data-unread', '')
  await window.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
  await expect(entry2).toBeFocused()
})

test('arrows move, Right opens a submenu, Left closes it, and a listed key runs its item', async () => {
  await open()
  await item(/PSAPAC-4,/).click({ button: 'right' })
  await expect(menu()).toBeFocused()

  await window.keyboard.press('ArrowDown')
  await expect(entry('View full screen')).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(entry('Status')).toBeFocused()
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('ArrowUp')
  // Up from the first item wraps to the last.
  await expect(entry('Delete')).toBeFocused()
  await window.keyboard.press('Home')
  await expect(entry('View full screen')).toBeFocused()
  await window.keyboard.press('End')
  await expect(entry('Delete')).toBeFocused()

  await entry('Priority').focus()
  await window.keyboard.press('ArrowRight')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeFocused()
  await window.keyboard.press('ArrowLeft')
  await expect(window.getByRole('listbox')).toHaveCount(0)
  await expect(entry('Priority')).toBeFocused()
  await expect(menu()).toBeVisible()

  // Typing a listed key runs that item: S opens Status.
  await window.keyboard.press('s')
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(entry('Status')).toBeFocused()
  await window.keyboard.press('l')
  await expect(window.getByRole('combobox', { name: 'Search Labels' })).toBeFocused()
})

test('Enter on an item opens its submenu', async () => {
  await open()
  await item(/PSAPAC-3,/).click({ button: 'right' })
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowDown')
  await expect(entry('Status')).toBeFocused()
  await window.keyboard.press('Enter')
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(entry('Status')).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowDown')
  await expect(entry('Start date')).toBeFocused()
})

test('Shift+D, Shift+P, Shift+E and Shift+C open due date, parent, estimate and sprint, not P, E or C', async () => {
  await open()
  await select(/PSAPAC-4,/)

  await window.keyboard.press('Shift+D')
  await expect(menu()).toBeVisible()
  await expect(menu().getByRole('textbox', { name: 'Due date' })).toBeFocused()
  await window.keyboard.press('Escape')
  await window.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
  await expect(tree()).toBeFocused()

  await window.keyboard.press('Shift+P')
  await expect(window.getByRole('combobox', { name: 'Search Parent' })).toBeFocused()
  await window.keyboard.press('Escape')
  await window.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)

  await window.keyboard.press('Shift+E')
  await expect(menu().getByRole('textbox', { name: 'Original estimate' })).toBeFocused()
  await window.keyboard.press('Escape')
  await window.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)

  await window.keyboard.press('Shift+C')
  await expect(window.getByRole('listbox', { name: 'Sprint' })).toBeFocused()
  await window.keyboard.press('Escape')
  await window.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)

  // None of them fell through to Priority, the summary editor or the create dialog.
  await expect(window.getByRole('dialog')).toHaveCount(0)
  await expect(peek()).toHaveCount(0)
  expect(await writes()).toBe(0)
})

test('Shift+C does nothing on an Epic, which has no sprint', async () => {
  await open()
  await select(/PSAPAC-10,/)
  await window.keyboard.press('Shift+C')
  await window.waitForTimeout(150)
  await expect(menu()).toHaveCount(0)
  await expect(window.getByRole('dialog')).toHaveCount(0)
})

test('sets the estimate from Shift+E with one write', async () => {
  await open()
  await select(/PSAPAC-4,/)
  await window.keyboard.press('Shift+E')
  const field = menu().getByRole('textbox', { name: 'Original estimate' })
  await expect(field).toHaveValue('2h')
  await field.fill('3h 30m')
  await window.keyboard.press('Enter')
  await expect(menu()).toHaveCount(0)
  await settle(1)
  expect(await lastBody()).toEqual({
    fields: {},
    update: { timetracking: [{ edit: { originalEstimate: '3h 30m' } }] },
  })
})

test('Shift+D on the issue page focuses the Due date field there', async () => {
  await open()
  await select(/PSAPAC-4,/)
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  await window.keyboard.press('Shift+D')
  await expect(issuePage().getByLabel('Due date')).toBeFocused()
  await expect(menu()).toHaveCount(0)
})

test('Rename saves a new summary through the menu', async () => {
  await open()
  await item(/PSAPAC-4,/).click({ button: 'right' })
  await entry('Rename').click()
  const field = menu().getByRole('textbox', { name: 'Summary' })
  await expect(field).toHaveValue('Migrate the dashboards')
  await field.fill('Migrate every dashboard')
  await window.keyboard.press('Enter')
  await expect(menu()).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/Migrate every dashboard/)
  await settle(1)
})

test('View full screen, Add comment, Log work and Related issues open the issue page at their control', async () => {
  await open()
  await item(/PSAPAC-4,/).click({ button: 'right' })
  await entry('View full screen').click()
  await expect(issuePage()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)

  await item(/PSAPAC-4,/).click({ button: 'right' })
  await entry('Add comment').click()
  await expect(issuePage().getByRole('textbox', { name: 'New comment' })).toBeFocused()
  await window.getByRole('button', { name: 'Back to issues' }).click()

  await item(/PSAPAC-4,/).click({ button: 'right' })
  await entry('Log work').click()
  await expect(issuePage().getByRole('form', { name: 'Add worklog' })).toBeVisible()
  await window.getByRole('button', { name: 'Back to issues' }).click()

  await item(/PSAPAC-4,/).click({ button: 'right' })
  await entry('Related issues').click()
  await expect(issuePage().getByRole('form', { name: 'Add link' })).toBeVisible()
})

test('Open in Jira opens the issue in the browser', async () => {
  await open()
  await item(/PSAPAC-4,/).click({ button: 'right' })
  await entry('Open in Jira').click()
  await expect
    .poll(async () => (await counts(app)).openExternal)
    .toEqual([`${SITE}/browse/PSAPAC-4`])
  await expect(menu()).toHaveCount(0)
})

test('Copy opens the create dialog seeded from the issue and leaves the source unchanged', async () => {
  await open()
  const before = await counts(app)
  await item(/PSAPAC-4,/).click({ button: 'right' })
  await entry('Copy').click()

  const form = dialog('New issue')
  await expect(form).toBeVisible()
  await expect(form.getByLabel('Summary')).toHaveValue('Copy of Migrate the dashboards')
  await expect(form.getByRole('button', { name: 'Type: Story' })).toBeVisible()
  await expect(
    form.getByRole('button', { name: 'Parent: PSAPAC-10 Customer onboarding' }),
  ).toBeVisible()
  await expect(form.getByRole('button', { name: 'Customer: Acme' })).toBeVisible()
  // The assignee follows the create default, not the source's.
  await expect(form.getByRole('button', { name: 'Assignee: Test User' })).toBeVisible()
  await form.getByRole('button', { name: 'Create issue' }).click()
  await expect.poll(writes).toBe(before.edits + 1)
  expect(await lastBody()).toMatchObject({
    fields: {
      issuetype: { name: 'Story' },
      summary: 'Copy of Migrate the dashboards',
      parent: { key: 'PSAPAC-10' },
      timetracking: { originalEstimate: '2h' },
    },
  })
  await releaseEdit(app)
  await expect(form).toHaveCount(0)
  // The source was not written: only the create went out.
  expect((await counts(app)).editBodies).toHaveLength(before.editBodies.length + 1)
})

for (const press of ['ContextMenu', 'Shift+F10']) {
  test(`${press} opens the menu of the active row, below it`, async () => {
    await open()
    await select(/PSAPAC-3,/)
    await window.keyboard.press(press)
    await expect(menu()).toBeVisible()
    await expect(menu()).toHaveAccessibleName('Actions for PSAPAC-3')
    const row = await item(/PSAPAC-3,/).boundingBox()
    const shown = await menu().boundingBox()
    expect(shown?.x).toBeGreaterThanOrEqual(row?.x ?? 0)
    await window.keyboard.press('Escape')
    await expect(menu()).toHaveCount(0)
    await expect(tree()).toBeFocused()
  })
}

test('Shift+F10 on a focused Sprint page row opens its menu', async () => {
  await joinSprint(app, ['PSAPAC-4', 'PSAPAC-13'], 5)
  await open()
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Current Sprint 5' })
    .click()
  const row = sprintPage().getByRole('button', { name: /^PSAPAC-13\b/ })
  await row.focus()
  await window.keyboard.press('Shift+F10')
  await expect(menu()).toHaveAccessibleName('Actions for PSAPAC-13')
  await window.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
  await expect(row).toBeFocused()
})
