/// <reference lib="dom" />
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  fieldsOf,
  inboxChange,
  inboxComment,
  inboxWatch,
  launch,
  logIn,
  readState,
  type InboxItem,
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

interface StoredInbox {
  version: number
  allReadAt: string
  reads: Record<string, string>
}

const stored = () => readState<StoredInbox>(stateDir, 'inbox.json')

const STATUS: InboxItem = { field: 'status', fromString: 'To Do', toString: 'In Progress' }
const PRIORITY: InboxItem = { field: 'priority', fromString: 'Medium', toString: 'High' }

const tree = () => window.getByRole('tree', { name: 'Issues' })
const inboxLink = () => window.getByRole('link', { name: /^Inbox/ })
const inboxPage = () => window.getByRole('region', { name: 'Inbox' })
const rows = () => window.getByRole('list', { name: 'Inbox items' }).getByRole('button')
const row = (key: string) => rows().filter({ hasText: key })
const markAll = () => window.getByRole('button', { name: 'Mark all read' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })

const updatedOf = async (key: string) => (await fieldsOf(app, key))?.updated as string

async function open() {
  await logIn(window)
  await expect(tree()).toBeVisible()
}

async function openInbox() {
  await inboxLink().click()
  await expect(inboxPage()).toBeVisible()
}

/** The window loses focus and gets it back, which is when the app looks at Jira again. */
const refocus = () =>
  app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows()
    first?.emit('blur')
    first?.emit('focus')
  })

/** PSAPAC-2 changed by someone else, PSAPAC-4 commented on by someone else, PSAPAC-3 changed by the user. */
async function seed() {
  await inboxChange(app, 'PSAPAC-3', 'me', [PRIORITY])
  await inboxChange(app, 'PSAPAC-2', 'other', [STATUS])
  await inboxComment(app, 'PSAPAC-4', 'other')
}

test('lists what changed since the user looked, naming each change and marking the unread', async () => {
  await seed()
  await open()

  await expect(inboxLink()).toHaveAccessibleName('Inbox 2 unread')
  await openInbox()
  await expect(rows()).toHaveCount(3)
  // Newest first: the comment, the status change, then the user's own priority change.
  await expect(rows().nth(0)).toContainText('PSAPAC-4 · Comment by Other User')
  await expect(rows().nth(1)).toContainText('Review the data model')
  await expect(rows().nth(1)).toContainText('PSAPAC-2 · Status: To Do to In Progress · Other User')
  await expect(row('PSAPAC-4')).toHaveAttribute('data-unread', '')
  await expect(row('PSAPAC-2')).toHaveAttribute('data-unread', '')
  // The user's own change is not news: the entry is listed, read, and says where the issue stands.
  await expect(row('PSAPAC-3')).not.toHaveAttribute('data-unread', '')
  await expect(row('PSAPAC-3')).toContainText('PSAPAC-3 · To Do')
  await expect(markAll()).toBeEnabled()

  await window.screenshot({ path: process.env.JM_INBOX_SHOT ?? join(stateDir, 'inbox.png') })
})

test('covers the Tree, which stays mounted under it', async () => {
  await seed()
  await open()
  await openInbox()
  const covered = await window.evaluate(() => {
    const page = document.querySelector('[aria-label="Inbox"]')
    if (page === null) return false
    // The covered list is inert, which hit testing skips, so look as if it took clicks.
    document.getElementById('issue-list')?.removeAttribute('inert')
    const box = page.getBoundingClientRect()
    // Sticky group headers and rows of the Tree sit all over the page's area.
    return [0.1, 0.3, 0.5, 0.7, 0.9].every((fraction) =>
      [0.1, 0.5, 0.9].every((across) => {
        const at = document.elementFromPoint(
          box.left + box.width * across,
          box.top + box.height * fraction,
        )
        return at !== null && page.contains(at)
      }),
    )
  })
  expect(covered).toBe(true)
})

test('shows no badge and a plain page when nothing has changed', async () => {
  await open()
  await expect(inboxLink()).toHaveAccessibleName('Inbox')
  await openInbox()
  await expect(inboxPage().getByText('Nothing has changed lately')).toBeVisible()
  await expect(markAll()).toBeDisabled()
})

test('opening an entry marks it read, writes inbox.json and drops the badge', async () => {
  await seed()
  await open()
  await openInbox()
  expect(await stored()).toBeNull()

  await row('PSAPAC-2').click()
  await expect(issuePage().getByRole('heading', { name: 'Review the data model' })).toBeVisible()
  await expect(inboxLink()).toHaveAccessibleName('Inbox 1 unread')
  const updated = await updatedOf('PSAPAC-2')
  await expect
    .poll(stored)
    .toEqual({ version: 1, allReadAt: '1970-01-01T00:00:00.000Z', reads: { 'PSAPAC-2': updated } })

  // Back lands on the Inbox, where the entry is read.
  await issuePage().getByRole('button', { name: 'Back to issues' }).click()
  await expect(inboxPage()).toBeVisible()
  await expect(row('PSAPAC-2')).not.toHaveAttribute('data-unread', '')
  await expect(row('PSAPAC-2')).toContainText('PSAPAC-2 · To Do')
  await expect(row('PSAPAC-4')).toHaveAttribute('data-unread', '')
})

test('Mark all read clears every mark and the badge, and keeps the entries', async () => {
  await seed()
  await open()
  await openInbox()
  await expect(inboxLink()).toHaveAccessibleName('Inbox 2 unread')

  await markAll().click()
  await expect(inboxLink()).toHaveAccessibleName('Inbox')
  await expect(markAll()).toBeDisabled()
  await expect(rows()).toHaveCount(3)
  await expect(window.locator('[data-inbox-row][data-unread]')).toHaveCount(0)
  // Focus stays in the page, on the first entry, instead of falling to the document.
  await expect(rows().first()).toBeFocused()
  // allReadAt is Jira's newest `updated` in the list, not the moment of the click.
  await expect
    .poll(stored)
    .toEqual({ version: 1, allReadAt: await updatedOf('PSAPAC-4'), reads: {} })
})

test('weighs each entry against its own mark and the watermark in inbox.json', async () => {
  await inboxChange(app, 'PSAPAC-2', 'other', [STATUS])
  await inboxChange(app, 'PSAPAC-3', 'other', [PRIORITY])
  await inboxComment(app, 'PSAPAC-4', 'other')
  const [two, three] = await Promise.all([updatedOf('PSAPAC-2'), updatedOf('PSAPAC-3')])
  // The watermark covers PSAPAC-2. PSAPAC-3's own mark is its latest change, so it is read, and
  // PSAPAC-4's own mark is older than its comment, so the comment is news.
  await writeFile(
    join(stateDir, 'inbox.json'),
    JSON.stringify({
      version: 1,
      allReadAt: two,
      reads: { 'PSAPAC-3': three, 'PSAPAC-4': three },
    }),
  )
  await open()
  await expect(inboxLink()).toHaveAccessibleName('Inbox 1 unread')
  await openInbox()
  await expect(row('PSAPAC-4')).toHaveAttribute('data-unread', '')
  await expect(row('PSAPAC-2')).not.toHaveAttribute('data-unread', '')
  await expect(row('PSAPAC-3')).not.toHaveAttribute('data-unread', '')
})

test('looks at Jira again when the window regains focus', async () => {
  await open()
  await expect(inboxLink()).toHaveAccessibleName('Inbox')
  await expect.poll(async () => (await counts(app)).inbox.searches).toBe(1)

  await inboxChange(app, 'PSAPAC-2', 'other', [STATUS])
  await refocus()
  await expect(inboxLink()).toHaveAccessibleName('Inbox 1 unread')
  await expect.poll(async () => (await counts(app)).inbox.searches).toBe(2)
})

test('looks at Jira again every five minutes', async () => {
  // The clock drives the page's timers, so the five minutes pass at once.
  await window.clock.install()
  await open()
  await expect(inboxLink()).toHaveAccessibleName('Inbox')
  await expect.poll(async () => (await counts(app)).inbox.searches).toBe(1)

  await inboxChange(app, 'PSAPAC-2', 'other', [STATUS])
  await window.clock.fastForward('05:01')
  await expect(inboxLink()).toHaveAccessibleName('Inbox 1 unread')
  await expect.poll(async () => (await counts(app)).inbox.searches).toBe(2)
})

test('does not read an issue again while it has not changed', async () => {
  await inboxChange(app, 'PSAPAC-2', 'other', [STATUS])
  await open()
  await expect(inboxLink()).toHaveAccessibleName('Inbox 1 unread')
  const reads = async () => (await counts(app)).inbox.reads.length
  const first = await reads()
  expect(first).toBe(1)

  await refocus()
  await expect.poll(async () => (await counts(app)).inbox.searches).toBe(2)
  expect(await reads()).toBe(first)
})

test('an issue watched with no change is listed read and costs no badge', async () => {
  await inboxWatch(app, 'PSAPAC-3')
  await open()
  await openInbox()
  await expect(rows()).toHaveCount(1)
  await expect(row('PSAPAC-3')).not.toHaveAttribute('data-unread', '')
  await expect(inboxLink()).toHaveAccessibleName('Inbox')
})

test('the sidebar moves between the Inbox and the issues, and a view leaves the Inbox', async () => {
  await seed()
  await open()
  await openInbox()
  await expect(inboxLink()).toHaveAttribute('aria-current', 'page')
  await expect(window.getByRole('link', { name: /^Issues/ })).not.toHaveAttribute(
    'aria-current',
    'page',
  )
  // Nothing under the Inbox takes a key.
  await expect(window.locator('#issue-list')).toHaveJSProperty('inert', true)

  await window.getByRole('link', { name: /^Issues/ }).click()
  await expect(inboxPage()).toHaveCount(0)
  await expect(window.getByRole('link', { name: /^Issues/ })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(tree()).toBeFocused()

  await openInbox()
  await window
    .getByRole('list', { name: 'Saved views' })
    .getByRole('button', { name: 'My issues', exact: true })
    .click()
  await expect(inboxPage()).toHaveCount(0)
})

test('the arrow keys work on arrival, and Esc on a page returns to the entry it opened', async () => {
  await seed()
  await open()
  await openInbox()
  // No Tab first: the first entry has focus.
  await expect(rows().nth(0)).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(rows().nth(1)).toBeFocused()
  await window.keyboard.press('ArrowUp')
  await expect(rows().nth(0)).toBeFocused()
  await window.keyboard.press('ArrowUp')
  await expect(rows().nth(0)).toBeFocused()

  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowDown')
  await expect(rows().nth(2)).toBeFocused()
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(inboxPage()).toBeVisible()
  await expect(rows().nth(2)).toBeFocused()
  await window.keyboard.press('ArrowUp')
  await expect(rows().nth(1)).toBeFocused()
})

test('the Inbox link shows the Inbox while an issue page is open', async () => {
  await seed()
  await open()
  await tree()
    .getByRole('treeitem', { name: /PSAPAC-1,/ })
    .click()
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()

  await inboxLink().click()
  await expect(issuePage()).toHaveCount(0)
  await expect(inboxPage()).toBeVisible()
  await expect(rows().nth(0)).toBeFocused()
})

test('stays inside the page in a wide font and the narrowest window', async () => {
  await seed()
  await open()
  await openInbox()
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(900, 600)
  })
  await expect
    .poll(() => window.evaluate<number>('document.documentElement.clientWidth'))
    .toBeLessThanOrEqual(900)

  const fit = await window.evaluate(() => {
    const page = document.querySelector('[aria-label="Inbox"]')
    if (page === null) return { ok: false, why: 'no page' }
    const box = page.getBoundingClientRect()
    const outside: string[] = []
    for (const element of page.querySelectorAll('button, time')) {
      const at = element.getBoundingClientRect()
      const name = element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 30)
      if (at.right > box.right + 0.5 || at.left < box.left - 0.5) outside.push(name)
    }
    const rowsOver = [...page.querySelectorAll('[data-inbox-row]')].filter(
      (r) => r.scrollWidth > r.clientWidth,
    ).length
    return {
      ok: outside.length === 0 && rowsOver === 0,
      why: `${outside.join(', ')} ${String(rowsOver)}`,
    }
  })
  expect(fit, fit.why).toMatchObject({ ok: true })
  await expect(markAll()).toBeVisible()
})
