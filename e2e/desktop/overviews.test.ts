/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import {
  counts,
  failDone,
  failUnresolved,
  holdUnresolved,
  joinSprint,
  launch,
  logIn,
  releaseDone,
  releaseUnresolved,
} from './harness.js'

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
const link = (name: string) => sidebar().getByRole('link', { name, exact: true })
const issuesLink = () => sidebar().getByRole('link', { name: /^Issues/ })
const epicsPage = () => window.getByRole('region', { name: 'Epics' })
const customersPage = () => window.getByRole('region', { name: 'Customers' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const props = () => issuePage().getByRole('complementary', { name: 'Properties' })
const header = (name: string) => epicsPage().getByRole('columnheader', { name, exact: true })

/** The Epic keys down the table, in order. */
const epicKeys = () =>
  epicsPage()
    .locator('tbody [data-overview-row]')
    .evaluateAll((rows) => rows.map((r) => /^PSAPAC-\d+/.exec(r.textContent)?.[0] ?? ''))

const epicRow = (key: string) =>
  epicsPage()
    .getByRole('row')
    .filter({ has: window.locator(`[data-overview-key="${key}"]`) })

/** The text of each cell of an Epic's row after its name: Customer, Status, Priority, Assignee, Issues, Due, % done. */
const epicCells = (key: string) => epicRow(key).getByRole('cell').allInnerTexts()

const customerRow = (name: string) =>
  customersPage()
    .getByRole('row')
    .filter({ has: window.getByRole('button', { name, exact: true }) })
const customerCells = (name: string) => customerRow(name).getByRole('cell').allInnerTexts()

/** Logs in and waits for the Tree, with the Done issues still held back by the fake. */
async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Lets the Done phase load and waits for its progress line to go. */
async function loadDone() {
  await releaseDone(app)
  await expect(window.getByText('Loading Done issues:')).toHaveCount(0)
}

const pill = (row: Locator) => row.locator('[data-progress]')

test.describe('progress', () => {
  test('an Epic row shows done over total, which grows when the Done issues load', async () => {
    await open()
    // PSAPAC-10 has six open Stories, Tasks and Bugs loaded, and two Done ones still to come.
    await expect(pill(item(/PSAPAC-10,/))).toHaveAttribute('data-progress', '0/6')
    await expect(item(/PSAPAC-10,/)).toHaveAccessibleName(/, 0 of 6 done$/)

    await loadDone()
    await expect(pill(item(/PSAPAC-10,/))).toHaveAttribute('data-progress', '2/8')
    await expect(item(/PSAPAC-10,/)).toHaveAccessibleName(/, 2 of 8 done$/)
    await expect(pill(item(/PSAPAC-10,/))).toHaveText('2/8')
    // Reading "done" from the title as well as the name, so the numbers are not bare.
    await expect(pill(item(/PSAPAC-10,/))).toHaveAttribute('title', '2 of 8 done')
    await expect(pill(item(/PSAPAC-30,/))).toHaveAttribute('data-progress', '0/2')
    await expect(pill(item(/PSAPAC-50,/))).toHaveAttribute('data-progress', '0/1')
  })

  test('the pill equals the Epic row children plus its Done chip', async () => {
    await open()
    await loadDone()
    // The chip says two are done and eight sit under the Epic in all: six rows plus the chip's two.
    await expect(item(/^2 done$/).first()).toBeVisible()
    const rows = await tree()
      .getByRole('treeitem')
      .evaluateAll((all) =>
        all.map((r) => [r.getAttribute('aria-level'), r.getAttribute('aria-label')]),
      )
    const epic = rows.findIndex(([, name]) => name?.startsWith('PSAPAC-10,'))
    // Level 3 rows after the Epic and before the next level 2 row are its children.
    let children = 0
    for (const [level, name] of rows.slice(epic + 1)) {
      if (level === '2') break
      if (level === '3' && name?.startsWith('PSAPAC-')) children++
    }
    expect(children).toBe(6)
    await expect(pill(item(/PSAPAC-10,/))).toHaveAttribute('data-progress', '2/8')
  })

  test('only an Epic row has a pill', async () => {
    await open()
    await loadDone()
    // The Tree holds four Epics and no other parent shows one.
    await expect(tree().locator('[data-progress]')).toHaveCount(4)
    await expect(item(/PSAPAC-11,/).locator('[data-progress]')).toHaveCount(0)
    await expect(item(/PSAPAC-1,/).locator('[data-progress]')).toHaveCount(0)
  })

  test('the Sub-issue of line names the parent with its progress and opens it', async () => {
    await open()
    await loadDone()
    await item(/PSAPAC-1,/).click()
    await window.keyboard.press('Enter')
    await expect(
      issuePage().getByRole('heading', { name: 'Kick off the engagement' }),
    ).toBeVisible()

    const line = issuePage().locator('[data-parent-line]').locator('xpath=..')
    await expect(line).toContainText('Sub-issue of')
    await expect(line).toContainText('PSAPAC-10')
    await expect(line).toContainText('Customer onboarding')
    await expect(pill(line)).toHaveAttribute('data-progress', '2/8')

    await line.getByRole('button', { name: /PSAPAC-10 Customer onboarding/ }).click()
    await expect(issuePage().getByRole('heading', { name: 'Customer onboarding' })).toBeVisible()
    // An Epic has no parent, so no line.
    await expect(issuePage().locator('[data-parent-line]')).toHaveCount(0)
  })

  test('a Story’s line counts its Subtasks, and the line follows an edit', async () => {
    await open()
    await loadDone()
    await item(/PSAPAC-12,/).click()
    await window.keyboard.press('Enter')
    const line = issuePage().locator('[data-parent-line]').locator('xpath=..')
    await expect(line).toContainText('PSAPAC-11')
    await expect(pill(line)).toHaveAttribute('data-progress', '0/1')

    // Moving the Subtask to Done moves the pill without a reload.
    await window.keyboard.press('s')
    await window.getByRole('option', { name: /Done/ }).click()
    await expect(pill(line)).toHaveAttribute('data-progress', '1/1')
  })
})

test.describe('Epics table', () => {
  test('lists every Epic with its Customer, Status, Issues and percent done, Done counted once loaded', async () => {
    await open()
    await link('Epics').click()
    await expect(epicsPage()).toBeVisible()
    await expect(epicsPage().getByRole('heading', { name: 'Epics', level: 1 })).toBeVisible()
    await expect(epicsPage().getByRole('status')).toHaveText(
      '3 Epics. Loading Done issues, so counts may grow.',
    )
    expect(await epicKeys()).toEqual(['PSAPAC-50', 'PSAPAC-30', 'PSAPAC-10'])
    expect(await epicCells('PSAPAC-10')).toEqual([
      'Acme',
      'To Do',
      'Medium',
      'Unassigned',
      '6',
      '',
      '0%',
    ])

    await loadDone()
    await expect(epicsPage().getByRole('status')).toHaveText('4 Epics')
    expect(await epicKeys()).toEqual(['PSAPAC-50', 'PSAPAC-30', 'PSAPAC-20', 'PSAPAC-10'])
    expect(await epicCells('PSAPAC-10')).toEqual([
      'Acme',
      'To Do',
      'Medium',
      'Unassigned',
      '8',
      '',
      '25%',
    ])
    expect(await epicCells('PSAPAC-20')).toEqual([
      'Beta Ltd',
      'Done',
      'Medium',
      'Unassigned',
      '2',
      '',
      '50%',
    ])
    expect(await epicCells('PSAPAC-30')).toEqual([
      'Beta Ltd',
      'In Progress',
      'Medium',
      'Unassigned',
      '2',
      '',
      '0%',
    ])
    expect(await epicCells('PSAPAC-50')).toEqual([
      'Collibra (Internal team)',
      'To Do',
      'Medium',
      'Unassigned',
      '1',
      '',
      '0%',
    ])
  })

  test('the percent done matches the Epic’s pill in the Tree', async () => {
    await open()
    await loadDone()
    await link('Epics').click()
    // 2 of 8, as the Tree row says.
    await expect(epicRow('PSAPAC-10').getByRole('cell').last()).toHaveText('25%')
    await expect(epicRow('PSAPAC-10').getByRole('cell').last()).toHaveAttribute(
      'title',
      '2 of 8 done',
    )
  })

  test('sorts by each column, in its own first direction and then the reverse', async () => {
    await open()
    await loadDone()
    await link('Epics').click()
    await expect(epicsPage().locator('tbody tr')).toHaveCount(4)

    // The Epic key, newest first, to begin with.
    await expect(header('Epic')).toHaveAttribute('aria-sort', 'descending')
    expect(await epicKeys()).toEqual(['PSAPAC-50', 'PSAPAC-30', 'PSAPAC-20', 'PSAPAC-10'])
    await header('Epic').getByRole('button').click()
    await expect(header('Epic')).toHaveAttribute('aria-sort', 'ascending')
    expect(await epicKeys()).toEqual(['PSAPAC-10', 'PSAPAC-20', 'PSAPAC-30', 'PSAPAC-50'])

    const sorted = async (column: string, keys: string[], direction: string) => {
      await header(column).getByRole('button').click()
      await expect(header(column)).toHaveAttribute('aria-sort', direction)
      // Only the sorted column carries the attribute.
      await expect(epicsPage().locator('th[aria-sort]')).toHaveCount(1)
      expect(await epicKeys(), `${column} ${direction}`).toEqual(keys)
    }
    // Customer: Acme, then Beta Ltd's two (ties newest first), then the internal one.
    await sorted('Customer', ['PSAPAC-10', 'PSAPAC-30', 'PSAPAC-20', 'PSAPAC-50'], 'ascending')
    await sorted('Customer', ['PSAPAC-50', 'PSAPAC-30', 'PSAPAC-20', 'PSAPAC-10'], 'descending')
    // Status in the Tree's order: To Do, In Progress, Done.
    await sorted('Status', ['PSAPAC-50', 'PSAPAC-10', 'PSAPAC-30', 'PSAPAC-20'], 'ascending')
    await sorted('Status', ['PSAPAC-20', 'PSAPAC-30', 'PSAPAC-50', 'PSAPAC-10'], 'descending')
    // Issues, most first to begin with.
    await sorted('Issues', ['PSAPAC-10', 'PSAPAC-30', 'PSAPAC-20', 'PSAPAC-50'], 'descending')
    await sorted('Issues', ['PSAPAC-50', 'PSAPAC-30', 'PSAPAC-20', 'PSAPAC-10'], 'ascending')
    // % done, most first to begin with.
    await sorted('% done', ['PSAPAC-20', 'PSAPAC-10', 'PSAPAC-50', 'PSAPAC-30'], 'descending')
    await sorted('% done', ['PSAPAC-50', 'PSAPAC-30', 'PSAPAC-10', 'PSAPAC-20'], 'ascending')
    // Nothing separates the Epics by Priority, Assignee or due date yet, so each falls back to newest first.
    for (const column of ['Priority', 'Assignee', 'Due date']) {
      await header(column).getByRole('button').click()
      await expect(header(column)).toHaveAttribute('aria-sort', /ascending|descending/)
      expect(await epicKeys(), column).toEqual(['PSAPAC-50', 'PSAPAC-30', 'PSAPAC-20', 'PSAPAC-10'])
    }
  })

  test('sorts by Priority, Assignee and due date once edits tell the Epics apart, and follows them', async () => {
    await open()
    await loadDone()
    await link('Epics').click()
    await epicRow('PSAPAC-20').getByRole('button').click()
    await expect(issuePage().getByRole('heading', { name: 'Platform migration' })).toBeVisible()
    await props()
      .getByRole('button', { name: /^Priority:/ })
      .click()
    await window.getByRole('option', { name: 'High', exact: true }).click()
    await expect(props().getByRole('button', { name: 'Priority: High' })).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(issuePage()).toHaveCount(0)

    // The edit is in the table already, with no reload.
    await expect(epicsPage()).toBeVisible()
    expect((await epicCells('PSAPAC-20'))[2]).toBe('High')

    await epicRow('PSAPAC-30').getByRole('button').click()
    await window.keyboard.press('i')
    await expect(props().getByRole('button', { name: /^Assignee: Test User/ })).toBeVisible()
    const due = props().getByLabel('Due date')
    await due.fill('2030-03-04')
    await due.blur()
    await expect(due).toHaveValue('2030-03-04')
    await window.keyboard.press('Escape')

    await epicRow('PSAPAC-50').getByRole('button').click()
    const other = props().getByLabel('Due date')
    await other.fill('2030-01-02')
    await other.blur()
    await expect(other).toHaveValue('2030-01-02')
    await window.keyboard.press('Escape')
    await expect(epicsPage()).toBeVisible()

    expect((await epicCells('PSAPAC-30'))[3]).toBe('Test User')
    expect((await epicCells('PSAPAC-30'))[5]).toBe("Mar 4 '30")

    // Highest priority first.
    await header('Priority').getByRole('button').click()
    expect((await epicKeys())[0]).toBe('PSAPAC-20')
    await header('Priority').getByRole('button').click()
    // Lowest first puts the High one last.
    expect((await epicKeys()).at(-1)).toBe('PSAPAC-20')
    // The Epic with an Assignee first, the unassigned after it in either direction.
    await header('Assignee').getByRole('button').click()
    expect((await epicKeys())[0]).toBe('PSAPAC-30')
    await header('Assignee').getByRole('button').click()
    expect((await epicKeys())[0]).toBe('PSAPAC-30')
    // Soonest due first, the undated after the dated in either direction.
    await header('Due date').getByRole('button').click()
    expect((await epicKeys()).slice(0, 2)).toEqual(['PSAPAC-50', 'PSAPAC-30'])
    await header('Due date').getByRole('button').click()
    expect((await epicKeys()).slice(0, 2)).toEqual(['PSAPAC-30', 'PSAPAC-50'])
  })

  test('opens an Epic from its row, and Esc returns to the table with focus on that row', async () => {
    await open()
    await loadDone()
    await link('Epics').click()
    await expect(epicsPage().getByRole('button', { name: /^PSAPAC-50 / })).toBeFocused()

    await epicRow('PSAPAC-30').getByRole('button').click()
    await expect(issuePage().getByRole('heading', { name: 'Reporting' })).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(issuePage()).toHaveCount(0)
    await expect(epicsPage()).toBeVisible()
    await expect(epicsPage().getByRole('button', { name: /^PSAPAC-30 / })).toBeFocused()

    // Enter on a focused row opens it too.
    await window.keyboard.press('ArrowUp')
    await expect(epicsPage().getByRole('button', { name: /^PSAPAC-50 / })).toBeFocused()
    await window.keyboard.press('Enter')
    await expect(issuePage().getByRole('heading', { name: 'Internal tooling' })).toBeVisible()
  })

  test('the arrow keys move between the rows', async () => {
    await open()
    await loadDone()
    await link('Epics').click()
    const row = (key: string) => epicsPage().getByRole('button', { name: new RegExp(`^${key} `) })
    await window.keyboard.press('ArrowDown')
    await expect(row('PSAPAC-30')).toBeFocused()
    await window.keyboard.press('ArrowDown')
    await expect(row('PSAPAC-20')).toBeFocused()
    await window.keyboard.press('End')
    await window.keyboard.press('ArrowUp')
    await expect(row('PSAPAC-30')).toBeFocused()
  })

  test('Esc, Back and the Issues link leave for the Tree', async () => {
    await open()
    await link('Epics').click()
    await expect(link('Epics')).toHaveAttribute('aria-current', 'page')
    await window.keyboard.press('Escape')
    await expect(epicsPage()).toHaveCount(0)
    await expect(tree()).toBeFocused()

    await link('Epics').click()
    await epicsPage().getByRole('button', { name: 'Back to issues' }).click()
    await expect(epicsPage()).toHaveCount(0)
    await expect(tree()).toBeFocused()

    await link('Epics').click()
    await issuesLink().click()
    await expect(epicsPage()).toHaveCount(0)
    await expect(tree()).toBeFocused()

    // Esc from the sidebar, where focus sits after a click on it, leaves too.
    await link('Epics').click()
    await link('Customers').focus()
    await window.keyboard.press('Escape')
    await expect(epicsPage()).toHaveCount(0)
  })
})

test.describe('Customers page', () => {
  test('lists every Customer of the Project with its open count and percent done', async () => {
    await open()
    await link('Customers').click()
    await expect(customersPage()).toBeVisible()
    await expect(
      customersPage().getByRole('heading', { name: 'Customers', level: 1 }),
    ).toBeVisible()
    await expect(customersPage().getByText('Loading Customers')).toHaveCount(0)
    await expect(customersPage().locator('header').getByRole('status')).toHaveText(
      '4 Customers. Loading Done issues, so counts may grow.',
    )
    // Before the Done issues load, nothing is done: Acme has nine open issues of its own.
    expect(await customerCells('Acme')).toEqual(['9', '0%'])

    await loadDone()
    await expect(customersPage().locator('header').getByRole('status')).toHaveText('4 Customers')
    const names = await customersPage().locator('tbody [data-overview-row]').allInnerTexts()
    // Ordinary Customers by name, the internal one last, one with no issue among them.
    expect(names).toEqual(['Acme', 'Beta Ltd', 'Zeta Corp', 'Collibra (Internal team)'])
    // Acme: 9 open and 2 Done of 11. Beta Ltd: 4 open and 2 Done of 6.
    expect(await customerCells('Acme')).toEqual(['9', '18%'])
    expect(await customerCells('Beta Ltd')).toEqual(['4', '33%'])
    expect(await customerCells('Collibra (Internal team)')).toEqual(['2', '0%'])
    expect(await customerCells('Zeta Corp')).toEqual(['0', 'No issues'])
    await expect(customerRow('Acme').getByRole('cell').last()).toHaveAttribute(
      'title',
      '2 of 11 done',
    )
  })

  test('opens the Tree filtered to the Customer, and its open count is what the Tree then shows', async () => {
    await open()
    await loadDone()
    await link('Customers').click()
    const [open9] = await customerCells('Acme')
    await customersPage().getByRole('button', { name: 'Acme', exact: true }).click()

    await expect(customersPage()).toHaveCount(0)
    await expect(tree()).toBeFocused()
    await expect(issuesLink()).toHaveAttribute('aria-current', 'page')
    await expect(window.getByRole('list', { name: 'Active filters' })).toContainText(
      'Customer: Acme',
    )
    // One Customer group, Acme, and no other.
    await expect(tree().getByRole('treeitem', { name: /^Acme, / })).toBeVisible()
    await expect(tree().getByRole('treeitem', { name: /^Collibra/ })).toHaveCount(0)
    // The open issues the filter keeps: every issue row that is not context. Hide done leaves the Done ones behind the chip.
    const names = await tree()
      .getByRole('treeitem')
      .evaluateAll((all) => all.map((r) => r.getAttribute('aria-label') ?? ''))
    const issues = names.filter((n) => /^PSAPAC-\d+,/.test(n) && !/, context(,|$)/.test(n))
    expect(issues.length).toBe(Number(open9))
  })

  test('opens a Customer that holds no issue as an empty Tree with a way back', async () => {
    await open()
    await loadDone()
    await link('Customers').click()
    await customersPage().getByRole('button', { name: 'Zeta Corp', exact: true }).click()
    await expect(window.getByRole('list', { name: 'Active filters' })).toContainText(
      'Customer: Zeta Corp',
    )
    await expect(window.getByRole('button', { name: 'Clear filters' }).first()).toBeVisible()
  })

  test('a click on a row opens it, and Enter on a focused row does too', async () => {
    await open()
    await loadDone()
    await link('Customers').click()
    await expect(customersPage().getByRole('button', { name: 'Acme', exact: true })).toBeFocused()
    await window.keyboard.press('ArrowDown')
    await expect(
      customersPage().getByRole('button', { name: 'Beta Ltd', exact: true }),
    ).toBeFocused()
    await window.keyboard.press('Enter')
    await expect(customersPage()).toHaveCount(0)
    await expect(window.getByRole('list', { name: 'Active filters' })).toContainText(
      'Customer: Beta Ltd',
    )
  })
})

test.describe('surfaces', () => {
  test('one page at a time: Epics, Customers, the Inbox and a sprint replace each other', async () => {
    await joinSprint(app, ['PSAPAC-1'], 5)
    await open()
    await link('Epics').click()
    await expect(epicsPage()).toBeVisible()
    await link('Customers').click()
    await expect(epicsPage()).toHaveCount(0)
    await expect(customersPage()).toBeVisible()
    expect(await sidebar().locator('[aria-current]').count()).toBe(1)
    await expect(link('Customers')).toHaveAttribute('aria-current', 'page')

    await link('Inbox').click()
    await expect(customersPage()).toHaveCount(0)
    await expect(window.getByRole('region', { name: 'Inbox' })).toBeVisible()

    await link('Epics').click()
    await expect(window.getByRole('region', { name: 'Inbox' })).toHaveCount(0)
    await expect(epicsPage()).toBeVisible()

    await sidebar()
      .getByRole('region', { name: 'Sprints' })
      .getByRole('button', { name: /^Current/ })
      .click()
    await expect(epicsPage()).toHaveCount(0)
    await expect(window.getByRole('region', { name: 'Sprint page' })).toBeVisible()

    await link('Customers').click()
    await expect(window.getByRole('region', { name: 'Sprint page' })).toHaveCount(0)
    await expect(customersPage()).toBeVisible()
    expect(await sidebar().locator('[aria-current]').count()).toBe(1)
  })

  test('lights one sidebar item, and a saved view or the Issues link takes the highlight back', async () => {
    await open()
    await expect(issuesLink()).toHaveAttribute('aria-current', 'page')
    await link('Epics').click()
    await expect(link('Epics')).toHaveAttribute('aria-current', 'page')
    await expect(issuesLink()).not.toHaveAttribute('aria-current')
    expect(await sidebar().locator('[aria-current]').count()).toBe(1)
    await expect(link('Epics')).toHaveClass(/is-current/)

    const view = window
      .getByRole('list', { name: 'Saved views' })
      .getByRole('button', { name: 'My issues', exact: true })
    await view.click()
    await expect(epicsPage()).toHaveCount(0)
    await expect(tree()).toBeFocused()
    await expect(view).toHaveAttribute('aria-current', 'true')
    await expect(link('Epics')).not.toHaveAttribute('aria-current')
  })

  test('the palette offers no action for the Tree row an overview hides', async () => {
    await open()
    await item(/PSAPAC-2,/).click()
    await window.keyboard.press('Escape')
    await link('Epics').click()
    await expect(epicsPage().getByRole('button', { name: /^PSAPAC-50 / })).toBeFocused()

    await window.keyboard.press('Meta+k')
    const palette = window.getByRole('dialog', { name: 'Search issues' })
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('group', { name: 'Actions' })).toHaveCount(0)
    await expect(palette.getByRole('option', { name: /Assign to me/ })).toHaveCount(0)
    await window.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
    // Focus returns to the page's row, not to the inert Tree.
    await expect(epicsPage().getByRole('button', { name: /^PSAPAC-50 / })).toBeFocused()
  })

  test('letter keys and the filter shortcut do nothing under an overview', async () => {
    await open()
    await item(/PSAPAC-2,/).click()
    await window.keyboard.press('Escape')
    await link('Epics').click()
    await window.keyboard.press('s')
    await window.keyboard.press('/')
    await expect(
      window.getByRole('textbox', { name: 'Filter by key or summary' }),
    ).not.toBeFocused()
    await expect(window.getByRole('listbox')).toHaveCount(0)
    expect((await counts(app)).edits).toBe(0)
  })

  test('keeps focus out of the overview while an issue page is open over it', async () => {
    await open()
    await link('Epics').click()
    await epicsPage()
      .getByRole('button', { name: /^PSAPAC-50 / })
      .click()
    await expect(issuePage()).toBeFocused()
    const inside = () =>
      window.evaluate(() => document.activeElement?.closest('[aria-label="Epics"]') !== null)
    // The overview comes before the issue page in the layout, so Shift+Tab walks back into it.
    for (let i = 0; i < 12; i++) {
      await window.keyboard.press('Shift+Tab')
      expect(await inside(), `Shift+Tab ${String(i + 1)}`).toBe(false)
    }
    await issuePage().focus()
    for (let i = 0; i < 40; i++) {
      await window.keyboard.press('Tab')
      expect(await inside(), `Tab ${String(i + 1)}`).toBe(false)
    }
  })

  test('a sidebar link opens its page in place of an issue page open over another', async () => {
    await open()
    await link('Epics').click()
    await epicsPage()
      .getByRole('button', { name: /^PSAPAC-50 / })
      .click()
    await expect(issuePage()).toBeVisible()

    await link('Customers').click()
    await expect(issuePage()).toHaveCount(0)
    await expect(epicsPage()).toHaveCount(0)
    await expect(customersPage()).toBeVisible()
    await expect(customersPage().getByRole('button', { name: 'Acme', exact: true })).toBeFocused()
  })

  test('the Customers page loads the Customer list on its own', async () => {
    await open()
    // The Tree's own settings keep empty Customers hidden, so the list is not loaded until asked for.
    await link('Customers').click()
    await expect(
      customersPage().getByRole('button', { name: 'Zeta Corp', exact: true }),
    ).toBeVisible()
  })

  test('holds its layout with a wide font: no clipped row, header or count', async () => {
    await open()
    await loadDone()
    await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' })
    await link('Epics').click()
    const clipped = () =>
      window.evaluate(() => {
        const bad: string[] = []
        for (const el of document.querySelectorAll(
          '[aria-label="Epics"] button, [aria-label="Epics"] td',
        )) {
          const style = getComputedStyle(el)
          // A cell may truncate with an ellipsis; a number or a status may not be cut.
          if (style.textOverflow === 'ellipsis') continue
          if (el.scrollWidth > el.clientWidth + 1) bad.push(el.textContent)
        }
        return bad
      })
    expect(await clipped()).toEqual([])
    await link('Customers').click()
    await expect(customersPage()).toBeVisible()
    const widths = await customersPage().evaluate((el) => {
      const table = el.querySelector('table')
      return table === null ? 0 : table.scrollWidth - (table.parentElement?.clientWidth ?? 0)
    })
    expect(widths).toBeLessThanOrEqual(1)
  })
})

test.describe('load states', () => {
  const banner = () => window.getByRole('alert').filter({ hasText: 'Could not load Done issues' })

  test('a failed Done load says so on the Epics and Customers pages, hides what needs Done and retries', async () => {
    await open()
    await failDone(app)
    await releaseDone(app)
    // The Tree's own banner sits under the covered list, so look from the page.
    await expect(banner()).toBeVisible()
    await expect(pill(item(/PSAPAC-10,/))).toHaveCount(0)

    await link('Epics').click()
    await expect(epicsPage().getByRole('alert')).toContainText(
      'Could not load Done issues. Done counts are hidden.',
    )
    await expect(epicsPage().locator('header').getByRole('status')).toHaveText(
      '3 Epics. Done counts are hidden.',
    )
    // The Issues and % done cells are unknown, not zero.
    const cells = await epicCells('PSAPAC-10')
    expect(cells[4]).toBe('Not loaded')
    expect(cells[6]).toBe('Not loaded')
    await expect(epicsPage().getByText('0%')).toHaveCount(0)

    await link('Customers').click()
    await expect(customersPage().getByRole('alert')).toContainText('Done counts are hidden.')
    // Open counts only need the open issues, so they stand.
    await expect(customerRow('Acme')).toBeVisible()
    expect(await customerCells('Acme')).toEqual(['9', 'Not loaded'])

    // The page's own page-line pill is gone too, since a count of open children alone misleads.
    await customersPage().getByRole('alert').getByRole('button', { name: 'Retry' }).click()
    await expect(customersPage().getByRole('alert')).toHaveCount(0)
    // The retry reads Done again, and the counts catch up once it lands.
    await expect.poll(() => customerCells('Acme')).toEqual(['9', '18%'])
    await link('Epics').click()
    await expect.poll(async () => (await epicCells('PSAPAC-10'))[6]).toBe('25%')
    await expect(banner()).toHaveCount(0)
  })

  test('a failed Done load hides the pill on the issue page line', async () => {
    await open()
    await failDone(app)
    await releaseDone(app)
    await expect(banner()).toBeVisible()
    await item(/PSAPAC-1,/).click()
    await window.keyboard.press('Enter')
    const line = issuePage().locator('[data-parent-line]').locator('xpath=..')
    await expect(line).toContainText('PSAPAC-10')
    await expect(pill(line)).toHaveCount(0)
  })

  test('before the open issues load, both pages say so and never show "No Epics." or zero counts', async () => {
    await holdUnresolved(app)
    await logIn(window)
    await link('Epics').click()
    await expect(epicsPage().getByText('Loading issues')).toBeVisible()
    await expect(epicsPage().getByText('No Epics.')).toHaveCount(0)
    await expect(epicsPage().getByRole('table')).toHaveCount(0)
    await link('Customers').click()
    await expect(customersPage().getByText('Loading issues')).toBeVisible()
    await expect(customersPage().getByRole('table')).toHaveCount(0)
    await expect(customersPage().locator('header').getByRole('status')).toHaveText('')

    // Focus moves on to Back while nothing has loaded, and the arrival of rows leaves it there.
    await window.keyboard.press('Tab')
    await expect(customersPage().getByRole('button', { name: 'Back to issues' })).toBeFocused()
    await releaseUnresolved(app)
    await expect(customersPage().getByRole('table')).toBeVisible()
    await expect(customersPage().getByRole('button', { name: 'Back to issues' })).toBeFocused()
    expect(await customerCells('Acme')).toEqual(['9', '0%'])
  })

  test('with no rows yet the page keeps focus where the user put it', async () => {
    await holdUnresolved(app)
    await logIn(window)
    await link('Epics').click()
    await expect(epicsPage()).toBeFocused()
    await epicsPage().getByRole('button', { name: 'Back to issues' }).focus()
    // Status polls and renders do not pull it back to the page.
    await window.waitForTimeout(600)
    await expect(epicsPage().getByRole('button', { name: 'Back to issues' })).toBeFocused()
  })

  test('a failed open-issues load shows the Tree’s error with Retry, then the table', async () => {
    await failUnresolved(app)
    await logIn(window)
    await link('Epics').click()
    await expect(epicsPage().getByRole('alert')).toContainText('Jira had a problem')
    await expect(epicsPage().getByText('No Epics.')).toHaveCount(0)
    await epicsPage().getByRole('button', { name: 'Retry' }).click()
    await expect(epicsPage().getByRole('table')).toBeVisible()
    await expect(epicsPage().getByRole('alert')).toHaveCount(0)
    expect(await epicKeys()).toEqual(['PSAPAC-50', 'PSAPAC-30', 'PSAPAC-10'])
  })

  test('the pill names its progress for a screen reader', async () => {
    await open()
    await loadDone()
    await item(/PSAPAC-1,/).click()
    await window.keyboard.press('Enter')
    await expect(
      issuePage().locator('[data-parent-line]').locator('xpath=..').getByRole('img', {
        name: '2 of 8 done',
      }),
    ).toBeVisible()
  })
})
