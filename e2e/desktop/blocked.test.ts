import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, peekRow, releaseEdit } from './harness.js'

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
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const blocked = (row: RegExp) => item(row).locator('[data-pill=blocked]')
const blocking = (row: RegExp) => item(row).locator('[data-pill=blocking]')
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const links = () => issuePage().getByRole('region', { name: 'Links' })

/** Opens the issue's page from its row. */
async function openPage(row: RegExp, title: string) {
  await peekRow(item(row))
  await window.keyboard.press('Enter')
  await expect(issuePage().getByRole('heading', { name: title })).toBeVisible()
  await expect(links().getByText('Loading links')).toHaveCount(0)
}

/** Waits for the one write to arrive, then lets the fake Jira apply it. */
async function applyWrite() {
  await expect.poll(async () => (await counts(app)).edits).toBe(1)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(1)
}

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
}

// The fake Jira links PSAPAC-1 as the blocker of PSAPAC-2, and relates PSAPAC-3 to PSAPAC-1.
test('a blocked row shows a count, the blocker shows a second pill, and a Relates link shows none', async () => {
  await open()

  await expect(blocked(/PSAPAC-2,/)).toHaveText('1')
  await expect(blocked(/PSAPAC-2,/)).toHaveAttribute('title', 'Blocked by 1 issue')
  await expect(blocking(/PSAPAC-2,/)).toHaveCount(0)
  await expect(item(/PSAPAC-2,.*blocked by 1 issue/)).toBeVisible()

  await expect(blocking(/PSAPAC-1,/)).toHaveText('1')
  await expect(blocking(/PSAPAC-1,/)).toHaveAttribute('title', 'Blocking 1 issue')
  await expect(blocked(/PSAPAC-1,/)).toHaveCount(0)
  await expect(item(/PSAPAC-1,.*blocking 1 issue/)).toBeVisible()

  await expect(item(/PSAPAC-3,/).locator('[data-pill]')).toHaveCount(0)
})

test('the Peek lists the blockers of the issue it shows', async () => {
  await open()

  await peekRow(item(/PSAPAC-2,/))
  const section = peek().getByRole('region', { name: 'Blocked by' })
  await expect(section.locator('[data-blocker=PSAPAC-1]')).toBeVisible()

  await peekRow(item(/PSAPAC-3,/))
  await expect(peek().getByRole('region', { name: 'Blocked by' })).toHaveCount(0)
})

test('both pills clear when the blocker moves to Done', async () => {
  await open()
  await expect(blocked(/PSAPAC-2,/)).toBeVisible()
  const before = (await counts(app)).edits

  await peekRow(item(/PSAPAC-1,/))
  await window.keyboard.press('Escape')
  await window.keyboard.press('s')
  await window.getByRole('option', { name: 'Done' }).click()

  // The pills clear from the loaded status, before Jira answers the write.
  await expect(blocked(/PSAPAC-2,/)).toHaveCount(0)
  await expect(item(/PSAPAC-2,/)).not.toHaveAccessibleName(/blocked by/)
  await expect.poll(async () => (await counts(app)).edits).toBe(before + 1)
  await releaseEdit(app)
})

test('a Blocks link added on the issue page shows its pills in the Tree', async () => {
  await open()
  await expect(item(/PSAPAC-4,/).locator('[data-pill]')).toHaveCount(0)
  await openPage(/PSAPAC-4,/, 'Migrate the dashboards')

  await links().getByRole('button', { name: 'Add link' }).click()
  const form = links().getByRole('form', { name: 'Add link' })
  await form.getByLabel('Link type').selectOption({ label: 'is blocked by' })
  await form.getByLabel('Linked issue').fill('PSAPAC-3')
  await form.getByRole('button', { name: 'Add link' }).click()
  await applyWrite()

  await issuePage().getByRole('button', { name: 'Back to issues' }).click()
  await expect(blocked(/PSAPAC-4,/)).toHaveText('1')
  await expect(blocking(/PSAPAC-3,/)).toHaveText('1')
})

test('a Blocks link removed on the issue page clears its pills in the Tree', async () => {
  await open()
  await expect(blocked(/PSAPAC-2,/)).toBeVisible()
  await openPage(/PSAPAC-1,/, 'Kick off the engagement')

  await links().getByRole('button', { name: 'Remove link to PSAPAC-2' }).click()
  await applyWrite()

  await issuePage().getByRole('button', { name: 'Back to issues' }).click()
  await expect(item(/PSAPAC-2,/)).toBeVisible()
  await expect(blocked(/PSAPAC-2,/)).toHaveCount(0)
  await expect(blocking(/PSAPAC-1,/)).toHaveCount(0)
})
