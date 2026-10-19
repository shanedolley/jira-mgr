import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  failComments,
  joinSprint,
  launch,
  logIn,
  refuseNextEdit,
  releaseEdit,
  showEverything,
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

const MOD = 'ControlOrMeta'

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const slot = (key: RegExp) => item(key).locator('[data-prop=comments]')
const badge = (key: RegExp) => slot(key).locator('[data-badge=comments]')
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const sprintRow = (key: string) => sprintPage().locator(`li[data-issue-key=${key}]`)
const modal = (key: string, summary: string) =>
  window.getByRole('dialog', { name: `Comments on ${key}: ${summary}` })
const box = (scope: ReturnType<typeof modal>) => scope.getByRole('textbox', { name: 'New comment' })
const writes = async () => (await counts(app)).edits

/** PSAPAC-4 holds no comment, PSAPAC-13 one, PSAPAC-1 two and PSAPAC-21 a hundred and twenty. */
async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
  await window.getByRole('button', { name: 'Display', exact: true }).click()
  await window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name: 'Comments', exact: true })
    .click()
  await window.keyboard.press('Escape')
  await expect(slot(/PSAPAC-1,/)).toBeVisible()
}

test('the Comments chip is off by default and, once on, every issue row shows a count', async () => {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
  await expect(item(/PSAPAC-1,/)).toBeVisible()
  await expect(item(/PSAPAC-1,/).locator('[data-prop=comments]')).toHaveCount(0)
  // The unresolved phase has loaded, and it did not ask Jira for the comment field.
  await expect.poll(async () => (await counts(app)).searches.unresolved).toBeGreaterThan(0)
  expect((await counts(app)).commentFieldReads).toEqual({ search: 0, sprint: 0 })
  await window.getByRole('button', { name: 'Display', exact: true }).click()
  const chip = window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name: 'Comments', exact: true })
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await window.keyboard.press('Escape')

  // Turning the property on reloads the list with the field, and the counts arrive.
  await expect.poll(async () => (await counts(app)).commentFieldReads.search).toBeGreaterThan(0)
  // The icon alone at 0, the number from 1, "99+" from 100; an Epic shows the slot like any issue.
  await expect(slot(/PSAPAC-4,/)).toHaveAttribute('title', 'No comments')
  await expect(badge(/PSAPAC-4,/)).toHaveCount(0)
  await expect(slot(/PSAPAC-13,/)).toHaveAttribute('title', '1 comment')
  await expect(badge(/PSAPAC-13,/)).toHaveText('1')
  await expect(slot(/PSAPAC-1,/)).toHaveAttribute('title', '2 comments')
  await expect(badge(/PSAPAC-1,/)).toHaveText('2')
  await expect(slot(/PSAPAC-21,/)).toHaveAttribute('title', '120 comments')
  await expect(badge(/PSAPAC-21,/)).toHaveText('99+')
  await expect(slot(/PSAPAC-10,/)).toHaveAttribute('title', 'No comments')
  await expect(item(/PSAPAC-1,/)).toHaveAttribute('aria-label', /, 2 comments/)
})

test('the Sprint page asks for the comment field only while the property is on', async () => {
  await joinSprint(app, ['PSAPAC-3'], 5)
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  const openSprint = async () => {
    await window
      .getByRole('navigation', { name: 'Main' })
      .getByRole('region', { name: 'Sprints' })
      .getByRole('button', { name: /^Current/ })
      .click()
    await expect(sprintRow('PSAPAC-3')).toBeVisible()
  }
  await openSprint()
  expect((await counts(app)).commentFieldReads.sprint).toBe(0)
  await expect(sprintRow('PSAPAC-3').locator('[data-prop=comments]')).toHaveCount(0)
  await window.keyboard.press('Escape')
  await expect(sprintPage()).toHaveCount(0)

  await window.getByRole('button', { name: 'Display', exact: true }).click()
  await window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name: 'Comments', exact: true })
    .click()
  await window.keyboard.press('Escape')
  await openSprint()
  await expect.poll(async () => (await counts(app)).commentFieldReads.sprint).toBeGreaterThan(0)
  await expect(sprintRow('PSAPAC-3').getByRole('button', { name: 'No comments' })).toBeVisible()
})

test('a click on the icon opens the modal on that issue and opens no Peek', async () => {
  await open()
  const dialog = modal('PSAPAC-13', 'Book the kickoff')
  await slot(/PSAPAC-13,/).click()

  await expect(dialog).toBeVisible()
  await expect(item(/PSAPAC-13,/)).toHaveAttribute('data-active', 'true')
  await expect(peek()).toHaveCount(0)
  await expect(dialog.getByText('Seeded note 1')).toBeVisible()
  // Focus is in the new-comment box, and the issue page's section is the one drawn.
  await expect(box(dialog)).toBeFocused()
  await expect(dialog.getByRole('region', { name: 'Activity' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(peek()).toHaveCount(0)
})

test('Shift+click on the icon checks a range and opens no modal', async () => {
  await open()
  await item(/PSAPAC-2,/)
    .locator('[data-check]')
    .click()
  await slot(/PSAPAC-4,/).click({ modifiers: ['Shift'] })

  await expect(window.getByRole('dialog')).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('aria-checked', 'true')
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('aria-checked', 'true')
})

test('Esc closes the modal when the box is empty', async () => {
  await open()
  await slot(/PSAPAC-13,/).click()
  const dialog = modal('PSAPAC-13', 'Book the kickoff')
  await expect(box(dialog)).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('posting with Cmd+Enter adds the comment and the badge follows at once', async () => {
  await open()
  await slot(/PSAPAC-13,/).click()
  const dialog = modal('PSAPAC-13', 'Book the kickoff')
  await expect(box(dialog)).toBeFocused()
  await window.keyboard.type('Booked it')
  await window.keyboard.press(`${MOD}+Enter`)

  await expect.poll(writes).toBe(1)
  await releaseEdit(app)
  await expect(dialog.getByText('Booked it')).toHaveCount(1)
  await expect(badge(/PSAPAC-13,/)).toHaveText('2')
  await expect(slot(/PSAPAC-13,/)).toHaveAttribute('title', '2 comments')
})

test('the author edits and deletes their own comment, and the badge follows a delete', async () => {
  await open()
  await slot(/PSAPAC-1,/).click()
  const dialog = modal('PSAPAC-1', 'Kick off the engagement')
  await expect(dialog.getByText('My first comment')).toBeVisible()
  // Only the signed-in user's comment offers the buttons.
  await expect(dialog.getByRole('button', { name: 'Edit comment' })).toHaveCount(1)
  await expect(dialog.getByRole('button', { name: 'Delete comment' })).toHaveCount(1)

  await dialog.getByRole('button', { name: 'Edit comment' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Comment by Test User' })).toBeFocused()
  await window.keyboard.press('End')
  await window.keyboard.type(' again')
  await window.keyboard.press(`${MOD}+Enter`)
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)
  await expect(dialog.getByText('My first comment again')).toBeVisible()
  await expect(badge(/PSAPAC-1,/)).toHaveText('2')

  await dialog.getByRole('button', { name: 'Delete comment' }).click()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog.getByText('My first comment again')).toHaveCount(0)
  await expect(badge(/PSAPAC-1,/)).toHaveText('1')
  await expect.poll(writes).toBe(2)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(2)
  await expect(badge(/PSAPAC-1,/)).toHaveText('1')
})

test('after a comment edit is saved or cancelled, focus goes to the comment box, not the body', async () => {
  await open()
  await slot(/PSAPAC-1,/).click()
  const dialog = modal('PSAPAC-1', 'Kick off the engagement')
  await dialog.getByRole('button', { name: 'Edit comment' }).click()
  const editor = dialog.getByRole('textbox', { name: 'Comment by Test User' })
  await expect(editor).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(box(dialog)).toBeFocused()

  await dialog.getByRole('button', { name: 'Edit comment' }).click()
  await expect(editor).toBeFocused()
  await window.keyboard.press('End')
  await window.keyboard.type('!')
  await window.keyboard.press(`${MOD}+Enter`)
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)
  await expect(dialog.getByText('My first comment!')).toBeVisible()
  await expect(box(dialog)).toBeFocused()
})

test('a draft survives closing and reopening, and Esc over a draft asks before discarding', async () => {
  await open()
  await slot(/PSAPAC-13,/).click()
  const dialog = modal('PSAPAC-13', 'Book the kickoff')
  await expect(box(dialog)).toBeFocused()
  await window.keyboard.type('Half a thought')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await slot(/PSAPAC-13,/).click()
  await expect(box(dialog)).toContainText('Half a thought')
  await expect(box(dialog)).toBeFocused()

  await window.keyboard.press('Escape')
  const ask = window.getByRole('alertdialog', { name: 'Discard your comment?' })
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: 'Keep writing' }).click()
  await expect(dialog).toBeVisible()
  await expect(box(dialog)).toContainText('Half a thought')
  await expect(box(dialog)).toBeFocused()

  await window.keyboard.press('Escape')
  await ask.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await slot(/PSAPAC-13,/).click()
  await expect(box(dialog)).toHaveText('')
})

test('a refused post shows the failure and leaves the draft in the box', async () => {
  await open()
  await slot(/PSAPAC-13,/).click()
  const dialog = modal('PSAPAC-13', 'Book the kickoff')
  await expect(box(dialog)).toBeFocused()
  await window.keyboard.type('Will not go')
  await refuseNextEdit(app)
  await window.keyboard.press(`${MOD}+Enter`)
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)

  await expect(dialog.getByRole('alert')).toContainText('Could not post the comment.')
  await expect(box(dialog)).toContainText('Will not go')
  await expect(badge(/PSAPAC-13,/)).toHaveText('1')
})

test('a failed read shows the load failure with Retry, and Retry recovers', async () => {
  await open()
  await failComments(app, 500)
  await slot(/PSAPAC-13,/).click()
  const dialog = modal('PSAPAC-13', 'Book the kickoff')

  const alert = dialog.getByRole('alert').filter({ hasText: 'Jira had a problem' })
  await expect(alert).toContainText('Jira had a problem. Retry in a minute.')
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(dialog.getByText('Seeded note 1')).toBeVisible()
})

test('on the Sprint page the slot is a button, and Enter on it opens the modal', async () => {
  await joinSprint(app, ['PSAPAC-3', 'PSAPAC-21'], 5)
  await open()
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
  const button = (key: string, name: string) =>
    sprintRow(key).getByRole('button', { name, exact: true })

  await expect(button('PSAPAC-3', 'No comments')).toBeVisible()
  await expect(sprintRow('PSAPAC-21').locator('[data-badge=comments]')).toHaveText('99+')
  await button('PSAPAC-13', '1 comment').click()
  const dialog = modal('PSAPAC-13', 'Book the kickoff')
  await expect(dialog.getByText('Seeded note 1')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await button('PSAPAC-13', '1 comment').focus()
  await window.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
})
