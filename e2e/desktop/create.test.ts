import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, releaseEdit } from './harness.js'

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
const dialog = () => window.getByRole('dialog', { name: 'New issue' })
const field = (label: string, value: string | RegExp) =>
  dialog().getByRole('button', {
    name: typeof value === 'string' ? `${label}: ${value}` : value,
  })
const option = (name: string | RegExp) =>
  window.getByRole('option', typeof name === 'string' ? { name, exact: true } : { name })
const toast = () => window.getByRole('status').filter({ hasText: /^Created|^Deleted/ })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })

/** The create request for the form filled in below, recorded from the dialog as it was before #133. */
const BODY_OF_EVERY_FIELD = {
  fields: {
    project: { key: 'PSAPAC' },
    issuetype: { name: 'Story' },
    summary: 'Cover every field',
    customfield_1: { id: '1' },
    customfield_2: { id: '7' },
    parent: { key: 'PSAPAC-10' },
    assignee: { accountId: 'u1' },
    priority: { id: '2' },
    labels: ['docs'],
    timetracking: { originalEstimate: '2h 30m' },
  },
}

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under a click.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Makes the row the active one, with the Tree focused. A click also opens the Peek, which Esc closes. */
async function select(row: RegExp) {
  await item(row).click()
  await window.keyboard.press('Escape')
  await expect(item(row)).toHaveAttribute('data-active', 'true')
  await expect(tree()).toBeFocused()
}

async function openCreate(row: RegExp) {
  await select(row)
  await window.keyboard.press('c')
  await expect(dialog()).toBeVisible()
}

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1) as { fields: unknown }

/** Waits for a write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

test('C opens the create modal for a Story under the selected issue Epic, with its Customer and Engagement', async () => {
  await open()
  await select(/PSAPAC-2,/)
  await window.keyboard.press('c')

  await expect(dialog()).toBeVisible()
  await expect(dialog().getByLabel('Summary')).toBeFocused()
  await expect(field('Type', 'Story')).toBeVisible()
  await expect(field('Parent', 'PSAPAC-10 Customer onboarding')).toBeVisible()
  await expect(field('Customer', 'Acme')).toBeVisible()
  await expect(field('Engagement', 'North')).toBeVisible()
  await expect(dialog().getByLabel('Create more')).not.toBeChecked()
  // Nothing about the selection leaks into a field the user has to choose.
  await expect(field('Sprint', 'Backlog')).toBeVisible()
  await expect(field('Assignee', 'Unassigned')).toBeVisible()
})

test('prefills from an Epic, taking the Epic itself as the parent', async () => {
  await open()
  await openCreate(/PSAPAC-30,/)

  await expect(field('Parent', 'PSAPAC-30 Reporting')).toBeVisible()
  await expect(field('Customer', 'Beta Ltd')).toBeVisible()
  await expect(field('Engagement', 'South')).toBeVisible()
})

test('prefills the Customer from a Customer header, and needs an Engagement and a summary', async () => {
  await open()
  await select(/^Beta Ltd, 5 issues$/)
  await window.keyboard.press('c')

  await expect(field('Customer', 'Beta Ltd')).toBeVisible()
  await expect(field('Parent', 'None')).toBeVisible()
  await expect(field('Engagement', 'Required')).toBeVisible()
  const create = dialog().getByRole('button', { name: 'Create issue' })
  await expect(create).toBeDisabled()
  await expect(dialog()).toContainText('Add a summary and an Engagement to create.')

  await dialog().getByLabel('Summary').fill('Plan the audit')
  await expect(create).toBeDisabled()
  await expect(dialog()).toContainText('Add an Engagement to create.')

  await field('Engagement', 'Required').click()
  await option('South').click()
  await expect(create).toBeEnabled()
  await expect(dialog()).toContainText('Ready to create.')
})

test('C does nothing with Cmd or Ctrl, in a text field, or while a picker has the letter', async () => {
  await open()
  await select(/PSAPAC-2,/)

  await window.keyboard.press('Meta+c')
  await window.keyboard.press('Control+c')
  await expect(dialog()).toHaveCount(0)

  // The filter field keeps its letters.
  await window.getByLabel('Filter by key or summary').fill('')
  await window.getByLabel('Filter by key or summary').press('c')
  await expect(window.getByLabel('Filter by key or summary')).toHaveValue('c')
  await expect(dialog()).toHaveCount(0)
  await window.getByLabel('Filter by key or summary').fill('')

  // A listbox with no search field takes the letters too.
  await item(/PSAPAC-4,/).click()
  await window.keyboard.press('Enter')
  // The Peek under the page has a Status picker too, so the query names the page's sidebar.
  const status = window
    .getByRole('complementary', { name: 'Properties' })
    .getByRole('button', { name: /^Status:/ })
  await status.focus()
  await window.keyboard.press('ArrowDown')
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await window.keyboard.press('c')
  await expect(dialog()).toHaveCount(0)
  await window.keyboard.press('Escape')
})

test('the New issue button opens the same modal', async () => {
  await open()
  await select(/PSAPAC-2,/)
  await window.getByRole('button', { name: 'New issue' }).click()

  await expect(dialog()).toBeVisible()
  await expect(field('Parent', 'PSAPAC-10 Customer onboarding')).toBeVisible()
})

test('creates the issue, selects its row and names the key, without reloading a list', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  const before = await counts(app)

  await dialog().getByLabel('Summary').fill('Write the cutover plan')
  await dialog().getByRole('button', { name: 'Create issue' }).click()

  // Jira has not answered: the form is locked and says so.
  await expect.poll(writes).toBe(before.edits + 1)
  await expect(dialog().getByRole('button', { name: 'Creating' })).toBeDisabled()
  await expect(dialog().getByLabel('Summary')).toBeDisabled()
  // Esc cannot abandon a create Jira is still answering.
  await window.keyboard.press('Escape')
  await expect(dialog()).toBeVisible()
  expect(await lastBody()).toMatchObject({
    fields: {
      project: { key: 'PSAPAC' },
      issuetype: { name: 'Story' },
      summary: 'Write the cutover plan',
      customfield_1: { id: '1' },
      customfield_2: { id: '7' },
      parent: { key: 'PSAPAC-10' },
    },
  })

  await releaseEdit(app)
  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText('Created PSAPAC-2000: Write the cutover plan')
  // The Story kept what was chosen, so Jira changed only what its automation always does.
  await expect(toast()).toContainText('Jira added the label PSAPAC.')
  await expect(toast()).toContainText('Original estimate is 4h (you chose none).')
  await expect(toast()).not.toContainText('Customer is')
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('data-active', 'true')
  await expect(tree()).toBeFocused()

  const after = await counts(app)
  expect(after.searches).toEqual(before.searches)
  // One read, the create's own read-back; the new row came from it.
  expect(after.issueReads.filter((key) => key === 'PSAPAC-2000')).toHaveLength(1)
})

test('sends every field of the form to Jira in one create request, then the sprint move', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Summary').fill('Cover every field')
  await field('Assignee', 'Unassigned').click()
  await option(/^Me/).click()
  await field('Priority', 'None').click()
  await option('High').click()
  await field('Labels', 'None').click()
  await option('docs').click()
  await window.keyboard.press('Escape')
  await field('Sprint', 'Backlog').click()
  await option(/^Sprint 6/).click()
  await dialog().getByLabel('Original estimate').fill('2h 30m')
  await dialog().getByRole('button', { name: 'Create issue' }).click()

  await settle(1)
  await settle(2)
  expect((await counts(app)).editBodies).toEqual([BODY_OF_EVERY_FIELD, { issues: ['PSAPAC-2000'] }])
})

test('Type is an icon beside the summary until it opens, then lists every type', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  const type = field('Type', 'Story')
  await expect(type).toHaveText('')
  await expect(type.locator('svg').first()).toBeVisible()
  const [typeBox, summaryBox] = await Promise.all([
    type.boundingBox(),
    dialog().getByLabel('Summary').boundingBox(),
  ])
  expect(typeBox?.x).toBeLessThan(summaryBox?.x ?? 0)

  await type.click()
  const types = window.getByRole('listbox', { name: 'Type' }).getByRole('option')
  await expect(types).toHaveText(['Story', 'Task', 'Bug', 'Epic', 'Subtask'])
  await option('Bug').click()
  await expect(field('Type', 'Bug')).toHaveText('')
})

test('the other fields are chips on two lines', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  const chips = dialog().locator(
    'button[aria-haspopup=listbox]:not([aria-label^="Type:"]), button:has-text("+me"), label:has(input[aria-label="Original estimate"])',
  )
  await expect(chips).toHaveCount(9)
  const tops = new Set(
    await chips.evaluateAll((all) =>
      all.map((chip) => Math.round(chip.getBoundingClientRect().top)),
    ),
  )
  expect(tops.size).toBeLessThanOrEqual(2)
})

test('typing an issue key in the Parent field finds that issue', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  await field('Parent', /^Parent:/).click()
  await window.getByRole('combobox', { name: 'Search Parent' }).fill('PSAPAC-30')
  await expect(window.getByRole('option')).toHaveCount(1)
  await option(/PSAPAC-30/).click()
  await dialog()
    .getByRole('dialog', { name: 'Move this issue under PSAPAC-30?' })
    .getByRole('button', { name: 'Move only' })
    .click()
  await expect(field('Parent', 'PSAPAC-30 Reporting')).toBeVisible()
})

test('+me assigns the current user and shows the name in the Assignee chip', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await expect(field('Assignee', 'Unassigned')).toBeVisible()

  await dialog().getByRole('button', { name: /^\+me/ }).click()
  await expect(field('Assignee', /^Assignee: \S/)).not.toHaveAttribute(
    'aria-label',
    'Assignee: Unassigned',
  )
  await expect(dialog().getByRole('button', { name: /^\+me/ })).toHaveCount(0)

  await dialog().getByLabel('Summary').fill('Mine')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)
  expect(await lastBody()).toMatchObject({ fields: { assignee: { accountId: 'u1' } } })
})

test('Cmd+Enter on an unready form focuses the first missing field and sends nothing', async () => {
  await open()
  await select(/^Beta Ltd, 5 issues$/)
  await window.keyboard.press('c')
  await expect(dialog()).toBeVisible()
  const before = await writes()
  const engagement = dialog().getByRole('button', { name: /^Engagement:/ })
  const estimate = dialog().getByLabel('Original estimate')

  // The summary is first, so focus leaves it for the Type button, then Cmd+Enter brings it back.
  await dialog()
    .getByRole('button', { name: /^Type:/ })
    .focus()
  await window.keyboard.press('Meta+Enter')
  await expect(dialog().getByLabel('Summary')).toBeFocused()

  await dialog().getByLabel('Summary').fill('Plan the audit')
  await window.keyboard.press('Meta+Enter')
  await expect(engagement).toBeFocused()

  await engagement.click()
  await option('South').click()
  await estimate.fill('soon')
  await window.keyboard.press('Meta+Enter')
  await expect(estimate).toBeFocused()
  expect(await writes()).toBe(before)
})

test('shows what the automation changed when Jira rewrites a new Task', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Summary').fill('Book the workshop')
  await field('Type', 'Story').click()
  await option('Task').click()
  await dialog().getByRole('button', { name: 'Create issue' }).click()

  await settle(1)
  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText('Created PSAPAC-2000: Book the workshop')
  await expect(toast()).toContainText('Customer is Collibra (Internal team) (you chose Acme).')
  await expect(toast()).toContainText('Parent is PSAPAC-50 (you chose PSAPAC-10).')
  await expect(toast()).toContainText('Sprint is Sprint 5 (you chose none).')
  await expect(toast()).toContainText('Jira added the label PSAPAC.')
  // The row is where Jira put it, under the internal Epic, not where the form asked.
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('data-active', 'true')
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('aria-level', '3')
  await expect(item(/PSAPAC-50,/)).toBeVisible()
})

test('moves a new issue into the sprint the form chose, after the create', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Summary').fill('Prepare the demo')
  await field('Sprint', 'Backlog').click()
  await option(/^Sprint 6/).click()
  await expect(field('Sprint', 'Sprint 6')).toBeVisible()
  await dialog().getByRole('button', { name: 'Create issue' }).click()

  await settle(1)
  await settle(2)
  expect((await counts(app)).editBodies.at(-1)).toEqual({ issues: ['PSAPAC-2000'] })
  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText('Created PSAPAC-2000: Prepare the demo')
  // Sprint 6 is what was chosen and what the issue holds, so it is not listed as a change.
  await expect(toast()).not.toContainText('Sprint is')
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('data-active', 'true')
})

test('opens a collapsed Epic to show and select the issue just created under it', async () => {
  await open()
  await select(/PSAPAC-10,/)
  await window.keyboard.press('ArrowLeft')
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)

  await window.keyboard.press('c')
  await dialog().getByLabel('Summary').fill('Hidden at first')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)

  await expect(dialog()).toHaveCount(0)
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('data-active', 'true')
  await expect(item(/PSAPAC-2,/)).toBeVisible()
})

test('selects nothing new when a filter hides the issue just created', async () => {
  await open()
  await select(/PSAPAC-2,/)
  await window.getByLabel('Filter by key or summary').fill('data model')
  await expect(item(/PSAPAC-4,/)).toHaveCount(0)
  await item(/PSAPAC-2,/).click()
  await window.keyboard.press('Escape')
  await window.keyboard.press('c')
  await dialog().getByLabel('Summary').fill('Filtered out')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)

  await expect(toast()).toContainText('Created PSAPAC-2000: Filtered out')
  await expect(item(/PSAPAC-2000,/)).toHaveCount(0)
  await expect(item(/PSAPAC-2,/)).toHaveAttribute('data-active', 'true')
})

test('Create more keeps the modal and the prefill, clears the summary and creates again', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Create more').check()
  await field('Labels', 'None').click()
  await window.getByRole('combobox', { name: 'Search Labels' }).fill('docs')
  await option('docs').click()
  await window.keyboard.press('Escape')

  await dialog().getByLabel('Summary').fill('First')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)

  await expect(dialog().getByRole('status')).toContainText('Created PSAPAC-2000: First')
  await expect(dialog().getByLabel('Summary')).toHaveValue('')
  await expect(dialog().getByLabel('Summary')).toBeFocused()
  await expect(field('Parent', 'PSAPAC-10 Customer onboarding')).toBeVisible()
  await expect(field('Customer', 'Acme')).toBeVisible()
  await expect(field('Labels', 'docs')).toBeVisible()
  // The first issue is already in the Tree, under the open modal.
  await expect(item(/PSAPAC-2000,/)).toBeAttached()

  await dialog().getByLabel('Summary').fill('Second')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(2)
  await expect(dialog().getByRole('status')).toContainText('Created PSAPAC-2001: Second')
  expect(await lastBody()).toMatchObject({ fields: { labels: ['docs'], summary: 'Second' } })

  await window.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)
  await expect(item(/PSAPAC-2001,/)).toHaveAttribute('data-active', 'true')
  await expect(item(/PSAPAC-2000,/)).toBeAttached()
  await expect(tree()).toBeFocused()
})

test('a parent whose Customer differs asks before it changes the form', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  await field('Parent', /^Parent:/).click()
  await window.getByRole('combobox', { name: 'Search Parent' }).fill('Reporting')
  await option(/Reporting/).click()
  const prompt = window.getByRole('dialog', { name: 'Move this issue under PSAPAC-30?' })
  await expect(prompt).toBeVisible()
  // Nothing changed behind the question.
  await expect(field('Customer', 'Acme')).toBeAttached()

  await prompt.getByRole('button', { name: 'Move and set Customer and Engagement' }).click()
  await expect(prompt).toHaveCount(0)
  await expect(field('Parent', 'PSAPAC-30 Reporting')).toBeVisible()
  await expect(field('Customer', 'Beta Ltd')).toBeVisible()
  await expect(field('Engagement', 'South')).toBeVisible()
  await expect(field('Parent', /^Parent:/)).toBeFocused()
})

test("the parent picker shows each candidate's type icon", async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  await field('Parent', /^Parent:/).click()
  await window.getByRole('combobox', { name: 'Search Parent' }).fill('Reporting')
  await expect(option(/Reporting/).getByRole('img', { name: 'Epic' })).toBeVisible()
})

test('a parent can be taken without its Customer and Engagement', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  await field('Parent', /^Parent:/).click()
  await option(/Reporting/).click()
  await window
    .getByRole('dialog', { name: 'Move this issue under PSAPAC-30?' })
    .getByRole('button', { name: 'Move only' })
    .click()

  await expect(field('Parent', 'PSAPAC-30 Reporting')).toBeVisible()
  await expect(field('Customer', 'Acme')).toBeVisible()
  await expect(field('Engagement', 'North')).toBeVisible()
})

test('the type decides which fields the form has and which parent it starts with', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  await field('Type', 'Story').click()
  await option('Subtask').click()
  // A Subtask goes under the selected Story, and has no sprint.
  await expect(field('Parent', 'PSAPAC-2 Review the data model')).toBeVisible()
  await expect(dialog().getByRole('button', { name: /^Sprint:/ })).toHaveCount(0)
  await expect(dialog().getByLabel('Original estimate')).toBeVisible()

  await field('Type', 'Subtask').click()
  await option('Epic').click()
  await expect(dialog().getByRole('button', { name: /^Parent:/ })).toHaveCount(0)
  await expect(dialog().getByRole('button', { name: /^Sprint:/ })).toHaveCount(0)
  await expect(dialog().getByLabel('Original estimate')).toHaveCount(0)

  await field('Type', 'Epic').click()
  await option('Bug').click()
  await expect(field('Parent', 'PSAPAC-10 Customer onboarding')).toBeVisible()
  await expect(field('Sprint', 'Backlog')).toBeVisible()
})

test('a Subtask is created under the selected Story, with the estimate', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await field('Type', 'Story').click()
  await option('Subtask').click()
  await dialog().getByLabel('Summary').fill('Sketch the schema')
  await dialog().getByLabel('Original estimate').fill('90m')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)

  expect(await lastBody()).toMatchObject({
    fields: {
      issuetype: { name: 'Subtask' },
      parent: { key: 'PSAPAC-2' },
      timetracking: { originalEstimate: '90m' },
    },
  })
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('data-active', 'true')
})

test('an estimate Jira cannot read blocks the create and says why', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Summary').fill('Tune the query')
  await dialog().getByLabel('Original estimate').fill('soon')

  await expect(dialog().getByRole('button', { name: 'Create issue' })).toBeDisabled()
  await expect(dialog()).toContainText('Add an estimate such as 2h 30m to create.')
})

test('a refused create keeps the modal and the summary, and shows why', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  const before = await counts(app)
  await dialog().getByLabel('Summary').fill('reject me')
  await dialog().getByRole('button', { name: 'Create issue' }).click()

  await expect(dialog().getByRole('alert')).toContainText('Could not create the issue.')
  await expect(dialog().getByRole('alert')).toContainText('The fake refuses this summary.')
  await expect(dialog().getByLabel('Summary')).toHaveValue('reject me')
  await expect(dialog().getByLabel('Summary')).toBeFocused()
  expect((await counts(app)).searches).toEqual(before.searches)
  await expect(item(/PSAPAC-2000,/)).toHaveCount(0)

  // Editing the summary clears the error.
  await dialog().getByLabel('Summary').fill('Accepted')
  await expect(dialog().getByRole('alert')).toHaveCount(0)
})

test('Esc closes the modal and returns focus to the Tree, and a picker takes its own Esc first', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  await field('Customer', 'Acme').click()
  await expect(window.getByRole('listbox', { name: 'Customer' })).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('listbox', { name: 'Customer' })).toHaveCount(0)
  await expect(dialog()).toBeVisible()
  await expect(field('Customer', 'Acme')).toBeFocused()

  await window.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-2,/)).toHaveAttribute('data-active', 'true')
  await expect(toast()).toHaveCount(0)
})

test('Tab stays inside the modal, and the page behind it cannot be reached', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  for (let step = 0; step < 24; step++) {
    await window.keyboard.press('Tab')
    expect(
      await window.evaluate<boolean>("document.activeElement?.closest('dialog') !== null"),
    ).toBe(true)
  }
  for (let step = 0; step < 24; step++) {
    await window.keyboard.press('Shift+Tab')
    expect(
      await window.evaluate<boolean>("document.activeElement?.closest('dialog') !== null"),
    ).toBe(true)
  }
  // The modal makes the rest of the page inert, so not even a script can focus the Tree.
  expect(
    await window.evaluate<boolean>(
      "(() => { document.querySelector('[role=tree]').focus(); return document.activeElement === document.querySelector('[role=tree]') })()",
    ),
  ).toBe(false)
})

test('Cmd+Enter creates from the summary', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Summary').fill('From the keyboard')
  await window.keyboard.press('Meta+Enter')

  await settle(1)
  await expect(toast()).toContainText('Created PSAPAC-2000: From the keyboard')
})

test('C on an open issue page prefills from that issue', async () => {
  await open()
  await item(/PSAPAC-11,/).click()
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  await expect(issuePage()).toBeFocused()

  await window.keyboard.press('c')
  await expect(dialog()).toBeVisible()
  await expect(field('Parent', 'PSAPAC-10 Customer onboarding')).toBeVisible()
  await expect(field('Customer', 'Acme')).toBeVisible()

  // Cancelling returns to the page, not the Tree under it.
  await dialog().getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog()).toHaveCount(0)
  await expect(issuePage()).toBeVisible()
})

test('the Tree keys still work beside C, and another letter opens nothing', async () => {
  await open()
  await select(/PSAPAC-2,/)

  await window.keyboard.press('j')
  await expect(item(/PSAPAC-2,/)).not.toHaveAttribute('data-active', 'true')
  await window.keyboard.press('k')
  await expect(item(/PSAPAC-2,/)).toHaveAttribute('data-active', 'true')
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowUp')
  await expect(item(/PSAPAC-2,/)).toHaveAttribute('data-active', 'true')
  await window.keyboard.press('x')
  await expect(dialog()).toHaveCount(0)
})
