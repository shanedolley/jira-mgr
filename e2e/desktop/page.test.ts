import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, releaseDone, releaseEdit } from './harness.js'

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
const heading = (name: string) => issuePage().getByRole('heading', { name })
const picker = (label: string, value: string | RegExp) =>
  props().getByRole('button', { name: typeof value === 'string' ? `${label}: ${value}` : value })
const option = (name: string | RegExp) => window.getByRole('option', { name })
const alert = () => props().getByRole('alert')

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so this progress text stays and the toolbar stops
  // reflowing. A row clicked before it appears would move under the pointer.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Opens the full page of the issue whose row matches, with Enter. */
async function openPage(row: RegExp, title: string) {
  await open()
  await item(row).click()
  await window.keyboard.press('Enter')
  await expect(heading(title)).toBeVisible()
  // The page reads its own copy once, which adds the description.
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(1)
}

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1)

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

test('Enter opens the full page and Esc returns to the Tree, while Space keeps the Peek', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  // A click peeks. Close the Peek, then Space brings it back without opening the page.
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await window.keyboard.press(' ')
  await expect(peek()).toBeVisible()
  await expect(issuePage()).toHaveCount(0)

  await window.keyboard.press('Enter')
  await expect(heading('Migrate the dashboards')).toBeVisible()
  await expect(issuePage()).toBeFocused()
  // The Tree stays mounted under the page, but nothing in it can be reached.
  expect(
    await window.evaluate<boolean>("document.querySelector('[role=tree]').matches('[inert] *')"),
  ).toBe(true)

  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(peek()).toBeVisible()
})

test('Back to issues returns from the page to the Tree', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await peek().getByRole('button', { name: 'Open' }).click()
  await expect(heading('Migrate the dashboards')).toBeVisible()

  await issuePage().getByRole('button', { name: 'Back to issues' }).click()
  await expect(issuePage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('keeps the Tree where it was scrolled while the page is open', async () => {
  await app.close()
  ;({ app, window } = await launch(stateDir, { JM_E2E_BULK: '300' }))
  await logIn(window)
  await expect(item(/PSAPAC-900,/)).toBeVisible()
  await window.keyboard.press('End')
  await expect(item(/PSAPAC-51,/)).toBeVisible()
  const top = await window.evaluate<number>("document.querySelector('[role=tree]').scrollTop")
  expect(top).toBeGreaterThan(1000)

  await window.keyboard.press('Enter')
  await expect(heading('Automate the release notes')).toBeVisible()
  await window.keyboard.press('Escape')

  await expect(tree()).toBeFocused()
  expect(await window.evaluate<number>("document.querySelector('[role=tree]').scrollTop")).toBe(top)
  await expect(item(/PSAPAC-51,/)).toHaveAttribute('data-active', 'true')
})

test('shows the properties of an issue, and its description, subtasks and parent', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')

  await expect(picker('Status', 'In Progress')).toBeVisible()
  await expect(picker('Assignee', 'Test User')).toBeVisible()
  await expect(picker('Priority', 'Medium')).toBeVisible()
  await expect(picker('Labels', 'None')).toBeVisible()
  await expect(picker('Type', 'Story')).toBeVisible()
  await expect(picker('Parent', 'PSAPAC-10 Customer onboarding')).toBeVisible()
  await expect(picker('Customer', 'Acme')).toBeVisible()
  await expect(picker('Engagement', 'North')).toBeVisible()
  await expect(picker('Sprint', 'Backlog')).toBeVisible()
  await expect(props().getByLabel('Start date')).toHaveValue('')
  await expect(props().getByLabel('Due date')).toHaveValue('')
  await expect(props().getByLabel('Original estimate')).toHaveValue('2h')
  await expect(props()).toContainText('Remaining estimate, read-only: 2h')
  await expect(props().getByLabel('Time remaining (h)')).toHaveValue('2')
  await expect(issuePage().getByText('No description')).toBeVisible()
})

test('lists the description, the subtasks and the parent, which open their own pages', async () => {
  await openPage(/PSAPAC-11,/, 'Draft the runbook')
  await expect(issuePage().getByRole('button', { name: 'PSAPAC-10', exact: true })).toBeVisible()
  await issuePage()
    .getByRole('button', { name: /PSAPAC-12 Outline the sections/ })
    .click()

  await expect(heading('Outline the sections')).toBeVisible()
  await expect(picker('Type', 'Subtask')).toHaveCount(0)
  await issuePage().getByRole('button', { name: 'PSAPAC-11', exact: true }).click()
  await expect(heading('Draft the runbook')).toBeVisible()
})

test('shows the description in the page', async () => {
  await openPage(/PSAPAC-1,/, 'Kick off the engagement')
  await expect(issuePage().getByText('Agree the scope with the sponsor.')).toBeVisible()
})

test('hides Sprint, Parent and the estimates on an Epic, and shows its type as text', async () => {
  await openPage(/PSAPAC-10,/, 'Customer onboarding')

  await expect(picker('Status', 'To Do')).toBeVisible()
  await expect(props().getByRole('button', { name: /^Sprint:/ })).toHaveCount(0)
  await expect(props().getByRole('button', { name: /^Parent:/ })).toHaveCount(0)
  await expect(props().getByRole('button', { name: /^Type:/ })).toHaveCount(0)
  await expect(props().getByLabel('Original estimate')).toHaveCount(0)
  await expect(props().getByText('Epic', { exact: true })).toBeVisible()
})

test('changes the status from the keyboard, then reads that one issue and no list', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  const before = await counts(app)

  await picker('Status', 'In Progress').focus()
  await window.keyboard.press('ArrowDown')
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeVisible()
  // Only the statuses the issue can reach are listed, once Jira has said which.
  await expect(option('To Do')).toBeVisible()
  await expect(option('Done')).toBeVisible()
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('Enter')

  // The new status shows before Jira answers.
  await expect(picker('Status', 'To Do')).toBeVisible()
  await expect(picker('Status', 'To Do')).toBeFocused()
  await expect.poll(writes).toBe(before.edits + 1)
  expect((await counts(app)).applied).toBe(before.applied)
  expect(await lastBody()).toEqual({ transition: { id: 't1' } })

  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(2)
  const after = await counts(app)
  expect(after.issueReads).toEqual(['PSAPAC-4', 'PSAPAC-4'])
  expect(after.searches).toEqual(before.searches)
  await expect(picker('Status', 'To Do')).toBeVisible()
})

test('moves an issue to Done into its parent chip without reloading either list', async () => {
  await open()
  await releaseDone(app)
  await expect(item('2 done', true)).toBeVisible()
  await item(/PSAPAC-4,/).click()
  await window.keyboard.press('Enter')
  await expect(heading('Migrate the dashboards')).toBeVisible()
  const before = await counts(app)

  await picker('Status', 'In Progress').click()
  await option('Done').click()
  await settle(before.edits + 1)
  await expect(picker('Status', 'Done')).toBeVisible()
  await issuePage().getByRole('button', { name: 'Back to issues' }).click()

  await expect(item('3 done', true)).toBeVisible()
  await expect(item(/PSAPAC-4,/)).toHaveCount(0)
  expect((await counts(app)).searches).toEqual(before.searches)
})

test('lists Me and recent assignees first, then searches for anyone else', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')
  await expect(picker('Assignee', 'Unassigned')).toBeVisible()

  await picker('Assignee', 'Unassigned').click()
  const options = window.getByRole('listbox', { name: 'Assignee' }).getByRole('option')
  await expect(options).toHaveCount(4)
  await expect(options.nth(0)).toContainText('Unassigned')
  await expect(options.nth(1)).toContainText('Me')
  await expect(options.nth(1)).toContainText('Test User')
  // Other User is on two loaded issues; Cy Young is on none, so only the search finds them.
  await expect(options.nth(2)).toContainText('Other User')
  await expect(options.nth(3)).toContainText('Cy Young')

  await window.getByRole('combobox', { name: 'Search Assignee' }).fill('cy')
  await expect(options).toHaveCount(1)
  await option('Cy Young').click()
  await expect(picker('Assignee', 'Cy Young')).toBeVisible()
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { assignee: { accountId: 'u3' } } })

  await picker('Assignee', 'Cy Young').click()
  await option('Unassigned').click()
  await expect(picker('Assignee', 'Unassigned')).toBeVisible()
  await settle(2)
  expect(await lastBody()).toEqual({ fields: { assignee: null } })
})

test('assigns the issue to me', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')
  await picker('Assignee', 'Unassigned').click()
  await option(/^Me/).click()

  await expect(picker('Assignee', 'Test User')).toBeVisible()
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { assignee: { accountId: 'u1' } } })
})

test('adds, creates and removes labels, and refuses a label with a space', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')

  await picker('Labels', 'None').click()
  // Labels are site-wide in Jira, so the list is the project's own: those on the loaded issues.
  await expect(option('docs')).toBeVisible()
  await option('docs').click()
  await expect(picker('Labels', 'docs')).toBeVisible()
  await expect.poll(writes).toBe(1)
  expect(await lastBody()).toEqual({ fields: {}, update: { labels: [{ add: 'docs' }] } })

  const search = window.getByRole('combobox', { name: 'Search Labels' })
  await search.fill('two words')
  await expect(option(/^Create/)).toHaveCount(0)
  await search.fill('needs-review')
  await option('Create "needs-review"').click()
  await expect(picker('Labels', 'docs, needs-review')).toBeVisible()
  await expect.poll(writes).toBe(2)
  expect(await lastBody()).toEqual({ fields: {}, update: { labels: [{ add: 'needs-review' }] } })

  await search.fill('')
  await option('docs').click()
  await expect(picker('Labels', 'needs-review')).toBeVisible()
  await expect.poll(writes).toBe(3)
  expect(await lastBody()).toEqual({ fields: {}, update: { labels: [{ remove: 'docs' }] } })

  await releaseEdit(app)
  await releaseEdit(app)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(3)
  // One read after the last of the three settles.
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(2)
  await expect(picker('Labels', 'needs-review')).toBeVisible()
})

test('moves between sprints, keeping undated and closed ones behind Show all', async () => {
  await openPage(/PSAPAC-13,/, 'Book the kickoff')
  await expect(picker('Sprint', 'Sprint 5')).toBeVisible()

  await picker('Sprint', 'Sprint 5').click()
  const list = window.getByRole('listbox', { name: 'Sprint' })
  await expect(option('Backlog')).toBeVisible()
  await expect(option(/^Sprint 5/)).toBeVisible()
  await expect(option(/^Sprint 6/)).toBeVisible()
  await expect(list.getByRole('option')).toHaveCount(3)

  await window.getByRole('button', { name: 'Show all sprints' }).click()
  await expect(list.getByRole('option')).toHaveCount(5)
  await expect(option(/^PS TEMPLATES/)).toBeVisible()
  // Jira refuses a move into a closed sprint, so it can be seen but not chosen.
  await expect(option(/^Sprint 4/)).toHaveAttribute('aria-disabled', 'true')
  await option(/^Sprint 4/).click({ force: true })
  expect(await writes()).toBe(0)

  await option(/^Sprint 6/).click()
  await expect(picker('Sprint', 'Sprint 6')).toBeVisible()
  await settle(1)
  expect(await lastBody()).toEqual({ issues: ['PSAPAC-13'] })

  await picker('Sprint', 'Sprint 6').click()
  await option('Backlog').click()
  await expect(picker('Sprint', 'Backlog')).toBeVisible()
  await settle(2)
  expect(await lastBody()).toEqual({ issues: ['PSAPAC-13'] })
  await expect(picker('Sprint', 'Backlog')).toBeVisible()
})

test('sets the Customer, Engagement, priority and type, and lists only Story, Task and Bug', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')

  await picker('Customer', 'Acme').click()
  await window.getByRole('combobox', { name: 'Search Customer' }).fill('beta')
  await option('Beta Ltd').click()
  await expect(picker('Customer', 'Beta Ltd')).toBeVisible()
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { customfield_1: { id: '2' } } })

  await picker('Engagement', 'North').click()
  await option('South').click()
  await expect(picker('Engagement', 'South')).toBeVisible()
  await settle(2)
  expect(await lastBody()).toEqual({ fields: { customfield_2: { id: '8' } } })

  await picker('Priority', 'Medium').click()
  await option('Low').click()
  await expect(picker('Priority', 'Low')).toBeVisible()
  await settle(3)
  expect(await lastBody()).toEqual({ fields: { priority: { id: '4' } } })

  await picker('Type', 'Bug').click()
  await expect(window.getByRole('listbox', { name: 'Type' }).getByRole('option')).toHaveCount(3)
  await option('Task').click()
  await expect(picker('Type', 'Task')).toBeVisible()
  await settle(4)
  expect(await lastBody()).toEqual({ fields: { issuetype: { name: 'Task' } } })
})

test('puts the old priority back and says why when Jira refuses it', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')

  await picker('Priority', 'Medium').click()
  await option('Highest').click()
  await expect(picker('Priority', 'Highest')).toBeVisible()
  await expect.poll(writes).toBe(1)

  await releaseEdit(app)
  await expect(picker('Priority', 'Medium')).toBeVisible()
  await expect(alert()).toContainText('Could not change the priority')
  await expect(alert()).toContainText('PSAPAC-3 shows its old value again')
  await expect(alert()).toContainText('The fake refuses this priority')
})

test('saves a date when focus leaves the field, clears it, and abandons an edit on Esc', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  const due = props().getByLabel('Due date')

  await due.fill('2026-12-24')
  expect(await writes()).toBe(0)
  // Tab would step through the day, month and year segments first, so leave the field outright.
  await due.blur()
  await expect(due).toHaveValue('2026-12-24')
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { duedate: '2026-12-24' } })

  await due.fill('2027-01-05')
  await window.keyboard.press('Escape')
  await expect(due).toHaveValue('2026-12-24')
  // Esc in a field abandons the edit; it does not leave the page.
  await expect(heading('Migrate the dashboards')).toBeVisible()

  await due.fill('')
  await window.keyboard.press('Enter')
  await settle(2)
  expect(await lastBody()).toEqual({ fields: { duedate: null } })

  const start = props().getByLabel('Start date')
  await start.fill('2026-10-12')
  await window.keyboard.press('Enter')
  await settle(3)
  expect(await lastBody()).toEqual({ fields: { customfield_4: '2026-10-12' } })
})

test('edits the estimate, shows the remaining estimate Jira cascades, and refuses a bad duration', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  const estimate = props().getByLabel('Original estimate')

  await estimate.fill('4h')
  await window.keyboard.press('Enter')
  await expect(estimate).toHaveValue('4h')
  await expect.poll(writes).toBe(1)
  expect(await lastBody()).toEqual({
    fields: {},
    update: { timetracking: [{ edit: { originalEstimate: '4h' } }] },
  })
  // Only the estimate is guessed. The remaining estimate and Time remaining wait for Jira.
  await expect(props()).toContainText('Remaining estimate, read-only: 2h')

  await releaseEdit(app)
  await expect(props()).toContainText('Remaining estimate, read-only: 4h')
  await expect(props().getByLabel('Time remaining (h)')).toHaveValue('4')

  await estimate.fill('soon')
  await window.keyboard.press('Tab')
  await expect(props().getByText('Use a duration such as 2h 30m.')).toBeVisible()
  await expect(estimate).toHaveAttribute('aria-invalid', 'true')
  expect(await writes()).toBe(1)

  const remaining = props().getByLabel('Time remaining (h)')
  await remaining.fill('3')
  await window.keyboard.press('Enter')
  await settle(2)
  expect(await lastBody()).toEqual({ fields: { customfield_5: 3 } })
})

test('asks about the Customer and Engagement when a new parent differs, and moves with them', async () => {
  await openPage(/PSAPAC-1,/, 'Kick off the engagement')

  await picker('Parent', /^Parent: PSAPAC-10/).click()
  await window.getByRole('combobox', { name: 'Search Parent' }).fill('Reporting')
  await option(/PSAPAC-30/).click()

  const dialog = window.getByRole('dialog', { name: 'Move PSAPAC-1 under PSAPAC-30?' })
  await expect(dialog).toContainText('Customer Beta Ltd and Engagement South')
  expect(await writes()).toBe(0)
  await dialog.getByRole('button', { name: 'Move and set Customer and Engagement' }).click()

  await expect(picker('Parent', 'PSAPAC-30 Reporting')).toBeVisible()
  await expect(picker('Customer', 'Beta Ltd')).toBeVisible()
  await expect(picker('Engagement', 'South')).toBeVisible()
  await settle(1)
  expect(await lastBody()).toEqual({
    fields: {
      parent: { key: 'PSAPAC-30' },
      customfield_1: { id: '2' },
      customfield_2: { id: '8' },
    },
  })
})

test('moves under the new parent alone when told to keep the Customer, and sends nothing on Esc', async () => {
  await openPage(/PSAPAC-2,/, 'Review the data model')

  await picker('Parent', /^Parent: PSAPAC-10/).click()
  await option(/PSAPAC-30/).click()
  const dialog = window.getByRole('dialog', { name: 'Move PSAPAC-2 under PSAPAC-30?' })
  await expect(dialog).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await writes()).toBe(0)
  await expect(picker('Parent', /^Parent: PSAPAC-10/)).toBeVisible()
  // Esc cancelled the question; it did not leave the page.
  await expect(heading('Review the data model')).toBeVisible()

  await picker('Parent', /^Parent: PSAPAC-10/).click()
  await option(/PSAPAC-30/).click()
  await dialog.getByRole('button', { name: 'Move only' }).click()
  await expect(picker('Parent', 'PSAPAC-30 Reporting')).toBeVisible()
  await expect(picker('Customer', 'Acme')).toBeVisible()
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { parent: { key: 'PSAPAC-30' } } })
})

test('moves under a parent with the same Customer and Engagement without asking', async () => {
  await openPage(/PSAPAC-31,/, 'Build the monthly report')

  await picker('Parent', /^Parent: PSAPAC-30/).click()
  await option(/PSAPAC-10/).click()

  await expect(window.getByRole('dialog')).toHaveCount(0)
  await expect(picker('Parent', 'PSAPAC-10 Customer onboarding')).toBeVisible()
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { parent: { key: 'PSAPAC-10' } } })
})

test("matches the Epic's Customer from the Peek with one click", async () => {
  await open()
  const flagged = item(/PSAPAC-31,/)
  await expect(flagged).toHaveAttribute('aria-label', /Customer differs from Epic/)
  await flagged.click()
  await expect(peek().getByText(/Customer differs from the Epic/)).toBeVisible()

  await peek().getByRole('button', { name: "Match Epic's Customer" }).click()

  // Both the Peek and the row drop the mismatch before Jira answers.
  await expect(peek().getByText(/Customer differs from the Epic/)).toHaveCount(0)
  await expect(flagged).not.toHaveAttribute('aria-label', /Customer differs/)
  await expect(peek().getByText('Beta Ltd')).toBeVisible()
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { customfield_1: { id: '2' } } })
  await expect.poll(async () => (await counts(app)).issueReads).toEqual(['PSAPAC-31'])
})

test("matches the Epic's Customer from the issue page", async () => {
  await openPage(/PSAPAC-31,/, 'Build the monthly report')
  await expect(issuePage().getByText(/Customer differs from the Epic/)).toBeVisible()

  await issuePage().getByRole('button', { name: "Match Epic's Customer" }).click()

  await expect(picker('Customer', 'Beta Ltd')).toBeVisible()
  await expect(issuePage().getByText(/Customer differs from the Epic/)).toHaveCount(0)
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { customfield_1: { id: '2' } } })
})

test('opens the page from the Peek with its Open button, and reaches the Peek by Tab', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await expect(peek()).toBeVisible()

  await window.keyboard.press('Tab')
  const open_ = peek().getByRole('button', { name: 'Open' })
  await expect(open_).toBeFocused()
  expect(
    await window.evaluate<string>('getComputedStyle(document.activeElement).outlineStyle'),
  ).toBe('solid')
  await window.keyboard.press('Enter')
  await expect(heading('Migrate the dashboards')).toBeVisible()
})

test('every picker opens from the keyboard and returns focus to its button on Esc', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')

  for (const [label, value] of [
    ['Status', 'To Do'],
    ['Assignee', 'Unassigned'],
    ['Priority', 'Medium'],
    ['Labels', 'None'],
    ['Type', 'Bug'],
    ['Customer', 'Acme'],
    ['Engagement', 'North'],
    ['Sprint', 'Backlog'],
  ] as const) {
    const trigger = picker(label, value)
    await trigger.focus()
    await window.keyboard.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(window.getByRole('listbox', { name: label })).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
  }
  // Esc inside a picker closed the picker; the page is still there.
  await expect(heading('Fix the export timeout')).toBeVisible()
  expect(await writes()).toBe(0)
})
