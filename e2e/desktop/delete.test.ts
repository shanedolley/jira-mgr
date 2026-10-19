import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  dropIssue,
  launch,
  logIn,
  notices,
  peekRow,
  releaseDone,
  releaseEdit,
  showEverything,
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
const dialog = (key: string) => window.getByRole('dialog', { name: `Delete ${key}?` })
const toast = () =>
  notices(window)
    .getByRole('listitem')
    .filter({ hasText: /^Deleted/ })

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under a click.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
  // Subtasks show only from the Everything level.
  await showEverything(window)
}

/** Opens the full page of the issue whose row matches, with Enter. */
async function openPage(row: RegExp) {
  await open()
  await peekRow(item(row))
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
}

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1)

test('lists nothing to cascade for a plain issue, deletes at once and answers later', async () => {
  await openPage(/PSAPAC-4,/)
  const before = await counts(app)

  await issuePage().getByRole('button', { name: 'Delete' }).click()
  const confirm = dialog('PSAPAC-4')
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('Migrate the dashboards')
  await expect(confirm).toContainText('permanently')
  await expect(confirm.getByRole('region', { name: 'Subtasks deleted with it' })).toHaveCount(0)
  // Cancel has focus, so a stray Enter cannot delete.
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()

  await confirm.getByRole('button', { name: 'Delete issue', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  // Gone from the Tree and the page closed, with Jira's answer still pending.
  await expect(issuePage()).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).toHaveCount(0)
  await expect.poll(writes).toBe(before.edits + 1)
  expect((await counts(app)).applied).toBe(before.applied)
  expect(await lastBody()).toEqual({ delete: 'PSAPAC-4', deleteSubtasks: false })
  await expect(tree()).toBeFocused()

  await releaseEdit(app)
  await expect(toast()).toContainText('Deleted PSAPAC-4')
  await expect(item(/PSAPAC-4,/)).toHaveCount(0)
  // No list was reloaded for the delete.
  expect((await counts(app)).searches).toEqual(before.searches)
})

test('Cancel and Esc leave the issue alone and return focus to the Delete button', async () => {
  await openPage(/PSAPAC-4,/)
  const remove = issuePage().getByRole('button', { name: 'Delete' })
  const before = await counts(app)

  await remove.click()
  await dialog('PSAPAC-4').getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog('PSAPAC-4')).toHaveCount(0)
  await expect(remove).toBeFocused()

  await remove.click()
  await expect(dialog('PSAPAC-4')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(dialog('PSAPAC-4')).toHaveCount(0)
  await expect(remove).toBeFocused()
  // Esc closed the dialog only, not the page under it.
  await expect(issuePage()).toBeVisible()
  expect((await counts(app)).edits).toBe(before.edits)
})

test('lists every subtask that goes with the issue and deletes them on the cascade', async () => {
  await openPage(/PSAPAC-11,/)
  await expect(issuePage().getByText('Outline the sections')).toBeVisible()
  await issuePage().getByRole('button', { name: 'Delete' }).click()

  const confirm = dialog('PSAPAC-11')
  const subtasks = confirm.getByRole('region', { name: 'Subtasks deleted with it' })
  await expect(subtasks).toContainText('1 subtask will be deleted with it')
  await expect(subtasks).toContainText('PSAPAC-12')
  await expect(subtasks).toContainText('Outline the sections')
  await expect(item(/PSAPAC-12,/)).toBeAttached()

  await confirm.getByRole('button', { name: 'Delete issue and 1 subtask' }).click()
  await expect(item(/PSAPAC-11,/)).toHaveCount(0)
  await expect(item(/PSAPAC-12,/)).toHaveCount(0)
  await expect.poll(writes).toBe(1)
  expect(await lastBody()).toEqual({ delete: 'PSAPAC-11', deleteSubtasks: true })

  await releaseEdit(app)
  await expect(toast()).toContainText('Deleted PSAPAC-11 and PSAPAC-12')
})

test('says that the children of an Epic stay and lose their parent', async () => {
  await open()
  await releaseDone(app)
  // Hide done keeps the Done children off the Tree, so turn it off to see them arrive.
  await window.getByRole('button', { name: 'Hide done', exact: true }).click()
  await expect(item('2 done', true)).toBeVisible()
  await peekRow(item(/PSAPAC-10,/))
  await peek().getByRole('button', { name: 'Delete' }).click()

  const confirm = dialog('PSAPAC-10')
  const kept = confirm.getByRole('region', { name: 'Child issues that stay' })
  await expect(kept).toContainText('8 child issues stay and lose this parent')
  // Oldest first, five named, the rest counted.
  await expect(kept.getByRole('listitem')).toHaveText([
    'PSAPAC-1Kick off the engagement',
    'PSAPAC-2Review the data model',
    'PSAPAC-3Fix the export timeout',
    'PSAPAC-4Migrate the dashboards',
    'PSAPAC-11Draft the runbook',
    'and 3 more',
  ])
  await expect(confirm.getByRole('region', { name: 'Subtasks deleted with it' })).toHaveCount(0)

  await confirm.getByRole('button', { name: 'Delete issue', exact: true }).click()
  await expect(item(/PSAPAC-10,/)).toHaveCount(0)
  // The Stories stay, under the Customer's No Epic group.
  await expect(item(/PSAPAC-4,/)).toBeVisible()
  await expect(item(/^No Epic, /).first()).toBeVisible()
  await expect(peek()).toHaveCount(0)
  expect(await lastBody()).toEqual({ delete: 'PSAPAC-10', deleteSubtasks: false })
  await releaseEdit(app)
  await expect(toast()).toContainText('Deleted PSAPAC-10')
})

test('puts the issue back and says why when Jira refuses the delete', async () => {
  await open()
  await peekRow(item(/PSAPAC-3,/))
  await peek().getByRole('button', { name: 'Delete' }).click()
  await dialog('PSAPAC-3').getByRole('button', { name: 'Delete issue', exact: true }).click()

  await expect(item(/PSAPAC-3,/)).toHaveCount(0)
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)

  await expect(item(/PSAPAC-3,/)).toBeVisible()
  const failure = window.getByRole('alert').filter({ hasText: 'Could not delete PSAPAC-3' })
  await expect(failure).toContainText('You cannot delete this issue.')
  await expect(failure).toContainText('It is back in the list.')
  // Jira's message names the request; the notice leaves it out.
  await expect(failure).not.toContainText('/rest/')
  await expect(failure).not.toContainText('DELETE')
  // A failure stays until it is dismissed.
  await failure.getByRole('button', { name: 'Dismiss' }).click()
  await expect(failure).toHaveCount(0)
})

test('Tab stays inside the delete dialog', async () => {
  await openPage(/PSAPAC-11,/)
  await issuePage().getByRole('button', { name: 'Delete' }).click()
  await expect(dialog('PSAPAC-11').getByRole('button', { name: /^Delete issue and/ })).toBeEnabled()

  for (let step = 0; step < 8; step++) {
    await window.keyboard.press('Tab')
    expect(
      await window.evaluate<boolean>("document.activeElement?.closest('dialog') !== null"),
    ).toBe(true)
  }
})

test('deletes a Done parent the lists do not hold yet, opened from a child page', async () => {
  // The fake holds the Done phase, so PSAPAC-20 is in no list: only its own read has it.
  await openPage(/PSAPAC-21,/)
  await issuePage().getByRole('button', { name: 'PSAPAC-20', exact: true }).click()
  await expect(issuePage().getByRole('heading', { name: 'Platform migration' })).toBeVisible()

  await issuePage().getByRole('button', { name: 'Delete' }).click()
  await expect(dialog('PSAPAC-20')).toBeVisible()
  await expect(dialog('PSAPAC-20')).toContainText('Platform migration')

  // Cancel leaves nothing disabled: the New issue button works and no dialog comes back later.
  await dialog('PSAPAC-20').getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog('PSAPAC-20')).toHaveCount(0)
  await expect(window.getByRole('button', { name: 'New issue' })).toBeEnabled()
  await releaseDone(app)
  await expect.poll(async () => (await counts(app)).searches.done).toBeGreaterThan(0)
  await expect(dialog('PSAPAC-20')).toHaveCount(0)
  await expect(window.getByRole('dialog')).toHaveCount(0)

  await issuePage().getByRole('button', { name: 'Delete' }).click()
  await dialog('PSAPAC-20').getByRole('button', { name: 'Delete issue', exact: true }).click()
  await expect.poll(writes).toBe(1)
  expect(await lastBody()).toEqual({ delete: 'PSAPAC-20', deleteSubtasks: false })
  await releaseEdit(app)
  await expect(toast()).toContainText('Deleted PSAPAC-20')
})

test('keeps the delete dialog open when a refetch drops the issue, says it is gone, and leaves C working', async () => {
  await open()
  await peekRow(item(/PSAPAC-4,/))
  await peek().getByRole('button', { name: 'Delete' }).click()
  await expect(dialog('PSAPAC-4')).toBeVisible()
  await expect(dialog('PSAPAC-4').getByRole('button', { name: 'Delete issue' })).toBeEnabled()

  await dropIssue(app, 'PSAPAC-4')
  const before = await counts(app)
  await app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows()
    first?.emit('blur')
    first?.emit('focus')
  })
  await expect
    .poll(async () => (await counts(app)).searches.unresolved)
    .toBeGreaterThan(before.searches.unresolved)
  await expect(item(/PSAPAC-4,/)).toHaveCount(0)
  // The dialog holds the issue it was opened for, so it neither vanishes nor lingers unseen.
  await expect(dialog('PSAPAC-4')).toBeVisible()

  // Confirming a delete Jira cannot find says so, and does not claim to have put anything back.
  await dialog('PSAPAC-4').getByRole('button', { name: 'Delete issue', exact: true }).click()
  await expect(dialog('PSAPAC-4')).toHaveCount(0)
  // The Peek's Delete button went with the issue, so focus falls back to the Tree.
  await expect(tree()).toBeFocused()
  const failure = window.getByRole('alert').filter({ hasText: 'Could not delete PSAPAC-4' })
  await expect(failure).toContainText('PSAPAC-4 no longer exists in Jira.')
  await expect(failure).not.toContainText('back in the list')
  await failure.getByRole('button', { name: 'Dismiss' }).click()
  await expect(window.getByRole('button', { name: 'New issue' })).toBeEnabled()
  await window.keyboard.press('c')
  await expect(window.getByRole('dialog', { name: 'New issue' })).toBeVisible()
})
