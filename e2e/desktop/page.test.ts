import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import {
  counts,
  failComments,
  failRead,
  failTransitions,
  fieldsOf,
  launch,
  logIn,
  notices,
  peekRow,
  releaseDone,
  releaseEdit,
  releaseNewestEdit,
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
const heading = (name: string) => issuePage().getByRole('heading', { name })
const summary = (name: string) => issuePage().getByRole('button', { name })
const picker = (label: string, value: string | RegExp) =>
  props().getByRole('button', { name: typeof value === 'string' ? `${label}: ${value}` : value })
const option = (name: string | RegExp) => window.getByRole('option', { name })
const alert = () => notices(window).getByRole('alert')

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
  await peekRow(item(row))
  // The Peek reads the description once it has held still on the row.
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(1)
  await window.keyboard.press('Enter')
  await expect(heading(title)).toBeVisible()
  // The page reads its own copy again on opening.
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(2)
}

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1)

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

test('shows the type icon in the Peek and in the page header', async () => {
  await open()
  await peekRow(item(/PSAPAC-4,/))
  await expect(peek().getByRole('img', { name: 'Story' })).toBeVisible()

  await window.keyboard.press('Enter')
  await expect(heading('Migrate the dashboards').first()).toBeVisible()
  await expect(
    issuePage()
      .getByRole('heading', { name: /PSAPAC-4/ })
      .getByRole('img', { name: 'Story' }),
  ).toBeVisible()
})

test('Enter opens the full page and Esc returns to the Tree, while Space keeps the Peek', async () => {
  await open()
  await peekRow(item(/PSAPAC-4,/))
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

/** Where on a summary the pointer lands: on its text. */
const ON_TEXT = { x: 20, y: 8 }

/** A row's blank space: its issue key takes no click of its own, so a double-click on it opens the page. */
const blank = (row: Locator) => row.locator('.tree-key')

test("a double-click on a row's blank space opens its page, and Esc returns to the Tree with the row active", async () => {
  await open()
  const row = item(/PSAPAC-4,/)
  await blank(row).dblclick()
  await expect(heading('Migrate the dashboards')).toBeVisible()

  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(row).toHaveAttribute('data-active', 'true')
  await expect(tree()).toHaveAttribute('aria-activedescendant', /PSAPAC-4$/)

  // An Epic opens its own page.
  await blank(item(/PSAPAC-10,/)).dblclick()
  await expect(heading('Customer onboarding')).toBeVisible()
})

/** Slows the renderer, so a render can land between the pointer's move and the clicks of a double-click. */
async function throttle(rate: number) {
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
}

for (const rate of [1, 20]) {
  test(`a double-click opens the issue under it while hover renders late, at ${String(rate)}x CPU`, async () => {
    await open()
    await throttle(rate)
    const row = item(/PSAPAC-4,/)
    await blank(row).dblclick()
    await expect(heading('Migrate the dashboards')).toBeVisible()

    await window.keyboard.press('Escape')
    await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')
  })
}

test('a double-click on a checkbox, status dot, avatar, chevron or with Shift held opens no page', async () => {
  await open()
  const row = item(/PSAPAC-4,/)
  await row.locator('[data-check]').dblclick({ force: true })
  await expect(issuePage()).toHaveCount(0)
  await row
    .getByText('Migrate the dashboards')
    .dblclick({ position: ON_TEXT, modifiers: ['Shift'] })
  await expect(issuePage()).toHaveCount(0)
  await item(/PSAPAC-10,/)
    .locator('[data-chevron]')
    .dblclick()
  await expect(issuePage()).toHaveCount(0)
  for (const pick of ['status', 'assignee']) {
    await row.locator(`[data-pick=${pick}]`).dblclick()
    await expect(issuePage()).toHaveCount(0)
    await window.keyboard.press('Escape')
  }

  // The same row still opens from its blank space, so the checks above could have failed.
  await blank(row).dblclick()
  await expect(heading('Migrate the dashboards')).toBeVisible()
})

test('a double-click on a Customer header toggles it as two clicks do and opens no page', async () => {
  await open()
  const header = item('Acme, 8 issues', true)
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await header.dblclick()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await expect(issuePage()).toHaveCount(0)
})

test('Back to issues returns from the page to the Tree', async () => {
  await open()
  await peekRow(item(/PSAPAC-4,/))
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
  await expect(props().getByLabel('Time left')).toHaveValue('2h')
  await expect(issuePage().getByText('No description')).toBeVisible()
})

test('lists the description, the subtasks and the parent, which open their own pages', async () => {
  await openPage(/PSAPAC-11,/, 'Draft the runbook')
  await expect(
    issuePage().getByRole('button', { name: /^Epic PSAPAC-10 Customer onboarding/ }),
  ).toBeVisible()
  await issuePage()
    .getByRole('button', { name: /PSAPAC-12 Outline the sections/ })
    .click()

  await expect(heading('Outline the sections')).toBeVisible()
  await expect(picker('Type', 'Subtask')).toHaveCount(0)
  // Q20: a Subtask has no Sprint, though it has a parent and the estimates.
  await expect(props().getByRole('button', { name: /^Sprint:/ })).toHaveCount(0)
  await expect(props().getByRole('button', { name: /^Parent:/ })).toBeVisible()
  await expect(props().getByLabel('Original estimate')).toBeVisible()
  // The button that opened this page is gone, so focus must be on the page, where Esc leaves.
  await expect(issuePage()).toBeFocused()
  await issuePage()
    .getByRole('button', { name: /^Story PSAPAC-11 Draft the runbook/ })
    .click()
  await expect(heading('Draft the runbook')).toBeVisible()
  await expect(issuePage()).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
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
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(3)
  const after = await counts(app)
  expect(after.issueReads).toEqual(['PSAPAC-4', 'PSAPAC-4', 'PSAPAC-4'])
  expect(after.searches).toEqual(before.searches)
  await expect(picker('Status', 'To Do')).toBeVisible()
})

test('moves an issue to Done into its parent chip without reloading either list', async () => {
  await open()
  await releaseDone(app)
  // The chip shows only while "Hide done" is off.
  await window.getByRole('button', { name: 'Hide done', exact: true }).click()
  await expect(item('2 done', true)).toBeVisible()
  await peekRow(item(/PSAPAC-4,/))
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
  // Each run of options sits in a named group.
  await expect(window.getByRole('group', { name: 'Suggested' }).getByRole('option')).toHaveCount(3)
  await expect(window.getByRole('group', { name: 'People' }).getByRole('option')).toHaveCount(1)

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

  await search.fill('')
  await option('docs').click()
  await expect(picker('Labels', 'needs-review')).toBeVisible()
  // Each edit shows at once, but goes to Jira only once Jira has answered the one before.
  expect(await writes()).toBe(1)

  await releaseEdit(app)
  await expect.poll(writes).toBe(2)
  expect(await lastBody()).toEqual({ fields: {}, update: { labels: [{ add: 'needs-review' }] } })
  await releaseEdit(app)
  await expect.poll(writes).toBe(3)
  expect(await lastBody()).toEqual({ fields: {}, update: { labels: [{ remove: 'docs' }] } })
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(3)
  // One read after the last of the three settles.
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(3)
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

test('the Type picker shows each type icon, grey except Bug, and leaves the property names readable', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')
  const trigger = picker('Type', 'Bug')
  await trigger.click()

  const types = window.getByRole('listbox', { name: 'Type' })
  const box = await types.locator('xpath=..').boundingBox()
  expect(box?.width).toBe(208)
  // The button sits right of the property names, so a popover that starts at its edge covers none.
  expect(box?.x).toBeGreaterThanOrEqual((await trigger.boundingBox())?.x ?? Infinity)

  const painted = (css: string) =>
    window.evaluate((value) => {
      const probe = document.createElement('span')
      probe.style.color = value
      document.body.append(probe)
      const colour = getComputedStyle(probe).color
      probe.remove()
      return colour
    }, css)
  const colourOf = (type: string) =>
    types
      .getByRole('option', { name: type, exact: true })
      .locator('.type-icon')
      .evaluate((icon) => getComputedStyle(icon).color)

  await window.mouse.move(0, 0)
  expect(await colourOf('Task')).toBe(await painted('var(--type-rest)'))
  expect(await colourOf('Story')).toBe(await painted('var(--type-rest)'))
  expect(await colourOf('Bug')).toBe(await painted('var(--type-bug)'))

  await types.getByRole('option', { name: 'Story', exact: true }).hover()
  expect(await colourOf('Story')).toBe(await painted('var(--type-story)'))
})

test('puts the old priority back and says why when Jira refuses it', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')

  await picker('Priority', 'Medium').click()
  await option('Highest').click()
  await expect(picker('Priority', 'Highest')).toBeVisible()
  await expect.poll(writes).toBe(1)

  await releaseEdit(app)
  await expect(picker('Priority', 'Medium')).toBeVisible()
  await expect(alert()).toContainText('Priority not changed. Jira refused it:')
  await expect(alert()).toContainText('The fake refuses this priority')
  // The page shows the refusal in the toast, not under the properties.
  await expect(props().getByRole('alert')).toHaveCount(0)
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

  // Clearing one segment of the date reads as "" too, but it is half an edit, not a cleared date.
  await due.focus()
  await window.keyboard.press('Backspace')
  await due.blur()
  await expect(due).toHaveValue('2026-12-24')
  expect(await writes()).toBe(1)

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

test('sends a date once when Enter is followed at once by leaving the field', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  const due = props().getByLabel('Due date')

  await due.fill('2027-02-02')
  // One task, so the blur lands before Jira's answer re-renders the field.
  await window.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Due date"]')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.blur()
  })()`)
  await settle(1)
  expect(await writes()).toBe(1)
  expect(await lastBody()).toEqual({ fields: { duedate: '2027-02-02' } })
})

test('sends a second edit of the same field only once Jira has answered the first', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')
  const due = props().getByLabel('Due date')

  // One task, so neither edit is replaced by Jira's answer to the other.
  await window.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Due date"]')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const type = (value) => {
      set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    input.focus()
    type('2027-02-02')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    type('2027-03-03')
    input.blur()
  })()`)
  // Jira answers the newest write it holds first, as a network may. Two writes held at once would
  // land newest first and leave the older date in Jira, so only one may be out at a time.
  await expect.poll(writes).toBe(1)
  await releaseNewestEdit(app)
  await expect.poll(writes).toBe(2)
  await releaseNewestEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(2)
  expect((await counts(app)).editBodies).toEqual([
    { fields: { duedate: '2027-02-02' } },
    { fields: { duedate: '2027-03-03' } },
  ])
  expect((await fieldsOf(app, 'PSAPAC-4'))?.duedate).toBe('2027-03-03')
  // The read after the last edit shows what Jira holds.
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(3)
  await expect(due).toHaveValue('2027-03-03')
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
  await expect(props().getByLabel('Time left')).toHaveValue('4h')

  await estimate.fill('soon')
  await window.keyboard.press('Tab')
  await expect(props().getByText('Use a duration such as 2h 30m.')).toBeVisible()
  await expect(estimate).toHaveAttribute('aria-invalid', 'true')
  expect(await writes()).toBe(1)

  await estimate.press('Escape')
  const remaining = props().getByLabel('Time left')
  await remaining.fill('1h 30m')
  await window.keyboard.press('Enter')
  await settle(2)
  expect(await lastBody()).toEqual({ fields: { customfield_5: 1.5 } })
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(4)
  // The page renders a tick after Jira answers, and the re-read replaces the draft: type again
  // only once the toast and the settled row show it.
  await expect(notices(window).getByText('PSAPAC-4: time left changed to 1h 30m')).toBeVisible()
  await expect(props().locator('[data-pending]')).toHaveCount(0)
  expect((await fieldsOf(app, 'PSAPAC-4'))?.customfield_5).toBe(1.5)

  await remaining.fill('15m')
  await window.keyboard.press('Enter')
  await settle(3)
  expect(await lastBody()).toEqual({ fields: { customfield_5: 0.25 } })
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(5)
  await expect(notices(window).getByText('PSAPAC-4: time left changed to 15m')).toBeVisible()
  await expect(props().locator('[data-pending]')).toHaveCount(0)
  expect((await fieldsOf(app, 'PSAPAC-4'))?.customfield_5).toBe(0.25)

  // An empty entry clears the field in Jira.
  await remaining.fill('')
  await window.keyboard.press('Enter')
  await settle(4)
  expect(await lastBody()).toEqual({ fields: { customfield_5: null } })
  await expect.poll(async () => (await counts(app)).issueReads.length).toBe(6)
  await expect(notices(window).getByText('PSAPAC-4: time left changed to none')).toBeVisible()
  await expect(props().locator('[data-pending]')).toHaveCount(0)
  expect((await fieldsOf(app, 'PSAPAC-4'))?.customfield_5).toBeNull()

  await remaining.fill('1.5')
  await window.keyboard.press('Tab')
  await expect(props().getByText('Use a duration such as 2h 30m.')).toBeVisible()
  await expect(remaining).toHaveAttribute('aria-invalid', 'true')
  expect(await writes()).toBe(4)
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

  await expect(picker('Parent', 'PSAPAC-30 Reporting')).toBeFocused()
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
  // Esc cancelled the question; it did not leave the page, and focus is back on the Parent button.
  await expect(picker('Parent', /^Parent: PSAPAC-10/)).toBeFocused()
  await expect(heading('Review the data model')).toBeVisible()

  await picker('Parent', /^Parent: PSAPAC-10/).click()
  await option(/PSAPAC-30/).click()
  await dialog.getByRole('button', { name: 'Move only' }).click()
  await expect(picker('Parent', 'PSAPAC-30 Reporting')).toBeFocused()
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
  await peekRow(flagged)
  await expect(peek().getByText(/Customer differs from the Epic/)).toBeVisible()
  // The Peek reads the description once it has held still, before the edit below.
  await expect.poll(async () => (await counts(app)).issueReads).toEqual(['PSAPAC-31'])

  await peek().getByRole('button', { name: "Match Epic's Customer" }).click()

  // Both the Peek and the row drop the mismatch before Jira answers.
  await expect(peek().getByText(/Customer differs from the Epic/)).toHaveCount(0)
  await expect(flagged).not.toHaveAttribute('aria-label', /Customer differs/)
  await expect(peek().getByText('Beta Ltd')).toBeVisible()
  await settle(1)
  expect(await lastBody()).toEqual({ fields: { customfield_1: { id: '2' } } })
  await expect.poll(async () => (await counts(app)).issueReads).toEqual(['PSAPAC-31', 'PSAPAC-31'])
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
  await peekRow(item(/PSAPAC-4,/))
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

test('a click on Cancel in the Customer prompt returns focus to the Parent button', async () => {
  await openPage(/PSAPAC-2,/, 'Review the data model')
  await picker('Parent', /^Parent: PSAPAC-10/).click()
  await option(/PSAPAC-30/).click()

  await window
    .getByRole('dialog', { name: 'Move PSAPAC-2 under PSAPAC-30?' })
    .getByRole('button', { name: 'Cancel' })
    .click()

  await expect(picker('Parent', /^Parent: PSAPAC-10/)).toBeFocused()
  expect(await writes()).toBe(0)
})

test('ending a summary edit returns focus to the page, so Esc still leaves it', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')

  await summary('Fix the export timeout').click()
  await window.keyboard.press('Escape')
  await expect(issuePage()).toBeFocused()

  await summary('Fix the export timeout').click()
  await issuePage().getByLabel('Summary').fill('Fix the export time limit')
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeFocused()
  await expect(heading('Fix the export time limit')).toBeVisible()
  await settle(1)

  await window.keyboard.press('Escape')
  await expect(issuePage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('clicking the summary edits it in place, with the caret where it landed', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')
  const field = () => issuePage().getByLabel('Summary')
  const caret = () => field().evaluate((input: HTMLInputElement) => input.selectionStart)

  // Near the left edge the caret sits before the first character.
  await summary('Fix the export timeout').click({ position: { x: 10, y: 10 } })
  await expect(field()).toBeFocused()
  await expect(field()).toHaveValue('Fix the export timeout')
  expect(await caret()).toBe(0)
  await window.keyboard.press('Escape')

  // Past the end of the text the caret sits after the last character.
  const box = await summary('Fix the export timeout').boundingBox()
  await summary('Fix the export timeout').click({ position: { x: (box?.width ?? 0) - 4, y: 10 } })
  expect(await caret()).toBe('Fix the export timeout'.length)
  await window.keyboard.press('Escape')

  // In the middle it sits between characters.
  await summary('Fix the export timeout').click({ position: { x: 60, y: 10 } })
  const middle = await caret()
  expect(middle).toBeGreaterThan(0)
  expect(middle).toBeLessThan('Fix the export timeout'.length)
})

test('Enter saves a clicked summary through the optimistic edit, and Cmd+Z undoes it', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')

  await summary('Fix the export timeout').click()
  await issuePage().getByLabel('Summary').fill('Fix the export time limit')
  await window.keyboard.press('Enter')
  await expect(heading('Fix the export time limit')).toBeVisible()
  await settle(1)

  await window.keyboard.press('Meta+z')
  await expect(heading('Fix the export timeout')).toBeVisible()
  await settle(2)
})

test('focus leaving saves the summary, Esc cancels it, and an empty one is refused', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')
  const field = () => issuePage().getByLabel('Summary')

  // Focus leaving saves.
  await summary('Fix the export timeout').click()
  await field().fill('Fix the export time limit')
  await issuePage().getByRole('heading', { name: 'Description' }).click()
  await expect(field()).toHaveCount(0)
  await expect(heading('Fix the export time limit')).toBeVisible()
  await settle(1)

  // Esc restores the old summary and sends nothing.
  await summary('Fix the export time limit').click()
  await field().fill('Never saved')
  await window.keyboard.press('Escape')
  await expect(heading('Fix the export time limit')).toBeVisible()
  expect(await writes()).toBe(1)

  // An empty summary is refused: the old one returns and nothing is sent.
  await summary('Fix the export time limit').click()
  await field().fill('   ')
  await window.keyboard.press('Enter')
  await expect(heading('Fix the export time limit')).toBeVisible()
  await expect(issuePage().getByRole('alert')).toContainText('cannot be empty')
  expect(await writes()).toBe(1)

  // The next edit clears the notice.
  await summary('Fix the export time limit').click()
  await expect(issuePage().getByRole('alert')).toHaveCount(0)
})

test('offers Retry when the page cannot read its issue, and shows the description after it', async () => {
  await open()
  // The Peek reads first, and says so when it fails.
  await failRead(app)
  await peekRow(item(/PSAPAC-1,/))
  await expect(peek().getByText('Could not load the description.')).toBeVisible()
  await failRead(app)
  await window.keyboard.press('Enter')

  // The summary and properties come from the loaded lists, so the page still shows.
  await expect(heading('Kick off the engagement')).toBeVisible()
  const alert = issuePage().getByRole('alert')
  await expect(alert).toContainText('Jira had a problem. Retry in a minute.')
  await expect(alert).not.toContainText('check your connection')
  // Jira's message, which names the request, stays behind Details.
  await expect(alert.getByText('The fake failed this read')).toBeHidden()
  await alert.getByText('Details', { exact: true }).click()
  await expect(alert.getByText('The fake failed this read')).toBeVisible()
  await expect(issuePage().getByText('Loading description')).toHaveCount(0)

  await issuePage().getByRole('button', { name: 'Retry' }).click()
  await expect(issuePage().getByText('Agree the scope with the sponsor.')).toBeVisible()
  await expect(issuePage().getByRole('alert')).toHaveCount(0)
})

test('says the comments no longer exist when Jira answers 404 to their load', async () => {
  await open()
  await peekRow(item(/PSAPAC-1,/))
  await failComments(app, 404)
  await window.keyboard.press('Enter')
  await expect(heading('Kick off the engagement')).toBeVisible()

  const alert = issuePage().getByRole('alert').filter({ hasText: 'The comments' })
  await expect(alert).toContainText('The comments no longer exist in Jira.')
  await expect(alert).not.toContainText('check your connection')
  // Jira's own words stay behind Details.
  await expect(alert.getByText('The fake failed this comments read')).toBeHidden()
  await alert.getByText('Details', { exact: true }).click()
  await expect(alert.getByText('The fake failed this comments read')).toBeVisible()
})

test('says Jira had a problem when it answers 500 to the comments load, and Retry recovers', async () => {
  await open()
  await peekRow(item(/PSAPAC-1,/))
  await failComments(app, 500)
  await window.keyboard.press('Enter')
  await expect(heading('Kick off the engagement')).toBeVisible()

  const alert = issuePage().getByRole('alert').filter({ hasText: 'Jira had a problem' })
  await expect(alert).toContainText('Jira had a problem. Retry in a minute.')
  await expect(alert).not.toContainText('check your connection')
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(alert).toHaveCount(0)
})

test("shows no request path when a picker's lookup fails, until Details opens", async () => {
  await openPage(/PSAPAC-1,/, 'Kick off the engagement')
  await failTransitions(app)

  await picker('Status', 'In Progress').click()

  const note = window.getByRole('status').filter({ hasText: 'Could not load the statuses.' })
  await expect(note).toContainText('Jira answered 500: The fake failed this lookup.')
  // The path sits in the DOM behind the closed disclosure, so only visible text counts.
  const path = window.locator('p:visible', { hasText: '/rest/' })
  await expect(path).toHaveCount(0)
  await note.getByText('Details', { exact: true }).click()
  await expect(path.first()).toContainText('GET /rest/api/3/issue/PSAPAC-1/transitions')
})

test('applying a saved view from the sidebar closes the page and returns to the Tree', async () => {
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')

  // The sidebar stays clickable under the page, whose Tree is inert.
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Current sprint', exact: true })
    .click()

  await expect(issuePage()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(window.getByRole('list', { name: 'Active filters' })).toContainText(
    'Sprint: Current sprint',
  )
})

/** The computed style of the element, as the browser lays it out. */
const styleOf = (locator: Locator) =>
  locator.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      textTransform: s.textTransform,
      borderTopWidth: s.borderTopWidth,
      borderTopStyle: s.borderTopStyle,
      borderTopColor: s.borderTopColor,
      maxWidth: s.maxWidth,
    }
  })

test('sets the page type scale: a 24/600/32 title over 14/22 body, in a 40rem column', async () => {
  await openPage(/PSAPAC-1,/, 'Kick off the engagement')
  const body = issuePage().getByText('Agree the scope with the sponsor.')
  await expect(body).toBeVisible()

  const title = await styleOf(heading('Kick off the engagement'))
  expect(title).toMatchObject({ fontSize: '24px', fontWeight: '600', lineHeight: '32px' })
  const text = await styleOf(body)
  expect(text).toMatchObject({ fontSize: '14px', lineHeight: '22px' })
  expect(parseFloat(title.fontSize) / parseFloat(text.fontSize)).toBeGreaterThanOrEqual(1.5)

  // The window may be narrower than the column, so the cap is the thing to check.
  const column = issuePage().locator('article > div')
  expect((await styleOf(column)).maxWidth).toBe('640px')
  expect((await column.boundingBox())?.width).toBeLessThanOrEqual(640)
})

test('heads each page section in 13/600 sentence case, with a 1px rule above all but the first', async () => {
  await openPage(/PSAPAC-1,/, 'Kick off the engagement')
  const name = (title: string) => issuePage().getByRole('heading', { name: title, exact: true })
  await expect(name('Attachments')).toBeVisible()

  for (const title of ['Description', 'Links', 'Worklogs', 'Activity', 'Attachments']) {
    const style = await styleOf(name(title))
    expect(style, title).toMatchObject({
      fontSize: '13px',
      fontWeight: '600',
      textTransform: 'none',
    })
  }

  const section = (title: string) => issuePage().getByRole('region', { name: title, exact: true })
  expect(await styleOf(section('Description')), 'Description').toMatchObject({
    borderTopWidth: '0px',
  })
  for (const title of ['Links', 'Worklogs', 'Activity', 'Attachments']) {
    const style = await styleOf(section(title))
    expect(style, title).toMatchObject({ borderTopWidth: '1px', borderTopStyle: 'solid' })
    expect(style.borderTopColor, title).not.toBe('rgba(0, 0, 0, 0)')
  }
})

test('starts the description by y=140 in the page', async () => {
  await openPage(/PSAPAC-10,/, 'Customer onboarding')
  const description = issuePage().getByRole('region', { name: 'Description', exact: true })
  await expect(description).toBeVisible()
  expect((await description.boundingBox())?.y).toBeLessThanOrEqual(140)
})

test('starts the description by y=164 under a Sub-issue of line, which adds one row', async () => {
  await openPage(/PSAPAC-1,/, 'Kick off the engagement')
  await expect(issuePage().locator('[data-parent-line]')).toBeVisible()
  const description = issuePage().getByRole('region', { name: 'Description', exact: true })
  await expect(description).toBeVisible()
  expect((await description.boundingBox())?.y).toBeLessThanOrEqual(164)
})

test('wraps a long unbroken summary inside the page instead of overflowing it', async () => {
  await openPage(/PSAPAC-3,/, 'Fix the export timeout')
  const long = `https://example.com/${'a'.repeat(200)}`

  await summary('Fix the export timeout').click()
  await issuePage().getByLabel('Summary').fill(long)
  await window.keyboard.press('Enter')
  const title = summary(long)
  await expect(title).toBeVisible()
  await settle(1)

  const overflow = await title.evaluate((el) => ({
    button: el.scrollWidth - el.clientWidth,
    article: (el.closest('article')?.scrollWidth ?? 0) - (el.closest('article')?.clientWidth ?? 0),
  }))
  expect(overflow).toEqual({ button: 0, article: 0 })
})

const LONG_SUMMARY =
  'Customer onboarding for the Petronas regional rollout and the ABN AMRO pilot programme'

const FONTS = [
  ['the default font', undefined],
  ['a wide font', '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }'],
] as const

for (const [name, css] of FONTS) {
  test(`the Parent picker opens 26rem wide inside the window, and truncates a long summary, in ${name}`, async () => {
    await openPage(/PSAPAC-10,/, 'Customer onboarding')
    await summary('Customer onboarding').click()
    await issuePage().getByLabel('Summary').fill(LONG_SUMMARY)
    await window.keyboard.press('Enter')
    await expect(heading(LONG_SUMMARY)).toBeVisible()
    await settle(1)
    await window.keyboard.press('Escape')
    await peekRow(item(/PSAPAC-4,/))
    await window.keyboard.press('Enter')
    await expect(heading('Migrate the dashboards')).toBeVisible()
    if (css !== undefined) await window.addStyleTag({ content: css })

    const parent = picker('Parent', /^Parent: PSAPAC-10/)
    await parent.click()
    // The popover shows at once, but the picker moves focus into it on the later toggle event. Esc before
    // then lands on the trigger, outside the popover, and the page takes it and goes back.
    await expect(parent).toHaveAttribute('aria-expanded', 'true')
    const listbox = window.getByRole('listbox', { name: 'Parent' })
    const box = await listbox.locator('xpath=..').boundingBox()
    const view = await window.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    expect(box?.width).toBe(416)
    expect(box?.x).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(view.w)
    expect(box?.y).toBeGreaterThanOrEqual(0)
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(view.h)

    // The summary is too long for the row: it ends in an ellipsis, and the accessible name keeps all of it.
    const long = option(new RegExp(LONG_SUMMARY))
    await expect(long).toBeVisible()
    const label = long.locator('span.truncate')
    expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(await label.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis')
    await window.keyboard.press('Escape')

    // Other pickers keep their width.
    await picker('Priority', 'Medium').click()
    const other = await window
      .getByRole('listbox', { name: 'Priority' })
      .locator('xpath=..')
      .boundingBox()
    expect(other?.width).toBe(208)
  })
}
