import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  holdTransitions,
  launch,
  logIn,
  notices,
  peekRow,
  refuseNextEdit,
  releaseEdit,
  releaseTransitions,
  SITE,
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
const dialog = () => window.getByRole('dialog', { name: 'New issue' })
const option = (name: string | RegExp) => window.getByRole('option', { name })

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under a click.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Makes the row active, then closes the Peek the click opened: the state a letter starts from. */
async function select(row: RegExp) {
  await peekRow(item(row))
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
}

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1)

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

/** What the system clipboard holds, read in the main process. */
const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText())
const clearClipboard = () =>
  app.evaluate(({ clipboard }) => {
    clipboard.clear()
  })

test('I assigns the active issue to me, and the toast offers Undo', async () => {
  await open()
  await select(/PSAPAC-3,/)
  const before = await writes()
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/unassigned/)

  await window.keyboard.press('i')
  // The row shows the new assignee before Jira answers.
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/Test User/)
  await settle(before + 1)
  expect(await lastBody()).toEqual({ fields: { assignee: { accountId: 'u1' } } })
  await expect(notices(window).getByText('PSAPAC-3: assignee changed to Test User')).toBeVisible()
  await expect(window.getByRole('button', { name: 'Undo' })).toBeVisible()
  // No Peek opened, and the Tree keeps the keyboard.
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()

  // The issue is mine now, so a second press writes nothing.
  await window.keyboard.press('i')
  await window.keyboard.press('Meta+z')
  await settle(before + 2)
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/unassigned/)
})

test("I does nothing on an issue that is already mine, and takes over another person's", async () => {
  await open()
  await select(/PSAPAC-4,/)
  const before = await writes()

  await window.keyboard.press('i')
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/Test User/)
  expect(await writes()).toBe(before)

  // Someone else's issue: taken over, as the Assignee picker's Me does.
  await select(/PSAPAC-11,/)
  await expect(item(/PSAPAC-11,/)).toHaveAccessibleName(/Other User/)
  await window.keyboard.press('i')
  await expect(item(/PSAPAC-11,/)).toHaveAccessibleName(/Test User/)
  await settle(before + 1)
})

test('a refused I puts the row back and says so', async () => {
  await open()
  await select(/PSAPAC-3,/)
  const before = await writes()
  await refuseNextEdit(app)

  await window.keyboard.press('i')
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)
  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Assignee not changed. Jira refused it:')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/unassigned/)
})

test('Y copies the issue key and U copies its link on the configured site', async () => {
  await open()
  await select(/PSAPAC-4,/)
  await clearClipboard()

  await window.keyboard.press('y')
  await expect.poll(clipboardText).toBe('PSAPAC-4')
  await expect(notices(window).getByText('Copied the key of PSAPAC-4')).toBeVisible()

  await window.keyboard.press('u')
  await expect.poll(clipboardText).toBe(`${SITE}/browse/PSAPAC-4`)
  await expect(notices(window).getByText('Copied the link of PSAPAC-4')).toBeVisible()
  // Nothing opened and nothing was written.
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('Copy key and Copy link in the Peek copy for its issue', async () => {
  await open()
  await peekRow(item(/PSAPAC-2,/))
  await expect(peek()).toBeVisible()
  await clearClipboard()

  await peek().getByRole('button', { name: 'Copy key' }).click()
  await expect.poll(clipboardText).toBe('PSAPAC-2')
  await peek().getByRole('button', { name: 'Copy link' }).click()
  await expect.poll(clipboardText).toBe(`${SITE}/browse/PSAPAC-2`)
})

/** The window's smallest width (app.ts), where the Peek is 348px, not the 416px of a 1200px window. */
async function narrowestPeekHeader(font?: string) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 800)
  })
  if (font !== undefined) {
    await window.addStyleTag({ content: `* { font-family: ${font} !important }` })
  }
  await peekRow(item(/PSAPAC-2,/))
  await expect(peek()).toBeVisible()
  const header = peek().locator('.app-drag')
  await expect(header.getByRole('button')).toHaveCount(5)
  // With justify-end an overflow runs off the left edge, so compare each button's box to the header's.
  return header.evaluate((el) => {
    const box = el.getBoundingClientRect()
    return {
      width: Math.round(box.width),
      leftMargins: [...el.querySelectorAll('button')].map((b) =>
        Math.round(b.getBoundingClientRect().left - box.left),
      ),
      heights: [...el.querySelectorAll('button')].map((b) =>
        Math.round(b.getBoundingClientRect().height),
      ),
      tops: [...el.querySelectorAll('button')].map((b) =>
        Math.round(b.getBoundingClientRect().top),
      ),
    }
  })
}

test("the Peek's five header buttons fit on one line at the narrowest window", async () => {
  await open()
  const fit = await narrowestPeekHeader()
  expect(fit.width).toBeLessThanOrEqual(360)
  // The header pads 12px, so no button starts left of it, and all five sit on one line.
  for (const left of fit.leftMargins) expect(left).toBeGreaterThanOrEqual(12)
  expect(new Set(fit.heights).size).toBe(1)
  expect(new Set(fit.tops).size).toBe(1)
})

// Linux CI sets the system font in a face wider than macOS's (PR #163).
test("the Peek's header buttons fit in a wide font too", async () => {
  await open()
  const fit = await narrowestPeekHeader('Verdana, "DejaVu Sans", sans-serif')
  for (const left of fit.leftMargins) expect(left).toBeGreaterThanOrEqual(12)
  expect(new Set(fit.heights).size).toBe(1)
  expect(new Set(fit.tops).size).toBe(1)
})

test('I, Y and U do nothing in a field, with a modifier, in a dialog or with no issue selected', async () => {
  await open()
  const before = await writes()
  await clearClipboard()

  // A Customer header is active at first, which is no issue.
  for (const key of ['i', 'y', 'u']) await window.keyboard.press(key)

  const filter = window.getByLabel('Filter by key or summary')
  await filter.pressSequentially('iyu')
  await expect(filter).toHaveValue('iyu')
  await filter.fill('')

  await select(/PSAPAC-3,/)
  for (const key of ['Alt+i', 'Control+y', 'Meta+u']) await window.keyboard.press(key)

  await window.keyboard.press('c')
  await expect(dialog()).toBeVisible()
  await window.keyboard.press('i')
  await expect(dialog().getByLabel('Summary')).toHaveValue('i')

  expect(await writes()).toBe(before)
  expect(await clipboardText()).toBe('')
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/unassigned/)
})

test('1 to 9 choose the numbered option in the Status and Priority pickers', async () => {
  await open()
  await select(/PSAPAC-4,/)
  const before = await writes()
  const names = async () =>
    (await window.getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0] ?? '')

  await window.keyboard.press('s')
  const list = window.getByRole('listbox', { name: 'Status' })
  await expect(list).toBeFocused()
  await expect(option('To Do')).toBeVisible()
  const statuses = await names()
  expect(statuses.length).toBeGreaterThan(1)
  // Each option shows its number as a keycap.
  await expect(window.getByRole('option').first().locator('kbd')).toHaveText('1')
  await expect(window.getByRole('option').nth(1).locator('kbd')).toHaveText('2')
  await window.keyboard.press('1')
  await expect(window.getByRole('listbox')).toHaveCount(0)
  // `S` opens the list beside the row's dot, so no Peek is open: the row shows the choice.
  await expect(peek()).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(new RegExp(`, ${statuses[0] ?? ''},`))
  await settle(before + 1)
  await expect(tree()).toBeFocused()

  // A number past the last option does nothing, and the list stays open.
  await window.keyboard.press('p')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeFocused()
  // The list loads when the picker opens, so wait for its last option before reading them all.
  await expect(option('Low')).toBeVisible()
  const priorities = await names()
  await window.keyboard.press('9')
  await expect(window.getByRole('listbox', { name: 'Priority' })).toBeVisible()
  await window.keyboard.press('4')
  // `P` opens the list beside the row's slot, so no Peek is open: the row shows the choice.
  await expect(peek()).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(
    new RegExp(`, priority ${priorities[3] ?? ''}`),
  )
  await settle(before + 2)
  await expect(tree()).toBeFocused()
})

test('Cmd, Ctrl and Alt with a digit do nothing in a numbered picker', async () => {
  await open()
  await select(/PSAPAC-4,/)
  const before = await writes()
  await window.keyboard.press('s')
  const list = window.getByRole('listbox', { name: 'Status' })
  await expect(list).toBeFocused()
  await expect(option('To Do')).toBeVisible()

  for (const key of ['Meta+1', 'Control+1', 'Alt+1']) await window.keyboard.press(key)
  await expect(list).toBeVisible()
  expect(await writes()).toBe(before)
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/, In Progress,/)
})

test('digits type into the searchable Assignee picker instead of choosing', async () => {
  await open()
  await select(/PSAPAC-4,/)
  await window.keyboard.press('a')
  const search = window.getByRole('combobox', { name: 'Search Assignee' })
  await expect(search).toBeFocused()
  await window.keyboard.press('2')
  await expect(search).toHaveValue('2')
  await expect(window.getByRole('option').locator('kbd')).toHaveCount(0)
})

test('a click on a status dot opens its Status list beside the dot, not the Peek', async () => {
  await open()
  const before = await writes()

  await item(/PSAPAC-3,/)
    .getByTitle('Change status')
    .click()
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await expect(peek()).toHaveCount(0)
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')

  await window.keyboard.press('2')
  await settle(before + 1)
  await expect(item(/PSAPAC-3,/)).not.toHaveAccessibleName(/To Do/)
  await expect(tree()).toBeFocused()
})

test('a digit pressed while the Status list is still loading chooses once it loads', async () => {
  // The list opens at once and reads the transitions after: a digit that lands first found no option and was lost.
  await open()
  await holdTransitions(app)
  const before = await writes()

  await item(/PSAPAC-3,/)
    .getByTitle('Change status')
    .click()
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await expect(window.getByText('Loading statuses')).toBeVisible()
  await window.keyboard.press('2')
  await releaseTransitions(app)

  await settle(before + 1)
  await expect(item(/PSAPAC-3,/)).not.toHaveAccessibleName(/To Do/)
  await expect(tree()).toBeFocused()
})

test('digit 1 pressed while the Status list is loading waits too, and moves an In Progress issue', async () => {
  // While loading, the first option is the current status. Choosing it closed the list with no write.
  await open()
  await holdTransitions(app)
  const before = await writes()
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/, In Progress,/)

  await item(/PSAPAC-4,/)
    .getByTitle('Change status')
    .click()
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await expect(window.getByText('Loading statuses')).toBeVisible()
  await window.keyboard.press('1')
  await releaseTransitions(app)

  await settle(before + 1)
  await expect(item(/PSAPAC-4,/)).not.toHaveAccessibleName(/, In Progress,/)
  await expect(tree()).toBeFocused()
})

test('the + on a Customer header opens create with that Customer, without toggling the group', async () => {
  await open()
  const header = item(/^Beta Ltd, 5 issues$/)
  await expect(header).toHaveAttribute('aria-expanded', 'true')

  await header.hover()
  // The hovered header is the active row.
  await expect(header).toHaveAttribute('data-active', 'true')
  await header.getByRole('button', { name: 'Add issue to Beta Ltd' }).click()
  await expect(dialog()).toBeVisible()
  await expect(dialog().getByRole('button', { name: 'Customer: Beta Ltd' })).toBeVisible()
  await expect(dialog().getByRole('button', { name: 'Parent: None' })).toBeVisible()

  await window.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)
  // The click did not collapse the group nor move the active row, and focus is back on the Tree.
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await expect(header).toHaveAttribute('data-active', 'true')
  await expect(tree()).toBeFocused()
})

test('the + on a No Epic header names its Customer', async () => {
  await open()
  await expect(
    tree().getByRole('button', { name: 'Add issue to No Epic in Beta Ltd' }),
  ).toHaveCount(1)
})

test('the + stays out of the Tab order', async () => {
  await open()
  await expect(tree().getByRole('button', { name: 'Add issue to Beta Ltd' })).toHaveAttribute(
    'tabindex',
    '-1',
  )
})
