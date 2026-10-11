import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, fieldsOf, launch, logIn, moveIssue, notices, releaseEdit } from './harness.js'

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
const item = (name: string | RegExp) => tree().getByRole('treeitem', { name })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const subtasks = () => issuePage().getByRole('region', { name: 'Subtasks', exact: true })
const rows = () => subtasks().locator('ul > li')
const addButton = () => issuePage().getByRole('button', { name: 'Add sub-issue' })
const form = () => subtasks().getByRole('form', { name: 'Add sub-issues' })
const titles = () => form().getByRole('textbox', { name: 'Titles, one per line' })

/** The summaries the fake saw each create write, in order. */
async function createdSummaries() {
  const bodies = (await counts(app)).editBodies as { fields?: { summary?: string } }[]
  return bodies.map((body) => body.fields?.summary)
}

async function openPage(row: RegExp, title: string) {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so this text stays and the toolbar stops reflowing.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
  await item(row).click()
  await window.keyboard.press('Enter')
  await expect(issuePage().getByRole('heading', { name: title })).toBeVisible()
  await expect(window.getByText('Loading subtasks')).toHaveCount(0)
}

/** PSAPAC-32 is a Beta Ltd Story under an Epic of South; it has no Subtasks. */
const openStory = () => openPage(/PSAPAC-32,/, 'Review the report layout')

/** Waits for the `n`th write to arrive, then lets the fake Jira answer it. */
async function settle(n: number) {
  await expect.poll(async () => (await counts(app)).edits).toBe(n)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(n)
}

test('a pasted list of five titles makes five Subtasks with the parent Customer and Engagement, each shown at once', async () => {
  await openStory()
  await expect(subtasks().getByText('No subtasks')).toBeVisible()
  await addButton().click()
  await expect(titles()).toBeFocused()
  await titles().fill('  First \n\nSecond\n   \nThird\nFourth\nFifth\n')
  const create = form().getByRole('button', { name: 'Create 5 sub-issues' })
  await create.click()

  // One at a time: the next create is not sent until the last one is answered.
  for (let n = 1; n <= 5; n++) {
    await expect.poll(async () => (await counts(app)).edits).toBe(n)
    await expect(rows()).toHaveCount(n - 1)
    await releaseEdit(app)
    await expect(rows()).toHaveCount(n)
  }
  await expect.poll(async () => (await counts(app)).applied).toBe(5)

  await expect(form()).toHaveCount(0)
  await expect(rows().nth(0)).toContainText('First')
  await expect(rows().nth(4)).toContainText('Fifth')
  await expect(subtasks().getByText('0/5')).toBeVisible()
  await expect(notices(window).getByText('Created 5 sub-issues under PSAPAC-32')).toBeVisible()
  expect(await createdSummaries()).toEqual(['First', 'Second', 'Third', 'Fourth', 'Fifth'])

  const bodies = (await counts(app)).editBodies as { fields: Record<string, unknown> }[]
  for (const { fields } of bodies) {
    expect(fields).toMatchObject({
      issuetype: { name: 'Subtask' },
      parent: { key: 'PSAPAC-32' },
      // Beta Ltd and North, which Jira calls 2 and 7.
      customfield_1: { id: '2' },
      customfield_2: { id: '7' },
    })
  }
  const keys = await rows().evaluateAll((all) =>
    all.map((row) => /PSAPAC-\d+/.exec(row.textContent)?.[0] ?? ''),
  )
  for (const key of keys) {
    const held = await fieldsOf(app, key)
    expect(held).toMatchObject({
      customfield_1: { value: 'Beta Ltd' },
      parent: { key: 'PSAPAC-32' },
    })
  }
})

test('Esc closes the form and keeps the page, and Cmd+Enter creates a single title', async () => {
  await openStory()
  await addButton().click()
  await titles().fill('Half written')
  await window.keyboard.press('Escape')
  await expect(form()).toHaveCount(0)
  await expect(issuePage()).toBeVisible()
  expect((await counts(app)).edits).toBe(0)

  await addButton().click()
  await expect(titles()).toHaveValue('')
  await expect(form().getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
  await titles().fill('Only one')
  await expect(form().getByRole('button', { name: 'Create 1 sub-issue' })).toBeEnabled()
  await window.keyboard.press('Meta+Enter')
  await settle(1)
  await expect(rows()).toHaveCount(1)
  await expect(subtasks().getByText('0/1')).toBeVisible()
  await expect(notices(window).getByText('Created 1 sub-issue under PSAPAC-32')).toBeVisible()
})

test('an Epic and a Subtask offer no way to add a sub-issue', async () => {
  await openPage(/PSAPAC-10,/, 'Customer onboarding')
  await expect(addButton()).toHaveCount(0)
  await expect(subtasks()).toHaveCount(0)

  await issuePage().getByRole('button', { name: 'Back to issues' }).click()
  await item(/PSAPAC-12,/).click()
  await window.keyboard.press('Enter')
  await expect(issuePage().getByRole('heading', { name: 'Outline the sections' })).toBeVisible()
  await expect(addButton()).toHaveCount(0)
  await expect(subtasks()).toHaveCount(0)
  expect((await counts(app)).edits).toBe(0)
})

test('the heading counts done over all and follows a status change and new Subtasks', async () => {
  // PSAPAC-11 holds PSAPAC-12, which is To Do.
  await openPage(/PSAPAC-11,/, 'Draft the runbook')
  await expect(subtasks().getByText('0/1')).toBeVisible()

  await moveIssue(app, 'PSAPAC-12', 'done')
  await app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows()
    first?.emit('blur')
    first?.emit('focus')
  })
  await expect(subtasks().getByText('1/1')).toBeVisible()

  await addButton().click()
  await titles().fill('Two\nThree')
  await form().getByRole('button', { name: 'Create 2 sub-issues' }).click()
  await settle(1)
  await expect(subtasks().getByText('1/2')).toBeVisible()
  await settle(2)
  await expect(subtasks().getByText('1/3')).toBeVisible()
  await expect(rows()).toHaveCount(3)
})

test('a refused title stops the run, keeps what was created and retries only the rest', async () => {
  await openStory()
  await addButton().click()
  await titles().fill('First\nSecond\nreject me\nFourth\nFifth')
  await form().getByRole('button', { name: 'Create 5 sub-issues' }).click()
  await settle(1)
  await settle(2)

  // The third is refused at once, so the fourth and fifth are never sent.
  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Created 2 of 5 sub-issues under PSAPAC-32')
  await expect(alert).toContainText('Could not create "reject me"')
  await expect(alert).toContainText('2 more not tried.')
  await expect(rows()).toHaveCount(2)
  await expect(subtasks().getByText('0/2')).toBeVisible()
  expect((await counts(app)).edits).toBe(2)

  // What is left is in the box, and Create sends exactly that.
  await expect(titles()).toHaveValue('reject me\nFourth\nFifth')
  await expect(form().getByRole('button', { name: 'Create 3 sub-issues' })).toBeEnabled()
  await titles().fill('Third\nFourth\nFifth')
  await form().getByRole('button', { name: 'Create 3 sub-issues' }).click()
  await settle(3)
  await settle(4)
  await settle(5)

  await expect(rows()).toHaveCount(5)
  await expect(form()).toHaveCount(0)
  expect(await createdSummaries()).toEqual(['First', 'Second', 'Third', 'Fourth', 'Fifth'])
})

test('the heading and the form fit in a wide font', async () => {
  await openStory()
  await addButton().click()
  await titles().fill('A title long enough to wrap inside the box '.repeat(6))
  await expect(form().getByRole('button', { name: 'Create 1 sub-issue' })).toBeVisible()

  const overflow = () =>
    subtasks().evaluate((section) => {
      const right = section.getBoundingClientRect().right
      const outside = [...section.querySelectorAll('*')].filter(
        (child) => child.getBoundingClientRect().right > right + 1,
      )
      return { sideways: section.scrollWidth - section.clientWidth, outside: outside.length }
    })
  expect(await overflow()).toEqual({ sideways: 0, outside: 0 })

  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  expect(await overflow()).toEqual({ sideways: 0, outside: 0 })
  // The "+" and the form's buttons keep their size in the wide font.
  await form().getByRole('button', { name: 'Cancel' }).click()
  const add = await addButton().boundingBox()
  expect(add?.height).toBe(24)
})
