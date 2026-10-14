import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import {
  counts,
  failRead,
  failUpload,
  launch,
  logIn,
  notices,
  refuseNextEdit,
  releaseEdit,
  releaseUpload,
  setDescription,
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
const dialog = () => window.getByRole('dialog', { name: 'New issue' })
const field = (label: string, value: string | RegExp) =>
  dialog().getByRole('button', {
    name: typeof value === 'string' ? `${label}: ${value}` : value,
  })
const option = (name: string | RegExp) =>
  window.getByRole('option', typeof name === 'string' ? { name, exact: true } : { name })
const toast = () =>
  notices(window)
    .getByRole('listitem')
    .filter({ hasText: /^Created|^Deleted/ })
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

test('creates an issue with a Start date and a Due date, and its page shows both', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Summary').fill('Plan the dates')
  await dialog().getByLabel('Start date').fill('2026-10-01')
  await dialog().getByLabel('Due date').fill('2026-10-14')
  await dialog().getByRole('button', { name: 'Create issue' }).click()

  await settle(1)
  expect(await lastBody()).toMatchObject({
    fields: { customfield_4: '2026-10-01', duedate: '2026-10-14' },
  })
  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText('Created PSAPAC-2000: Plan the dates')
  await expect(toast()).not.toContainText('date is')

  await window.keyboard.press('Enter')
  const props = issuePage().getByRole('complementary', { name: 'Properties' })
  await expect(props.getByLabel('Start date')).toHaveValue('2026-10-01')
  await expect(props.getByLabel('Due date')).toHaveValue('2026-10-14')
})

test('creates an issue with neither date and sends no date field', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await expect(dialog().getByLabel('Start date')).toHaveValue('')
  await expect(dialog().getByLabel('Due date')).toHaveValue('')
  await dialog().getByLabel('Summary').fill('Plan without dates')
  await dialog().getByRole('button', { name: 'Create issue' }).click()

  await settle(1)
  const fields = (await lastBody()).fields as Record<string, unknown>
  expect(fields).not.toHaveProperty('customfield_4')
  expect(fields).not.toHaveProperty('duedate')
  await expect(toast()).toContainText('Created PSAPAC-2000: Plan without dates')
})

test('a Due date before the Start date shows no warning, as on the issue page', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Start date').fill('2026-10-14')
  await dialog().getByLabel('Due date').fill('2026-10-01')

  await expect(dialog().getByLabel('Due date')).not.toHaveAttribute('aria-invalid')
  await expect(dialog().getByRole('alert')).toHaveCount(0)
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

/** The distinct rows the chips sit on, with the page set in `font` when one is given. */
async function chipRows(font?: string) {
  if (font !== undefined) {
    await window.addStyleTag({ content: `* { font-family: ${font} !important }` })
  }
  const chips = dialog().locator(
    'button[aria-haspopup=listbox]:not([aria-label^="Type:"]), button:has-text("+me"), label:has(input[aria-label="Original estimate"]), label:has(input[type=date])',
  )
  await expect(chips).toHaveCount(11)
  const tops = await chips.evaluateAll((all) =>
    all.map((chip) => Math.round(chip.getBoundingClientRect().top)),
  )
  return new Set(tops).size
}

test('the other fields are chips on three lines at most', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  expect(await chipRows()).toBeLessThanOrEqual(3)
})

// Linux CI sets the system font in a face wider than macOS's, and wrapped to three rows (PR #163).
test('the chips stay on three lines in a wide font', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)

  expect(await chipRows('Verdana, "DejaVu Sans", sans-serif')).toBeLessThanOrEqual(3)
})

test('the date chips stay inside the dialog at the narrowest window, in a wide font', async () => {
  await open()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 800)
  })
  await openCreate(/PSAPAC-2,/)
  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  await dialog().getByLabel('Start date').fill('2026-10-01')
  await dialog().getByLabel('Due date').fill('2026-10-14')

  const box = await dialog().evaluate((el) => {
    const right = el.getBoundingClientRect().right
    const outside = [
      ...el.querySelectorAll('label:has(input[type=date]), label:has(input[type=date]) *'),
    ].filter((child) => child.getBoundingClientRect().right > right + 1)
    return { overflow: el.scrollWidth - el.clientWidth, outside: outside.length }
  })
  expect(box).toEqual({ overflow: 0, outside: 0 })
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

  await dialog().getByRole('button', { name: 'Assign to me' }).click()
  await expect(field('Assignee', /^Assignee: \S/)).not.toHaveAttribute(
    'aria-label',
    'Assignee: Unassigned',
  )
  await expect(dialog().getByRole('button', { name: 'Assign to me' })).toHaveCount(0)
  // The +me button is gone, so focus moves to the chip it filled instead of falling to the page.
  await expect(field('Assignee', /^Assignee: \S/)).toBeFocused()

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

test('a Subtask with no parent shows Parent as Required, and Cmd+Enter goes to it before Engagement', async () => {
  await open()
  await select(/^Beta Ltd, 5 issues$/)
  await window.keyboard.press('c')
  await expect(dialog()).toBeVisible()
  await field('Type', 'Story').click()
  await option('Subtask').click()
  await expect(field('Parent', 'Required')).toBeVisible()
  await expect(field('Engagement', 'Required')).toBeVisible()

  await dialog().getByLabel('Summary').fill('Needs a home')
  await window.keyboard.press('Meta+Enter')
  await expect(field('Parent', 'Required')).toBeFocused()
})

test('a long estimate is not clipped in its chip', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  const estimate = dialog().getByLabel('Original estimate')
  await estimate.fill('1w 2d 3h 30m')

  expect(await estimate.evaluate((input) => input.scrollWidth <= input.clientWidth)).toBe(true)
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

const description = () => dialog().getByRole('textbox', { name: 'Description' })
const picker = () => dialog().getByLabel('Choose files to attach')
const file = (name: string, text = 'hello') => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(text),
})
const uploads = async () => (await counts(app)).uploads

/** Fills the summary, then types a description and chooses `names`, for a form that is ready. */
async function fillDescribed(summary: string, names: string[] = []) {
  await dialog().getByLabel('Summary').fill(summary)
  await description().click()
  await window.keyboard.type('Plan the cutover')
  if (names.length > 0) await picker().setInputFiles(names.map((name) => file(name)))
}

test('the created issue carries the typed ADF description, sent in the create request', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await expect(dialog().getByText('Add a description')).toBeVisible()
  await fillDescribed('Describe it')
  await expect(dialog().getByText('Add a description')).toHaveCount(0)
  // Cmd+Enter from inside the editor creates once.
  await window.keyboard.press('Meta+Enter')
  await settle(1)

  const body = (await lastBody()) as { fields: { description: unknown } }
  expect(body.fields.description).toEqual({
    version: 1,
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan the cutover' }] }],
  })
  await expect(dialog()).toHaveCount(0)
  expect(await writes()).toBe(1)
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('data-active', 'true')
  await window.keyboard.press('Enter')
  await expect(
    issuePage().getByRole('region', { name: 'Description' }).getByText('Plan the cutover'),
  ).toBeVisible()
})

test('an empty description is not sent', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Summary').fill('No detail yet')
  await description().click()
  await window.keyboard.press('Enter')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)

  expect((await lastBody()).fields).not.toHaveProperty('description')
})

test('Esc in the description closes the dialog', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await description().click()
  await window.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)
})

test('chosen files attach to the new issue after it exists', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('With a file', ['notes.txt'])
  await expect(dialog().getByText('notes.txt', { exact: true })).toBeVisible()
  await dialog().getByRole('button', { name: 'Create issue' }).click()

  // The issue is created first; nothing is attached before Jira has answered.
  await expect.poll(writes).toBe(1)
  expect(await uploads()).toEqual([])
  await releaseEdit(app)
  await expect.poll(async () => (await uploads()).length).toBe(1)
  expect((await uploads())[0]).toMatchObject({
    key: 'PSAPAC-2000',
    filename: 'notes.txt',
    type: 'text/plain',
    size: 5,
  })
  await expect(dialog().getByRole('button', { name: 'Attaching' })).toBeDisabled()
  await releaseUpload(app)

  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText('Created PSAPAC-2000: With a file')
  await expect(toast()).not.toContainText('Could not attach')
  await window.keyboard.press('Enter')
  await expect(
    issuePage().getByRole('region', { name: 'Attachments' }).getByText('notes.txt'),
  ).toBeVisible()
})

test('a chosen file can be removed before the create', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await picker().setInputFiles([file('a.txt'), file('b.txt')])
  await dialog().getByRole('button', { name: 'Remove a.txt' }).click()
  await expect(dialog().getByText('a.txt', { exact: true })).toHaveCount(0)
  await dialog().getByLabel('Summary').fill('One file')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)
  await expect.poll(async () => (await uploads()).length).toBe(1)
  await releaseUpload(app)
  await expect(dialog()).toHaveCount(0)
  expect((await uploads()).map((u) => u.filename)).toEqual(['b.txt'])
})

test('a failed upload leaves the issue and the notice names the file and the key', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('Half attached', ['broken.txt', 'fine.txt'])
  // The fake fails the next upload, which is broken.txt, and holds fine.txt until released.
  await failUpload(app)
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)
  await expect.poll(async () => (await uploads()).length).toBe(2)
  await releaseUpload(app)

  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText('Created PSAPAC-2000: Half attached')
  await expect(toast()).toContainText('Could not attach broken.txt to PSAPAC-2000.')
  await expect(toast()).not.toContainText('fine.txt')
  await expect(toast()).not.toContainText('/rest/')
  // The issue stays: its row is there and selected.
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('data-active', 'true')
  expect((await uploads()).map((u) => u.filename)).toEqual(['broken.txt', 'fine.txt'])
})

test('Create more clears the description and the chosen files', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Create more').check()
  await fillDescribed('First of two', ['notes.txt'])
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)
  await expect.poll(async () => (await uploads()).length).toBe(1)
  await releaseUpload(app)

  await expect(dialog().getByRole('status')).toContainText('Created PSAPAC-2000: First of two')
  await expect(dialog().getByLabel('Summary')).toHaveValue('')
  await expect(description()).toHaveText('')
  await expect(dialog().getByText('Add a description')).toBeVisible()
  await expect(dialog().getByText('notes.txt', { exact: true })).toHaveCount(0)

  await dialog().getByLabel('Summary').fill('Second of two')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(2)
  expect((await lastBody()).fields).not.toHaveProperty('description')
  expect(await uploads()).toHaveLength(1)
})

test('a failed upload still reaches a toast when Create more keeps the dialog open', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Create more').check()
  await dialog().getByLabel('Summary').fill('Kept open')
  await picker().setInputFiles([file('broken.txt')])
  await failUpload(app)
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)

  await expect(dialog().getByRole('status')).toContainText(
    'Could not attach broken.txt to PSAPAC-2000.',
  )
  await expect(toast()).toContainText('Could not attach broken.txt to PSAPAC-2000.')
  await expect(toast().getByRole('button', { name: 'Open' })).toHaveCount(1)
})

test('a failed upload toast has no Open button when the new issue could not be read back', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Create more').check()
  await dialog().getByLabel('Summary').fill('Not read back')
  await picker().setInputFiles([file('broken.txt')])
  await failRead(app)
  await failUpload(app)
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)

  await expect(toast()).toContainText('Created PSAPAC-2000')
  await expect(toast()).toContainText('Could not attach broken.txt to PSAPAC-2000.')
  await expect(toast().getByRole('button', { name: 'Open' })).toHaveCount(0)
})

test('the description is locked while the create is in flight', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('Locked while sending')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await expect.poll(writes).toBe(1)

  await expect(description().locator('xpath=ancestor::*[@inert]')).toHaveCount(1)
  await releaseEdit(app)
  await expect(dialog()).toHaveCount(0)
})

test('a description of blanks is not sent, and the placeholder hides once anything is typed', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Summary').fill('Only blanks')
  await description().click()
  await window.keyboard.type('   ')
  await window.keyboard.press('Shift+Enter')
  await expect(dialog().getByText('Add a description')).toHaveCount(0)
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)

  expect((await lastBody()).fields).not.toHaveProperty('description')
})

// Linux CI sets a wider system font (PR #163); the new rows must not push the dialog sideways.
test('the description and long file names fit the dialog in a wide font', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  await dialog().getByLabel('Summary').fill('Fits')
  await description().click()
  await window.keyboard.type('word '.repeat(60))
  // The unbreakable name cannot wrap, so only `truncate` keeps its chip inside the dialog.
  const names = [
    'a-very-long-file-name-for-the-quarterly-engagement-report-final.pdf',
    `${'x'.repeat(80)}.pdf`,
    'b.txt',
    'c.txt',
  ]
  await picker().setInputFiles(names.map((name) => file(name)))

  const box = await dialog().evaluate((el) => {
    const right = el.getBoundingClientRect().right
    const outside = [...el.querySelectorAll('*')].filter(
      (child) => child.getBoundingClientRect().right > right + 1,
    )
    return { overflow: el.scrollWidth - el.clientWidth, outside: outside.length }
  })
  expect(box).toEqual({ overflow: 0, outside: 0 })
  expect(await chipRows()).toBeLessThanOrEqual(3)
})

/** A 1x1 PNG, which passes the app's magic-number check for an embedded image. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

interface Dropped {
  name: string
  type: string
  data: string
}
const png = (name = 'shot.png'): Dropped => ({ name, type: 'image/png', data: PNG })
const text = (name: string): Dropped => ({ name, type: 'text/plain', data: btoa('hello') })

/** Pastes a PNG into the element, as the clipboard hands over a screenshot. */
async function pasteImage(target: Locator, name = 'image.png') {
  await target.evaluate(
    (element, [data, filename]) => {
      const bytes = Uint8Array.from(atob(data ?? ''), (c) => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], filename ?? 'a.png', { type: 'image/png' }))
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      )
    },
    [PNG, name],
  )
}

/** Fires a drag event carrying the files at the element, as files dragged in from the desktop would. */
async function dragFiles(
  target: Locator,
  type: 'dragenter' | 'drop',
  files: Dropped[] = [text('dropped.txt')],
) {
  await target.evaluate(
    (element, [kind, list]) => {
      const transfer = new DataTransfer()
      for (const { name, type: mime, data } of list as Dropped[]) {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        transfer.items.add(new File([bytes], name, { type: mime }))
      }
      element.dispatchEvent(
        new DragEvent(kind as string, { dataTransfer: transfer, bubbles: true, cancelable: true }),
      )
    },
    [type, files],
  )
}

const title = () => dialog().getByRole('heading', { name: 'New issue' })
const staged = (name: string) => dialog().getByText(`${name} uploads when the issue is created`)

/** Presses Create and lets the create through, so the uploads start. */
async function createNow() {
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)
}

test('a pasted image stages in the description, uploads after the create and is written into it', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('With a screenshot')
  await pasteImage(description())
  await expect(staged('pasted-1.png')).toBeVisible()
  await expect(dialog().locator('figure img')).toBeVisible()
  expect(await uploads()).toEqual([])

  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await expect.poll(writes).toBe(1)
  // The create carries the text only: the image has no issue to belong to yet.
  expect((await lastBody()).fields).toMatchObject({
    description: {
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Plan the cutover' }] },
        // The paragraph the editor leaves after the image, which stays once the image is out.
        { type: 'paragraph' },
      ],
    },
  })
  expect(await uploads()).toEqual([])
  await releaseEdit(app)

  await expect.poll(async () => (await uploads()).length).toBe(1)
  expect((await uploads())[0]).toMatchObject({
    key: 'PSAPAC-2000',
    filename: 'pasted-1.png',
    type: 'image/png',
  })
  await expect(dialog().getByRole('button', { name: 'Attaching' })).toBeDisabled()
  await releaseUpload(app)

  // Then the description is written again, with the image's media id in place.
  await expect.poll(writes).toBe(2)
  const written = (await lastBody()) as { fields: { description: { content: unknown[] } } }
  expect(written.fields.description.content).toEqual([
    { type: 'paragraph', content: [{ type: 'text', text: 'Plan the cutover' }] },
    {
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [
        {
          type: 'media',
          attrs: expect.objectContaining({
            type: 'file',
            id: expect.stringMatching(/^aaaaaaaa-0000-4000-8000-/),
            alt: 'pasted-1.png',
          }) as unknown,
        },
      ],
    },
    { type: 'paragraph' },
  ])
  // The finished image shows no error while the dialog waits: nothing loads it under the dialog's key.
  await window.waitForTimeout(500)
  await expect(dialog().getByRole('alert')).toHaveCount(0)
  await releaseEdit(app)

  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText('Created PSAPAC-2000: With a screenshot')
  await expect(toast()).not.toContainText('Could not')
  await window.keyboard.press('Enter')
  await expect(
    issuePage().getByRole('region', { name: 'Description' }).getByRole('img'),
  ).toBeVisible()
})

test('a pasted image that is removed before the create uploads nothing', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('Changed my mind')
  await pasteImage(description())
  await dialog().getByRole('button', { name: 'Remove pasted-1.png' }).click()
  await expect(staged('pasted-1.png')).toHaveCount(0)
  await createNow()

  await expect(dialog()).toHaveCount(0)
  expect(await uploads()).toEqual([])
  expect(await writes()).toBe(1)
})

test('a failed image upload leaves the issue and its text, and the notice names the image', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('Image refused')
  await pasteImage(description())
  await failUpload(app)
  await createNow()

  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText('Created PSAPAC-2000: Image refused')
  await expect(toast()).toContainText('Could not attach pasted-1.png to PSAPAC-2000.')
  await expect(toast()).toContainText('It is not in the description.')
  await expect(toast()).not.toContainText('/rest/')
  // Nothing was written again, and the issue is there.
  expect(await writes()).toBe(1)
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('data-active', 'true')
  await window.keyboard.press('Enter')
  await expect(
    issuePage().getByRole('region', { name: 'Description' }).getByText('Plan the cutover'),
  ).toBeVisible()
})

test('one image failing does not stop the next from landing in the description', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('Two images')
  await pasteImage(description())
  await pasteImage(description())
  await failUpload(app)
  await createNow()
  // The fake fails the first upload to arrive, in document order.
  await expect.poll(async () => (await uploads()).length).toBe(2)
  const [failed = '', landed = ''] = (await uploads()).map((u) => u.filename)
  await releaseUpload(app)
  await expect.poll(writes).toBe(2)
  const written = (await lastBody()) as { fields: { description: { content: { type: string }[] } } }
  expect(written.fields.description.content.filter((n) => n.type === 'mediaSingle')).toHaveLength(1)
  await releaseEdit(app)

  // Each pasted image has its own name, so the notice says which one failed.
  expect([failed, landed].sort()).toEqual(['pasted-1.png', 'pasted-2.png'])
  await expect(toast()).toContainText(`Could not attach ${failed} to PSAPAC-2000.`)
  await expect(toast()).not.toContainText(`Could not attach ${landed} `)
})

test('a refused description write leaves the images attached and says so', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('Write refused')
  await pasteImage(description())
  await createNow()
  await expect.poll(async () => (await uploads()).length).toBe(1)
  await refuseNextEdit(app)
  await releaseUpload(app)
  await expect.poll(writes).toBe(2)
  await releaseEdit(app)

  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText('Created PSAPAC-2000: Write refused')
  await expect(toast()).toContainText(
    'Could not put the pasted image into the description of PSAPAC-2000.',
  )
  await expect(toast()).toContainText('It is attached to the issue.')
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('data-active', 'true')
})

test('a description that changed in Jira after the create is not overwritten', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('Someone else edits')
  await pasteImage(description())
  await createNow()
  await expect.poll(async () => (await uploads()).length).toBe(1)
  await setDescription(app, 'PSAPAC-2000', {
    version: 1,
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Theirs' }] }],
  })
  await releaseUpload(app)

  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText(
    'The description of PSAPAC-2000 changed in Jira, so the pasted image was attached to it but not placed in the description.',
  )
  // The check read the description and wrote nothing.
  expect(await writes()).toBe(1)
})

test('files dropped on the dialog stage like the Attach files button, and upload after the create', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Summary').fill('Dropped two')
  await dragFiles(title(), 'drop', [text('a.txt'), text('b.txt')])
  await expect(dialog().getByText('a.txt', { exact: true })).toBeVisible()
  await expect(dialog().getByText('b.txt', { exact: true })).toBeVisible()
  // A file chosen with the button joins the dropped ones.
  await picker().setInputFiles([file('c.txt')])
  await expect(dialog().getByText('c.txt', { exact: true })).toBeVisible()
  expect(await uploads()).toEqual([])

  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)
  await expect.poll(async () => (await uploads()).length).toBe(1)
  await releaseUpload(app)
  await expect.poll(async () => (await uploads()).length).toBe(2)
  await releaseUpload(app)
  await expect.poll(async () => (await uploads()).length).toBe(3)
  await releaseUpload(app)

  await expect(dialog()).toHaveCount(0)
  expect((await uploads()).map((u) => [u.key, u.filename])).toEqual([
    ['PSAPAC-2000', 'a.txt'],
    ['PSAPAC-2000', 'b.txt'],
    ['PSAPAC-2000', 'c.txt'],
  ])
  await expect(toast()).not.toContainText('Could not')
})

test('a dropped file can be removed like a chosen one', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dragFiles(dialog().getByLabel('Summary'), 'drop', [text('a.txt')])
  await dialog().getByRole('button', { name: 'Remove a.txt' }).click()
  await expect(dialog().getByText('a.txt', { exact: true })).toHaveCount(0)
})

test('a file dropped on the chips area stages, and a mixed drop on the description splits', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dragFiles(dialog().getByRole('button', { name: /^Customer/ }), 'drop', [text('chips.txt')])
  await expect(dialog().getByText('chips.txt', { exact: true })).toBeVisible()

  // An image dropped on the description goes into it; the other file stages.
  await dragFiles(description(), 'drop', [png('inline.png'), text('beside.txt')])
  await expect(staged('inline.png')).toBeVisible()
  await expect(dialog().getByText('beside.txt', { exact: true })).toBeVisible()
  await expect(dialog().getByText('inline.png', { exact: true })).toHaveCount(0)
})

test('a drop on the dialog does not attach to the issue page behind it', async () => {
  await open()
  await item(/PSAPAC-1,/).click()
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  await expect(issuePage().getByText('Loading attachments')).toHaveCount(0)
  await window.keyboard.press('c')
  await expect(dialog()).toBeVisible()

  await dragFiles(title(), 'drop', [text('mine.txt')])
  await expect(dialog().getByText('mine.txt', { exact: true })).toBeVisible()
  // Nothing was sent to PSAPAC-1: the page's own drop handler took no part.
  await window.waitForTimeout(300)
  expect(await uploads()).toEqual([])

  await dialog().getByLabel('Summary').fill('From the page')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)
  await expect.poll(async () => (await uploads()).length).toBe(1)
  await releaseUpload(app)
  await expect(dialog()).toHaveCount(0)
  expect((await uploads()).map((u) => u.key)).toEqual(['PSAPAC-2000'])
})

test('a drop while the create is in flight stages nothing', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Summary').fill('Busy')
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await expect.poll(writes).toBe(1)
  await dragFiles(title(), 'drop', [text('late.txt')])
  await releaseEdit(app)
  await expect(dialog()).toHaveCount(0)
  expect(await uploads()).toEqual([])
})

test('both drop zones light up with their own label while a file is dragged over the dialog', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await expect(dialog().getByText('Add images into description')).toHaveCount(0)
  await dragFiles(title(), 'dragenter')
  await expect(dialog().getByText('Add images into description')).toBeVisible()
  await expect(dialog().getByText('Attach files to the new issue')).toBeVisible()
  // A drop clears them.
  await dragFiles(title(), 'drop')
  await expect(dialog().getByText('Attach files to the new issue')).toHaveCount(0)
})

test('Create more clears a pasted image, and the dialog stays within its width in a wide font', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  await dialog().getByLabel('Create more').check()
  await fillDescribed('Wide and staged')
  await pasteImage(description())
  await dragFiles(description(), 'drop', [png(`${'y'.repeat(80)}.png`)])
  await dragFiles(title(), 'drop', [
    text('a-very-long-file-name-for-the-quarterly-engagement-report-final.pdf'),
    text(`${'x'.repeat(80)}.pdf`),
  ])

  const fits = () =>
    dialog().evaluate((el) => {
      const right = el.getBoundingClientRect().right
      const outside = [...el.querySelectorAll('*')].filter(
        (child) => child.getBoundingClientRect().right > right + 1,
      )
      return { overflow: el.scrollWidth - el.clientWidth, outside: outside.length }
    })
  expect(await fits()).toEqual({ overflow: 0, outside: 0 })
  // With the labels showing too.
  await dragFiles(title(), 'dragenter')
  await expect(dialog().getByText('Attach files to the new issue')).toBeVisible()
  expect(await fits()).toEqual({ overflow: 0, outside: 0 })
  await dragFiles(title(), 'drop', [])

  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await settle(1)
  // The two images, the description write, then the two files, each held until released.
  for (let sent = 1; sent <= 4; sent++) {
    await expect.poll(async () => (await uploads()).length).toBe(sent)
    await releaseUpload(app)
    if (sent === 2) await expect.poll(writes).toBe(2)
    if (sent === 2) await releaseEdit(app)
  }
  await expect(dialog().getByRole('status')).toContainText('Created PSAPAC-2000')
  await expect(dialog().locator('figure')).toHaveCount(0)
  await expect(description()).toHaveText('')
})

test('a pasted image shows no error while a chosen file attaches after it', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('Image and file', ['notes.txt'])
  await pasteImage(description())
  await createNow()
  await expect.poll(async () => (await uploads()).length).toBe(1)
  await releaseUpload(app)
  await expect.poll(writes).toBe(2)
  await releaseEdit(app)

  // The file upload is held: the image is done and its placeholder still shows in the locked dialog.
  await expect.poll(async () => (await uploads()).length).toBe(2)
  await expect(dialog().getByRole('button', { name: 'Attaching' })).toBeDisabled()
  await window.waitForTimeout(500)
  await expect(dialog().getByRole('alert')).toHaveCount(0)
  await expect(dialog().getByText('The upload was lost.')).toHaveCount(0)
  await releaseUpload(app)
  await expect(dialog()).toHaveCount(0)
})

test('a failed pasted image offers no Retry and is never called lost while a file attaches', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await fillDescribed('Image refused, file sent', ['notes.txt'])
  await pasteImage(description())
  await failUpload(app)
  await createNow()
  await expect.poll(async () => (await uploads()).length).toBe(2)

  await window.waitForTimeout(500)
  await expect(dialog().getByText('The upload was lost.')).toHaveCount(0)
  await expect(dialog().getByRole('button', { name: 'Retry' })).toHaveCount(0)
  await releaseUpload(app)
  await expect(dialog()).toHaveCount(0)
  await expect(toast()).toContainText('Could not attach pasted-1.png to PSAPAC-2000.')
})

test('Create more starts the pasted names again at pasted-1', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Create more').check()
  await fillDescribed('First')
  await pasteImage(description())
  await expect(staged('pasted-1.png')).toBeVisible()
  await createNow()
  await expect.poll(async () => (await uploads()).length).toBe(1)
  await releaseUpload(app)
  await expect.poll(writes).toBe(2)
  await releaseEdit(app)
  await expect(dialog().getByRole('status')).toContainText('Created PSAPAC-2000')

  await description().click()
  await pasteImage(description())
  await expect(staged('pasted-1.png')).toBeVisible()
})

test('Create more never inserts a lost-upload node while it clears a pasted image', async () => {
  await open()
  await openCreate(/PSAPAC-2,/)
  await dialog().getByLabel('Create more').check()
  await fillDescribed('Watched', ['notes.txt'])
  await pasteImage(description())
  // Records every node added to the dialog whose text says an upload was lost, even for one frame.
  await dialog().evaluate((element) => {
    const seen: string[] = []
    ;(window as unknown as { __lost: string[] }).__lost = seen
    new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added.textContent?.includes('was lost')) seen.push(added.textContent)
        }
      }
    }).observe(element, { childList: true, subtree: true })
  })
  await createNow()
  await expect.poll(async () => (await uploads()).length).toBe(1)
  await releaseUpload(app)
  await expect.poll(writes).toBe(2)
  await releaseEdit(app)
  await expect.poll(async () => (await uploads()).length).toBe(2)
  await releaseUpload(app)
  await expect(dialog().getByRole('status')).toContainText('Created PSAPAC-2000')
  await expect(dialog().locator('figure')).toHaveCount(0)

  expect(await window.evaluate(() => (window as unknown as { __lost: string[] }).__lost)).toEqual(
    [],
  )
})

for (const [name, css] of [
  ['the default font', undefined],
  ['a wide font', '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }'],
] as const) {
  test(`the Parent picker in the create dialog opens 26rem wide inside the window, in ${name}`, async () => {
    await open()
    await openCreate(/PSAPAC-2,/)
    if (css !== undefined) await window.addStyleTag({ content: css })

    await field('Parent', /^Parent:/).click()
    const box = await window
      .getByRole('listbox', { name: 'Parent' })
      .locator('xpath=..')
      .boundingBox()
    const view = await window.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    expect(box?.width).toBe(416)
    expect(box?.x).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(view.w)
    expect(box?.y).toBeGreaterThanOrEqual(0)
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(view.h)
    await window.keyboard.press('Escape')

    // Another chip's picker keeps its width.
    await field('Priority', /^Priority:/).click()
    const other = await window
      .getByRole('listbox', { name: 'Priority' })
      .locator('xpath=..')
      .boundingBox()
    expect(other?.width).toBe(208)
  })
}
