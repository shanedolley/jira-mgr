import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, notices, releaseEdit } from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const dialog = () => window.getByRole('dialog', { name: 'New issue' })
const toast = (lead: 'Created' | 'Jira changed') =>
  notices(window)
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`^${lead}`) })

/** Opens the app on a fake whose automation lands `automationMs` after a create, read again after `readMs`. */
async function start(env: Record<string, string>) {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  ;({ app, window } = await launch(stateDir, env))
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Creates a Task under PSAPAC-2 and lets the fake Jira answer the create. */
async function createTask(summary: string) {
  await item(/PSAPAC-2,/).click()
  await window.keyboard.press('Escape')
  await window.keyboard.press('c')
  await dialog().getByLabel('Summary').fill(summary)
  await dialog().getByRole('button', { name: 'Type: Story' }).click()
  await window.getByRole('option', { name: 'Task', exact: true }).click()
  await dialog().getByRole('button', { name: 'Create issue' }).click()
  await expect.poll(async () => (await counts(app)).edits).toBe(1)
  await releaseEdit(app)
  await expect(dialog()).toHaveCount(0)
}

test('a second read names what the automation changed after the create returned', async () => {
  await start({ JM_E2E_LATE_AUTOMATION_MS: '600', JM_E2E_LATE_READ_MS: '2500' })
  await createTask('Book the workshop')

  // The create's own read-back came first and saw none of it.
  await expect(toast('Created')).toContainText('Created PSAPAC-2000: Book the workshop')
  await expect(toast('Created')).not.toContainText('Customer is')
  // It still sits under PSAPAC-10, in a group of seven.
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('aria-setsize', '7')

  await expect(toast('Jira changed')).toContainText('Jira changed PSAPAC-2000 after it was created')
  await expect(toast('Jira changed')).toContainText(
    'Customer is Collibra (Internal team) (you chose Acme).',
  )
  await expect(toast('Jira changed')).toContainText('Parent is PSAPAC-50 (you chose PSAPAC-10).')
  await expect(toast('Jira changed')).toContainText('Sprint is Sprint 5 (you chose none).')
  await expect(toast('Jira changed')).toContainText('Jira added the label PSAPAC.')
  // The Tree moved the row to where Jira put it: under the internal Epic, in a group of two.
  await expect(item(/PSAPAC-2000,/)).toHaveAttribute('aria-setsize', '2')
  expect((await counts(app)).issueReads.filter((key) => key === 'PSAPAC-2000')).toHaveLength(2)
})

test('no second toast when the second read finds nothing new', async () => {
  await start({ JM_E2E_LATE_READ_MS: '800' })
  await createTask('Book the workshop')

  // The fake applied its automation before the first read, so that toast named everything.
  await expect(toast('Created')).toContainText('Created PSAPAC-2000: Book the workshop')
  await expect(toast('Created')).toContainText('Jira added the label PSAPAC.')
  await expect
    .poll(async () => (await counts(app)).issueReads.filter((key) => key === 'PSAPAC-2000').length)
    .toBe(2)
  await expect(toast('Created')).toContainText('Created PSAPAC-2000: Book the workshop')
  await expect(toast('Jira changed')).toHaveCount(0)
})
