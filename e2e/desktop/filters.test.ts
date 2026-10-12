import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { launch, logIn, releaseDone } from './harness.js'

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
}

/** Opens the Filter menu with the button and opens one field's list. */
async function openField(name: string) {
  if (!(await menu().evaluate((el) => el.matches(':popover-open')))) {
    await toggle('Filter').click()
  }
  const summary = menu()
    .locator('summary')
    .filter({ has: window.getByText(name, { exact: true }) })
  if (!(await summary.evaluate((el) => el.parentElement?.hasAttribute('open')))) {
    await summary.click()
  }
}

/** Checks one choice of one field, under "is not" when `not` is set, then closes the menu. */
async function choose(field: string, choice: string, options: { not?: boolean } = {}) {
  await openField(field)
  const list = menu()
    .locator('details')
    .filter({ has: window.locator('summary').getByText(field, { exact: true }) })
  const operators = list.getByRole('group', { name: `${field} operator` })
  // The switch keeps its setting between choices, so each choice sets it.
  if ((await operators.count()) > 0) {
    await operators
      .getByRole('button', { name: options.not === true ? 'is not' : 'is', exact: true })
      .click()
  }
  await list.getByRole('checkbox', { name: choice, exact: true }).check()
  await window.keyboard.press('Escape')
  await expect(menu()).not.toBeVisible()
}

test('F opens the Filter menu on its first field, and Esc returns to the Tree', async () => {
  await open()
  await expect(tree()).toBeFocused()

  await window.keyboard.press('f')
  await expect(menu()).toBeVisible()
  await expect(menu().locator('summary').first()).toBeFocused()
  await expect(menu().locator('summary')).toHaveCount(15)

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
  await window.keyboard.press('Escape')

  await choose('Customer', 'Beta Ltd')
  await expect(chips()).toContainText('Customer: Beta Ltd')
  await expect(item(/PSAPAC-40,/)).toBeVisible()
  await expect(item(/PSAPAC-4,/)).toHaveCount(0)
})

test('Overdue lists open issues due before today', async () => {
  await open()
  await releaseDone(app)
  await expect(window.getByText('Loading Done issues:')).toHaveCount(0)
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
