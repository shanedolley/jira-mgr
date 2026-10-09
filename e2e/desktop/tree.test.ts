import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { counts, failDone, launch, logIn, releaseDone } from './harness.js'

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
const toggle = (name: string) => window.getByRole('button', { name, exact: true })

/** The accessible names of the rows in the DOM, top to bottom. */
const names = async (rows: Locator) =>
  Promise.all(
    Array.from(
      { length: await rows.count() },
      async (_, i) => (await rows.nth(i).getAttribute('aria-label')) ?? '',
    ),
  )
const rowNames = () => names(tree().getByRole('treeitem'))

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
}

/** Logs in and waits for the Done phase, which the fake holds until released. */
async function openWithDone() {
  await open()
  await releaseDone(app)
  await expect(item('2 done', true)).toBeVisible()
}

test('groups issues by Customer with the internal Customer last', async () => {
  await open()

  // The window mounts rows once it has measured the Tree, so wait for the last header.
  const headers = tree().locator('[role=treeitem][aria-level="1"]')
  await expect(headers).toHaveCount(3)
  expect(await names(headers)).toEqual([
    'Acme, 8 issues',
    'Beta Ltd, 5 issues',
    'Collibra (Internal team), 2 issues',
  ])
  // The Epic sits under its Customer, with the child types and the Subtask below it.
  const labels = await rowNames()
  expect(labels.indexOf('Acme, 8 issues')).toBeLessThan(
    labels.findIndex((l) => l.startsWith('PSAPAC-10, Epic')),
  )
  await expect(item(/PSAPAC-12, Subtask/)).toHaveAttribute('aria-level', '4')
  await expect(item(/PSAPAC-3, Bug/)).toHaveAttribute('aria-level', '3')
})

test("shows each row's type icon by its accessible name", async () => {
  await open()
  await expect(item(/PSAPAC-10, Epic/).getByRole('img', { name: 'Epic' })).toBeVisible()
  await expect(item(/PSAPAC-3, Bug/).getByRole('img', { name: 'Bug' })).toBeVisible()
  await expect(item(/PSAPAC-12, Subtask/).getByRole('img', { name: 'Subtask' })).toBeVisible()
})

test('shows the Tree before Done issues load, then their N done chips', async () => {
  await open()

  // The fake holds the first Done page, so no chip can exist yet.
  await expect(item('2 done', true)).toHaveCount(0)
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
  expect((await counts(app)).searches.done).toBe(0)

  await releaseDone(app)
  await expect(item('2 done', true)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toHaveCount(0)
})

test('moves an open Story under its Done Epic once Done issues load', async () => {
  await open()
  // Until Done arrives its Epic is unknown, so the Story sits under No Epic.
  await expect(item(/PSAPAC-21,/)).toBeVisible()
  await expect(item(/PSAPAC-20,/)).toHaveCount(0)

  await releaseDone(app)
  await expect(item(/PSAPAC-20, Epic, Done.*, context/)).toBeVisible()
  const labels = await rowNames()
  const epic = labels.findIndex((l) => l.startsWith('PSAPAC-20,'))
  expect(labels[epic + 1]).toMatch(/^PSAPAC-21,/)
  // The Done Epic's other Done child stays hidden under "Hide done".
  await expect(item(/PSAPAC-22,/)).toHaveCount(0)
})

test("reveals a parent's Done children from its chip", async () => {
  await openWithDone()
  await expect(item(/PSAPAC-14,/)).toHaveCount(0)

  await item('2 done', true).click()
  await expect(item(/PSAPAC-14,/)).toBeVisible()
  await expect(item(/PSAPAC-15,/)).toBeVisible()
  // One level below the chip, which sits level with the Epic's children.
  await expect(item('2 done', true)).toHaveAttribute('aria-level', '3')
  await expect(item(/PSAPAC-14,/)).toHaveAttribute('aria-level', '4')
  await expect(item('2 done', true)).toContainText('Hide 2 done')

  await item('2 done', true).click()
  await expect(item(/PSAPAC-14,/)).toHaveCount(0)
})

test("marks a Story whose Customer differs from its Epic's", async () => {
  await open()

  const flagged = item(/PSAPAC-31,/)
  await expect(flagged).toContainText('Customer')
  await expect(flagged).toHaveAttribute('aria-label', /Customer differs from Epic/)
  await expect(flagged.getByTitle("Customer: Acme. Epic's Customer: Beta Ltd.")).toBeVisible()
  await expect(item(/PSAPAC-32,/)).not.toHaveAttribute('aria-label', /differs/)

  // The Peek names both in full.
  await flagged.click()
  await expect(peek()).toContainText("Epic's Customer: Beta Ltd.")
})

test('collapses and expands groups by click, by arrow keys and with Collapse all', async () => {
  await open()
  const epic = item(/PSAPAC-10,/)
  await expect(epic).toHaveAttribute('aria-expanded', 'true')

  // By click on the chevron.
  await epic.locator('[data-chevron]').click()
  await expect(epic).toHaveAttribute('aria-expanded', 'false')
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)
  await epic.locator('[data-chevron]').click()
  await expect(item(/PSAPAC-2,/)).toBeVisible()

  // By arrow keys: the click made the Epic active.
  await window.keyboard.press('ArrowLeft')
  await expect(epic).toHaveAttribute('aria-expanded', 'false')
  await window.keyboard.press('ArrowRight')
  await expect(epic).toHaveAttribute('aria-expanded', 'true')
  await window.keyboard.press('ArrowRight')
  await expect(tree()).toHaveAttribute('aria-activedescendant', /PSAPAC-/)

  // By the Groups menu.
  await window.getByRole('button', { name: 'Groups' }).click()
  await window.getByRole('button', { name: 'Collapse all' }).click()
  await expect(tree().locator('[role=treeitem]')).toHaveCount(3)
  await expect(tree()).toBeFocused()
  await window.getByRole('button', { name: 'Groups' }).click()
  await window.getByRole('button', { name: 'Expand all' }).click()
  await expect(item(/PSAPAC-2,/)).toBeVisible()
})

test('moves with J and K and peeks with the space bar', async () => {
  await open()
  const active = (id: string) => expect(tree()).toHaveAttribute('aria-activedescendant', id)
  await expect(tree()).toBeFocused()

  await active('tree-row-c:1')
  await window.keyboard.press('j')
  await active('tree-row-i:PSAPAC-10')
  // Children run by status, then key descending: To Do first, so PSAPAC-11 leads.
  await window.keyboard.press('J')
  await active('tree-row-i:PSAPAC-11')
  await window.keyboard.press('k')
  await active('tree-row-i:PSAPAC-10')

  await expect(peek()).toHaveCount(0)
  await window.keyboard.press(' ')
  await expect(peek()).toBeVisible()
  await expect(peek().getByRole('heading', { name: 'Customer onboarding' })).toBeVisible()
  // The Peek follows the active row, and focus stays on the Tree.
  await window.keyboard.press('j')
  await expect(peek().getByRole('heading', { name: 'Draft the runbook' })).toBeVisible()
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-11,/)).toHaveAttribute('aria-selected', 'true')

  await window.keyboard.press(' ')
  await expect(peek()).toHaveCount(0)
  await window.keyboard.press(' ')
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('Esc clears the text filter, then returns focus to the Tree', async () => {
  await open()
  const filter = window.getByLabel('Filter by key or summary')

  await filter.fill('export')
  await expect(item(/PSAPAC-3,/)).toBeVisible()
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)
  // The match keeps its Epic as a dimmed context row.
  await expect(item(/PSAPAC-10,.*context/)).toBeVisible()

  await filter.press('Escape')
  await expect(filter).toHaveValue('')
  await expect(item(/PSAPAC-2,/)).toBeVisible()
  await expect(filter).toBeFocused()

  await filter.press('Escape')
  await expect(tree()).toBeFocused()
})

test('turning Hide done off shows the Done Epic with its subtree', async () => {
  await openWithDone()
  await expect(toggle('Hide done')).toHaveAttribute('aria-pressed', 'true')
  await expect(item(/PSAPAC-22,/)).toHaveCount(0)

  await toggle('Hide done').click()

  await expect(toggle('Hide done')).toHaveAttribute('aria-pressed', 'false')
  await expect(item(/PSAPAC-20, Epic, Done/)).toBeVisible()
  await expect(item(/PSAPAC-20,.*context/)).toHaveCount(0)
  await expect(item(/PSAPAC-22,/)).toBeVisible()
  await expect(tree()).toBeFocused()
})

test('Assignee: me keeps my issues with their ancestors dimmed', async () => {
  await openWithDone()

  await toggle('Assignee: me').click()

  await expect(toggle('Assignee: me')).toHaveAttribute('aria-pressed', 'true')
  await expect(item(/PSAPAC-3,/)).toHaveCount(0)
  // Mine, not dimmed.
  await expect(item(/PSAPAC-2,/)).toBeVisible()
  await expect(item(/PSAPAC-2,/)).not.toHaveAttribute('aria-label', /context/)
  // Their ancestors, dimmed: another person's Story above my Subtask, and a Done Epic.
  await expect(item(/PSAPAC-11,.*context/)).toBeVisible()
  await expect(item(/PSAPAC-10,.*context/)).toBeVisible()
  await expect(item(/PSAPAC-20, Epic, Done.*context/)).toBeVisible()
})

test('turning Hide empty Customers off shows the Customer with no issues', async () => {
  await open()
  await expect(item(/^Zeta Corp/)).toHaveCount(0)

  await toggle('Hide empty Customers').click()

  await expect(toggle('Hide empty Customers')).toHaveAttribute('aria-pressed', 'false')
  const empty = item('Zeta Corp, 0 issues', true)
  await expect(empty).toBeVisible()
  await expect(empty).toContainText('No issues')
  await expect(empty).not.toHaveAttribute('aria-expanded', /.*/)
})

test('remembers the toggles across a relaunch', async () => {
  await open()
  await toggle('Hide done').click()
  await toggle('Hide empty Customers').click()
  await expect(toggle('Hide done')).toHaveAttribute('aria-pressed', 'false')
  // The write lands in the settings file under toggles.
  await expect
    .poll(async () => {
      const settings = JSON.parse(await readFile(join(stateDir, 'settings.json'), 'utf8')) as {
        toggles?: unknown
      }
      return settings.toggles
    })
    .toEqual({ hideDone: false, assigneeMe: false, hideEmptyCustomers: false })

  // The fake Keychain lives in the process, so the relaunch logs in again.
  await app.close()
  ;({ app, window } = await launch(stateDir))
  await logIn(window)

  await expect(toggle('Hide done')).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle('Assignee: me')).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle('Hide empty Customers')).toHaveAttribute('aria-pressed', 'false')
})

test('filters by status and by text, keeping ancestors as context', async () => {
  await open()

  await window.getByRole('button', { name: 'Filter', exact: true }).click()
  await window.getByText('Status', { exact: true }).click()
  await window.getByRole('checkbox', { name: 'In Progress' }).check()
  await window.keyboard.press('Escape')

  await expect(window.getByRole('list', { name: 'Active filters' })).toContainText(
    'Status: In Progress',
  )
  await expect(item(/PSAPAC-1,/)).not.toHaveAttribute('aria-label', /context/)
  await expect(item(/PSAPAC-10,.*context/)).toBeVisible()
  await expect(item(/PSAPAC-3,/)).toHaveCount(0)
  await expect(tree()).toBeFocused()

  await window.getByLabel('Filter by key or summary').fill('dashboards')
  await expect(item(/PSAPAC-4,/)).toBeVisible()
  await expect(item(/PSAPAC-1,/)).toHaveCount(0)

  await window.getByRole('button', { name: 'Remove Status filter' }).click()
  await expect(window.getByRole('list', { name: 'Active filters' })).not.toContainText('Status:')
  await window.getByLabel('Filter by key or summary').fill('')
  await expect(item(/PSAPAC-3,/)).toBeVisible()
})

test('shows No issues match with Clear filters when nothing matches', async () => {
  await open()

  await window.getByLabel('Filter by key or summary').fill('zzzz-no-such-issue')

  await expect(window.getByText('No issues match')).toBeVisible()
  await expect(window.getByText('Hide done and Hide empty Customers are on.')).toBeVisible()
  await window.getByRole('button', { name: 'Clear filters' }).click()
  await expect(window.getByText('No issues match')).toHaveCount(0)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByLabel('Filter by key or summary')).toHaveValue('')
  await expect(tree()).toBeFocused()
})

test('keeps the Tree and offers Retry when the Done load fails', async () => {
  await open()
  await failDone(app)
  await releaseDone(app)

  const banner = window.getByRole('alert')
  await expect(banner).toContainText('Could not load Done issues')
  await expect(banner).toContainText('chips are unavailable')
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(item('2 done', true)).toHaveCount(0)

  await banner.getByRole('button', { name: 'Retry' }).click()
  await expect(item('2 done', true)).toBeVisible()
  await expect(window.getByRole('alert')).toHaveCount(0)
})

test('renders a bounded number of rows for 2000 issues and reaches the last with End', async () => {
  // A relaunch with 2000 more open Stories. They are open, so default toggles show them all.
  await app.close()
  ;({ app, window } = await launch(stateDir, { JM_E2E_BULK: '2000' }))
  await logIn(window)
  await expect(item(/PSAPAC-900,/)).toBeVisible()

  // Acme 9 rows, Beta 7, and the internal Customer: its header, the bulk Epic with its 2000
  // Stories, then Epic PSAPAC-50 and its Story.
  const rowCount = 9 + 7 + 2004
  const canvas = await tree().locator(':scope > div').boundingBox()
  expect(Math.abs((canvas?.height ?? 0) - rowCount * 32)).toBeLessThanOrEqual(32)
  expect(await tree().getByRole('treeitem').count()).toBeLessThan(100)

  await window.keyboard.press('End')
  const last = item(/PSAPAC-51,/)
  await expect(last).toBeVisible()
  await expect(last).toHaveAttribute('data-active', 'true')
  expect(await tree().getByRole('treeitem').count()).toBeLessThan(100)

  await window.keyboard.press('Home')
  await expect(item(/^Acme, /)).toBeVisible()
})

test('keeps the rows in view steady when Done issues load above them', async () => {
  await app.close()
  ;({ app, window } = await launch(stateDir, { JM_E2E_BULK: '2000' }))
  await logIn(window)
  await expect(item(/PSAPAC-900,/)).toBeVisible()
  await window.keyboard.press('End')
  const last = item(/PSAPAC-51,/)
  await expect(last).toHaveAttribute('data-active', 'true')
  const before = await last.boundingBox()

  // The first Done page lands: an Acme chip and a Beta Epic row appear far above the viewport.
  await releaseDone(app)
  await expect(window.getByText('Loading Done issues:')).toHaveCount(0)
  await expect(item(/PSAPAC-51,/)).toBeVisible()

  const after = await last.boundingBox()
  expect(before).not.toBeNull()
  expect(after?.y).toBeCloseTo(before?.y ?? -1, 0)
})

test('keeps the Peek on an issue a filter removed, labelled, until the active row moves', async () => {
  await open()
  await item(/PSAPAC-3,/).click()
  await expect(peek().getByRole('heading', { name: 'Fix the export timeout' })).toBeVisible()

  await window.getByLabel('Filter by key or summary').fill('dashboards')
  await expect(item(/PSAPAC-3,/)).toHaveCount(0)
  await expect(peek().getByRole('heading', { name: 'Fix the export timeout' })).toBeVisible()
  await expect(peek()).toContainText('No longer in this view')

  await item(/PSAPAC-4,/).click()
  await expect(peek().getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
  await expect(peek()).not.toContainText('No longer in this view')
})

test('keeps the Peek on its issue while the summary is being edited', async () => {
  await open()
  await item(/PSAPAC-11,/).click()
  await peek().getByRole('button', { name: 'Edit summary' }).click()
  await peek().getByLabel('Summary').fill('Draft the runbook, edited')

  // The active row moves, but the Peek stays with the unsaved edit.
  await item(/PSAPAC-2,/).click()
  await expect(item(/PSAPAC-2,/)).toHaveAttribute('data-active', 'true')
  await expect(peek().getByLabel('Summary')).toHaveValue('Draft the runbook, edited')

  // Esc cancels the edit and puts focus on the Tree, and the Peek catches up.
  await peek().getByLabel('Summary').press('Escape')
  await expect(tree()).toBeFocused()
  await expect(peek().getByRole('heading', { name: 'Review the data model' })).toBeVisible()
  expect((await counts(app)).edits).toBe(0)
})

test('reports each page of a load to the window that asked', async () => {
  await app.close()
  ;({ app, window } = await launch(stateDir, { JM_E2E_BULK: '2000' }))
  await window.evaluate('window.jm.onIssuesProgress((p) => { (window.__progress ??= []).push(p) })')
  await logIn(window)
  await expect(item(/PSAPAC-900,/)).toBeVisible()

  const progress =
    await window.evaluate<{ phase: string; loadId: number; loaded: number }[]>('window.__progress')
  // 100 issues a page: one event per page, all for one load of one phase, counting up.
  expect(progress.length).toBeGreaterThanOrEqual(20)
  expect(new Set(progress.map((p) => `${p.phase}:${String(p.loadId)}`)).size).toBe(1)
  expect(progress.map((p) => p.loaded)).toEqual(
    [...progress.map((p) => p.loaded)].sort((a, b) => a - b),
  )
  expect(progress.at(-1)?.loaded).toBeGreaterThan(2000)
})

test('shows No issues match for a filter that matches nothing, with empty Customers shown', async () => {
  await open()
  await toggle('Hide empty Customers').click()
  await expect(item('Zeta Corp, 0 issues', true)).toBeVisible()

  await window.getByLabel('Filter by key or summary').fill('zzzz-no-such-issue')

  // An empty Customer header must not stand in for the empty state.
  await expect(window.getByText('No issues match')).toBeVisible()
  await expect(window.getByText('Hide done is on.')).toBeVisible()
  await window.getByRole('button', { name: 'Clear filters' }).click()
  await expect(window.getByText('No issues match')).toHaveCount(0)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
})

test('refetches Done issues only when they are stale, not on every focus', async () => {
  await openWithDone()
  const focusCycle = () =>
    app.evaluate(({ BrowserWindow }) => {
      const [first] = BrowserWindow.getAllWindows()
      first?.emit('blur')
      first?.emit('focus')
    })
  const before = await counts(app)

  // Two cycles, so a Done refetch started by the first has had time to be served.
  await focusCycle()
  await expect
    .poll(async () => (await counts(app)).searches.unresolved)
    .toBeGreaterThan(before.searches.unresolved)
  const between = (await counts(app)).searches.unresolved
  await focusCycle()
  await expect.poll(async () => (await counts(app)).searches.unresolved).toBeGreaterThan(between)

  expect((await counts(app)).searches.done).toBe(before.searches.done)
})

test('marks aria-selected on the peeked issue only, whichever row is active', async () => {
  await open()
  const selected = tree().locator('[aria-selected]')
  await expect(selected).toHaveCount(0)

  await window.keyboard.press('j')
  await window.keyboard.press(' ')
  await expect(peek()).toBeVisible()
  await expect(selected).toHaveCount(1)
  await expect(item(/PSAPAC-10,/)).toHaveAttribute('aria-selected', 'true')

  // A header is active now; the Peek keeps its issue, and so does the mark.
  await window.keyboard.press('k')
  await expect(tree()).toHaveAttribute('aria-activedescendant', 'tree-row-c:1')
  await expect(selected).toHaveCount(1)
  await expect(item(/PSAPAC-10,/)).toHaveAttribute('aria-selected', 'true')

  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(selected).toHaveCount(0)
})

test('asks for Done issues only after the unresolved phase has loaded', async () => {
  await app.close()
  ;({ app, window } = await launch(stateDir, { JM_E2E_BULK: '2000' }))
  await logIn(window)
  await expect(item(/PSAPAC-900,/)).toBeVisible()
  // 21 unresolved pages take a while: a Done request sent at mount would have arrived early.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()

  expect((await counts(app)).doneEarly).toBe(0)
})

test('prevents the default of the keys it handles and of no other', async () => {
  await open()
  // Window-level, so it sees each event after the Tree's own handler has run. Windows open
  // without focus under test, so a browser default such as scrolling cannot be observed itself.
  await window.evaluate(
    'window.addEventListener("keydown", (e) => { (window.__keys ??= []).push([e.key, e.defaultPrevented]) })',
  )

  for (const key of ['j', ' ', 'PageDown', 'ArrowRight', 'Home', 'x', 'Meta+k']) {
    await window.keyboard.press(key)
  }

  const seen = await window.evaluate<[string, boolean][]>('window.__keys')
  // Handled keys, Space and the page keys included, never reach the container's own scrolling.
  // The unhandled `x` stays available to the system. Cmd+K is the palette's (D7), so it is handled.
  expect(
    seen.filter(([key]) => ['j', ' ', 'PageDown', 'ArrowRight', 'Home'].includes(key)),
  ).toEqual([
    ['j', true],
    [' ', true],
    ['PageDown', true],
    ['ArrowRight', true],
    ['Home', true],
  ])
  expect(seen.filter(([key]) => key === 'x' || key === 'k')).toEqual([
    ['x', false],
    ['k', true],
  ])
})
