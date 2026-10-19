import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { counts, launch, logIn, releaseDone, showEverything } from './harness.js'

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
const chips = () => window.getByRole('list', { name: 'Active filters' })
const menu = () => window.locator('#filter-menu')
const toggle = (name: string) => window.getByRole('button', { name, exact: true })

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // Subtasks show only from the Everything level.
  await showEverything(window)
}

/** The row of one field in the main list. A held count follows the name. */
const row = (name: string) => menu().getByRole('button', { name: new RegExp(`^${name}( \\d+)?$`) })

/** The search box of one submenu, by its accessible name. */
const search = (label: string) => window.getByLabel(label, { exact: true })

/** The submenu of one field's values. */

const submenu = (name: string) => menu().getByRole('group', { name, exact: true })

/** Opens the Filter menu with the button and clicks one field, which opens its values. */
async function openField(name: string) {
  if (!(await menu().evaluate((el) => el.matches(':popover-open')))) {
    await toggle('Filter').click()
  }
  if (!(await submenu(name).isVisible())) await row(name).click()
  await expect(submenu(name)).toBeVisible()
}

/** Closes the submenu with the first Escape and the Filter menu with the second. */
async function closeMenus() {
  await window.keyboard.press('Escape')
  await window.keyboard.press('Escape')
  await expect(menu()).not.toBeVisible()
}

/** Checks one choice of one field, under "is not" when `not` is set, then closes both menus. */
async function choose(field: string, choice: string, options: { not?: boolean } = {}) {
  await openField(field)
  const list = submenu(field)
  const operators = list.getByRole('group', { name: `${field} operator` })
  // The switch keeps its setting between choices, so each choice sets it.
  if ((await operators.count()) > 0) {
    await operators
      .getByRole('button', { name: options.not === true ? 'is not' : 'is', exact: true })
      .click()
  }
  await list.getByRole('checkbox', { name: choice, exact: true }).check()
  await closeMenus()
}

test('F opens the Filter menu on its first field, and Esc returns to the Tree', async () => {
  await open()
  await expect(tree()).toBeFocused()

  await window.keyboard.press('f')
  await expect(menu()).toBeVisible()
  await expect(menu().locator('[data-filter-field]').first()).toBeFocused()
  await expect(menu().locator('[data-filter-field]')).toHaveCount(15)

  await window.keyboard.press('Escape')
  await expect(menu()).not.toBeVisible()
  await expect(tree()).toBeFocused()
})

test('F is a letter in the filter field, and does nothing on a toolbar button', async () => {
  await open()
  const field = window.getByLabel('Filter by key or summary')
  await field.focus()
  await field.press('f')
  await expect(field).toHaveValue('f')
  await expect(menu()).not.toBeVisible()

  await field.fill('')
  await toggle('Hide done').focus()
  await window.keyboard.press('f')
  await expect(menu()).not.toBeVisible()
})

test('the Customer choices list the Project’s Customers, those with no issue included', async () => {
  await open()
  await openField('Customer')
  await expect(menu().getByRole('checkbox', { name: 'Zeta Corp', exact: true })).toBeVisible()
  await expect(menu().getByRole('checkbox', { name: 'Acme', exact: true })).toBeVisible()
  await closeMenus()

  await choose('Customer', 'Beta Ltd')
  await expect(chips()).toContainText('Customer: Beta Ltd')
  await expect(item(/PSAPAC-40,/)).toBeVisible()
  await expect(item(/PSAPAC-4,/)).toHaveCount(0)
})

test('Overdue lists open issues due before today', async () => {
  await open()
  await releaseDone(app)
  await expect.poll(async () => (await counts(app)).searches.done).toBeGreaterThan(0)
  // PSAPAC-22 is Done and past due, so only the open-issue rule keeps it out.
  await toggle('Hide done').click()
  await expect(item(/PSAPAC-22,/)).toBeVisible()

  await choose('Due date', 'Overdue')

  await expect(chips()).toContainText('Due date: Overdue')
  await expect(item(/PSAPAC-40,/)).toBeVisible()
  await expect(item(/PSAPAC-22,/)).toHaveCount(0)
  // PSAPAC-31 is due in the year 2999, and PSAPAC-2 has no due date.
  await expect(item(/PSAPAC-31,/)).toHaveCount(0)
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)
})

test('"is not" leaves out the checked values and draws its own chip', async () => {
  await open()

  await choose('Status', 'To Do', { not: true })

  await expect(chips()).toContainText('Status is not: To Do')
  await expect(item(/PSAPAC-4,/)).toBeVisible()
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)

  // "is" and "is not" are separate chips on the same field.
  await choose('Status', 'In Progress')
  await expect(chips()).toContainText('Status: In Progress')
  await expect(chips()).toContainText('Status is not: To Do')
  await expect(item(/PSAPAC-4,/)).toBeVisible()

  await window.getByRole('button', { name: 'Remove Status is not filter' }).click()
  await expect(chips()).not.toContainText('Status is not')
  await expect(chips()).toContainText('Status: In Progress')
})

test('Creator, Epic, Relations and Status type each filter the Tree', async () => {
  await open()

  // PSAPAC-11, 31 and 32 were created by the other user. PSAPAC-11 stays as context for its
  // Subtask PSAPAC-12, which the signed-in user created.
  await choose('Creator', 'Me')
  await expect(chips()).toContainText('Creator: Me')
  await expect(item(/PSAPAC-2,/)).toBeVisible()
  await expect(item(/PSAPAC-12,/)).toBeVisible()
  await expect(item(/PSAPAC-11,.*context/)).toBeVisible()
  await expect(item(/PSAPAC-32,/)).toHaveCount(0)
  await window.getByRole('button', { name: 'Remove Creator filter' }).click()

  await choose('Epic', 'PSAPAC-30 Reporting')
  await expect(chips()).toContainText('Epic: PSAPAC-30 Reporting')
  await expect(item(/PSAPAC-31,/)).toBeVisible()
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)
  await window.getByRole('button', { name: 'Remove Epic filter' }).click()

  // PSAPAC-1 blocks PSAPAC-2 in the fake Jira.
  await choose('Relations', 'Blocked')
  await expect(item(/PSAPAC-2,/)).toBeVisible()
  await expect(item(/PSAPAC-3,/)).toHaveCount(0)
  await window.getByRole('button', { name: 'Remove Relations filter' }).click()
  await choose('Relations', 'Blocking')
  await expect(item(/PSAPAC-1,/)).toBeVisible()
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)
  await window.getByRole('button', { name: 'Remove Relations filter' }).click()

  await choose('Status type', 'In Progress')
  await expect(chips()).toContainText('Status type: In Progress')
  await expect(item(/PSAPAC-4,/)).toBeVisible()
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)
})

test('Priority, Engagement and the Created and Updated windows each show as a chip', async () => {
  await open()

  await choose('Priority', 'Medium')
  await choose('Engagement', 'South')
  await choose('Created', 'Today')
  await choose('Updated', 'Today')

  await expect(chips()).toContainText('Priority: Medium')
  await expect(chips()).toContainText('Engagement: South')
  await expect(chips()).toContainText('Created: Today')
  await expect(chips()).toContainText('Updated: Today')
  // The fake's issues were created and updated in 2026-10-01 and 2026-10-02, so none was today,
  // and the Tree names the cause.
  await expect(window.getByText(/^No issues match/)).toBeVisible()
  await window.getByRole('button', { name: 'Clear filters' }).click()
  await expect(chips()).toHaveCount(0)
})

interface StoredView {
  id: string
  name: string
  filters: Record<string, unknown>
}

const stored = async () =>
  JSON.parse(await readFile(join(stateDir, 'views.json'), 'utf8')) as StoredView[]

test('a saved view stores the new filters, and applying it brings the chips back', async () => {
  await open()
  await choose('Customer', 'Beta Ltd')
  await choose('Label', 'docs', { not: true })
  await choose('Due date', 'Overdue')

  await window.getByRole('button', { name: 'New view' }).click()
  await window.getByLabel('New view name').fill('Late beta')
  await window.keyboard.press('Enter')
  const list = window.getByRole('list', { name: 'Saved views' })
  await expect(list.getByRole('button', { name: 'Late beta', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  )

  const view = (await stored()).find((v) => v.id === 'late-beta')
  expect(view?.filters).toEqual({
    customer: ['Beta Ltd'],
    dates: { due: 'overdue' },
    not: { label: ['docs'] },
  })

  await window.getByRole('button', { name: 'Clear' }).click()
  await expect(chips()).toHaveCount(0)
  await list.getByRole('button', { name: 'Late beta', exact: true }).click()
  await expect(chips()).toContainText('Customer: Beta Ltd')
  await expect(chips()).toContainText('Label is not: docs')
  await expect(chips()).toContainText('Due date: Overdue')
  await expect(item(/PSAPAC-40,/)).toBeVisible()
})

test('the Created by me starter filters to the issues the signed-in user created', async () => {
  await open()
  const list = window.getByRole('list', { name: 'Saved views' })
  await list.getByRole('button', { name: 'Created by me', exact: true }).click()

  await expect(chips()).toContainText('Creator: Me')
  await expect(item(/PSAPAC-2,/)).toBeVisible()
  await expect(item(/PSAPAC-11,.*context/)).toBeVisible()
  await expect(item(/PSAPAC-32,/)).toHaveCount(0)
})

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (found === null) throw new Error('The element has no box.')
  return found
}

test('the menu lists the fields only, and a field opens its values in a submenu on hover, click and keys', async () => {
  await open()
  await toggle('Filter').click()
  await expect(menu().locator('[data-filter-field]')).toHaveCount(15)
  await expect(menu().getByRole('checkbox')).toHaveCount(0)
  await expect(row('Status')).toHaveAttribute('aria-haspopup', 'true')
  await expect(row('Status')).toHaveAttribute('aria-expanded', 'false')
  const main = await box(menu())

  // The pointer resting on a field opens its submenu, level with the field and beside the list,
  // without moving focus into it.
  await row('Status').hover()
  await expect(submenu('Status')).toBeVisible()
  await expect(row('Status')).toHaveAttribute('aria-expanded', 'true')
  await expect(search('Search Status')).not.toBeFocused()
  const side = await box(submenu('Status'))
  const field = await box(row('Status'))
  expect(side.x).toBeGreaterThanOrEqual(main.x + main.width - 6)
  expect(Math.abs(side.y - field.y)).toBeLessThanOrEqual(6)
  expect(await box(menu())).toEqual(main)

  // Another field swaps it in.
  await row('Priority').hover()
  await expect(submenu('Priority')).toBeVisible()
  await expect(submenu('Status')).not.toBeVisible()
  await expect(row('Status')).toHaveAttribute('aria-expanded', 'false')

  // A click opens it with the search box focused.
  await row('Type').click()
  await expect(submenu('Type')).toBeVisible()
  await expect(search('Search Type')).toBeFocused()
  expect(await box(menu())).toEqual(main)
  await expect(submenu('Priority')).not.toBeVisible()
})

test('the keys move between fields, open a submenu on its search box and come back', async () => {
  await open()
  await expect(tree()).toBeFocused()
  await window.keyboard.press('f')
  await expect(row('Status')).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(row('Status type')).toBeFocused()
  await window.keyboard.press('ArrowUp')
  await expect(row('Status')).toBeFocused()

  await window.keyboard.press('ArrowRight')
  await expect(submenu('Status')).toBeVisible()
  await expect(search('Search Status')).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(submenu('Status').getByRole('checkbox').first()).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(submenu('Status').getByRole('checkbox').nth(1)).toBeFocused()
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('ArrowUp')
  await expect(search('Search Status')).toBeFocused()

  // Left leaves the submenu, but moves the caret while the search box holds text.
  await window.keyboard.type('prog')
  await window.keyboard.press('ArrowLeft')
  await expect(submenu('Status')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(search('Search Status')).toHaveValue('')
  await expect(submenu('Status')).toBeVisible()
  await window.keyboard.press('ArrowLeft')
  await expect(submenu('Status')).not.toBeVisible()
  await expect(row('Status')).toBeFocused()
  await expect(row('Status')).toHaveAttribute('aria-expanded', 'false')

  // Enter opens it again, Escape returns to the field, and a second Escape closes the menu.
  await window.keyboard.press('Enter')
  await expect(search('Search Status')).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(submenu('Status')).not.toBeVisible()
  await expect(row('Status')).toBeFocused()
  await expect(menu()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(menu()).not.toBeVisible()
  await expect(tree()).toBeFocused()
})

test('checking a value applies the filter and leaves both menus open', async () => {
  await open()
  await openField('Status')
  await submenu('Status').getByRole('checkbox', { name: 'In Progress', exact: true }).check()

  await expect(chips()).toContainText('Status: In Progress')
  await expect(row('Status')).toHaveText(/1/)
  await expect(menu()).toBeVisible()
  await expect(submenu('Status')).toBeVisible()
  await expect(item(/PSAPAC-4,/)).toBeVisible()
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)

  await submenu('Status').getByRole('checkbox', { name: 'In Progress', exact: true }).uncheck()
  await expect(chips()).toHaveCount(0)
  await expect(row('Status')).not.toHaveText(/\d/)
  await expect(submenu('Status')).toBeVisible()

  // Only the fields with an "is not" side show the switch.
  await expect(submenu('Status').getByRole('group', { name: 'Status operator' })).toBeVisible()
  await openField('Due date')
  await expect(submenu('Due date').getByRole('group', { name: 'Due date operator' })).toHaveCount(0)
})

test('every submenu searches its values, keeps the checked ones, and clears on Escape and on closing', async () => {
  await open()
  await openField('Status')
  const list = submenu('Status')
  const input = search('Search Status')
  await list.getByRole('checkbox', { name: 'To Do', exact: true }).check()
  await expect(list.getByRole('checkbox')).not.toHaveCount(1)

  await input.fill('PROG')
  await expect(list.getByRole('checkbox')).toHaveCount(1)
  await expect(list.getByRole('checkbox', { name: 'In Progress', exact: true })).toBeVisible()
  // The checked value the search hides stays checked.
  await expect(chips()).toContainText('Status: To Do')
  await input.fill('zzz')
  await expect(list.getByRole('checkbox')).toHaveCount(0)
  await expect(list.getByText('No matches')).toBeVisible()

  // Escape clears the text and keeps the submenu, the next one closes it.
  await input.press('Escape')
  await expect(input).toHaveValue('')
  await expect(list.getByText('No matches')).toHaveCount(0)
  await expect(list).toBeVisible()
  await expect(list.getByRole('checkbox', { name: 'To Do', exact: true })).toBeChecked()
  await input.fill('done')
  await input.press('Escape')
  await input.press('Escape')
  await expect(list).not.toBeVisible()

  // Closing clears the text, and the date fields search too.
  await openField('Status')
  await expect(search('Search Status')).toHaveValue('')
  await openField('Due date')
  await search('Search Due date').fill('over')
  await expect(submenu('Due date').getByRole('checkbox')).toHaveCount(1)
  await expect(submenu('Due date').getByRole('checkbox', { name: 'Overdue' })).toBeVisible()
})

test('the pointer crossing other fields toward a submenu does not swap it', async () => {
  await open()
  await toggle('Filter').click()
  await row('Status').hover()
  await expect(submenu('Status')).toBeVisible()

  // A diagonal path from the Status row, down across the rows below it and into its submenu.
  const from = await box(row('Status'))
  const into = await box(submenu('Status'))
  await window.mouse.move(from.x + 20, from.y + from.height / 2)
  await window.mouse.move(into.x + 40, into.y + 150, { steps: 12 })
  await expect(submenu('Status')).toBeVisible()
  // Long enough for a swap if one were pending.
  await window.waitForTimeout(400)
  await expect(submenu('Status')).toBeVisible()
  await expect(submenu('Status type')).not.toBeVisible()
  await expect(submenu('Assignee')).not.toBeVisible()
})

/** Narrows the window to its minimum width and a short height, so the Tree is under 700px. */
async function narrowWindow(height: number) {
  await app.evaluate(({ BrowserWindow }, h) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(900, h)
  }, height)
  await expect.poll(() => window.evaluate(() => globalThis.innerHeight)).toBe(height)
}

test('a submenu flips to the left at the window edge and stays inside the window', async () => {
  await open()
  // The Tree is under 700px here, so the Filter button shows its icon only.
  for (const height of [520, 700]) {
    await narrowWindow(height)
    const inside = await window.evaluate(() => ({
      w: globalThis.innerWidth,
      h: globalThis.innerHeight,
    }))
    await toggle('Filter').click()
    const main = await box(menu())

    // From the top field to the last, which sits at the foot of the list: the submenu never covers
    // the menu, and its whole box stays in the window.
    for (const field of ['Status', 'Due date', 'Customer', 'Engagement', 'Epic', 'Sprint']) {
      await row(field).click()
      const side = await box(submenu(field))
      const at = `${field} at ${String(height)}px`
      expect(side.x + side.width <= main.x + 6 || side.x >= main.x + main.width - 6, at).toBe(true)
      expect(side.x, at).toBeGreaterThanOrEqual(0)
      expect(side.x + side.width, at).toBeLessThanOrEqual(inside.w)
      expect(side.y, at).toBeGreaterThanOrEqual(0)
      expect(side.y + side.height, at).toBeLessThanOrEqual(inside.h)
      // Narrower than the field's right side, so it opened on the left.
      expect(side.x + side.width, at).toBeLessThanOrEqual(main.x + 6)
    }
    await closeMenus()
  }
})

test('a submenu closes when another field takes focus', async () => {
  await open()
  await toggle('Filter').click()
  await row('Priority').hover()
  await expect(submenu('Priority')).toBeVisible()
  await row('Status').focus()
  await expect(submenu('Priority')).not.toBeVisible()
})

test('a pointer resting on a field swaps the submenu, unless the search box holds text', async () => {
  await open()
  await toggle('Filter').click()

  // An empty search box, as after a click, still lets the pointer swap.
  await row('Status').click()
  await expect(search('Search Status')).toBeFocused()
  await row('Type').hover()
  await expect(submenu('Type')).toBeVisible()
  await expect(submenu('Status')).not.toBeVisible()

  // Text in it means the user is typing, so the pointer swaps nothing.
  await row('Status').click()
  await window.keyboard.type('prog')
  await row('Priority').hover()
  await window.waitForTimeout(400)
  await expect(submenu('Status')).toBeVisible()
  await expect(submenu('Priority')).not.toBeVisible()
  await expect(submenu('Status').getByRole('checkbox')).toHaveCount(1)
})

test('the first hover after a checkbox or the operator button has focus still swaps', async () => {
  await open()
  await toggle('Filter').click()

  await row('Status').click()
  await submenu('Status').getByRole('checkbox', { name: 'To Do', exact: true }).check()
  await row('Assignee').hover()
  await expect(submenu('Assignee')).toBeVisible()
  await expect(submenu('Status')).not.toBeVisible()

  await submenu('Assignee').getByRole('button', { name: 'is not', exact: true }).click()
  await row('Creator').hover()
  await expect(submenu('Creator')).toBeVisible()
  await expect(submenu('Assignee')).not.toBeVisible()
})

test('a submenu starts at the menu edge in a wide short window', async () => {
  await open()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1300, 520)
  })
  await expect.poll(() => window.evaluate(() => globalThis.innerHeight)).toBe(520)
  await toggle('Filter').click()
  const main = await box(menu())
  for (const field of ['Status', 'Epic', 'Sprint']) {
    await row(field).click()
    const side = await box(submenu(field))
    expect(side.x, field).toBeGreaterThanOrEqual(main.x + main.width - 2)
    expect(side.x, field).toBeLessThanOrEqual(main.x + main.width + 6)
  }
})

test('the field list does not wrap in a wide font, and the submenu takes the menu colours', async () => {
  await open()
  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  await toggle('Filter').click()
  for (const field of await menu().locator('[data-filter-field]').all()) {
    expect((await field.boundingBox())?.height).toBe(32)
    const label = field.locator('span').first()
    expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }

  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await row('Status').click()
    const colours = await window.evaluate(() => {
      const paint = (el: Element | null) =>
        el === null ? '' : getComputedStyle(el).backgroundColor
      return [
        paint(document.getElementById('filter-menu')),
        paint(document.querySelector('#filter-menu [popover]')),
      ]
    })
    expect(colours[1], scheme).toBe(colours[0])
    expect(colours[0], scheme).not.toBe('')
  }
})
