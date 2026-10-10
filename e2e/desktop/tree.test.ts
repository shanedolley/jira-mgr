import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { counts, failDone, launch, logIn, readState, releaseDone } from './harness.js'

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
  await expect(flagged).toContainText('Customer differs')
  await expect(flagged).toHaveAttribute('aria-label', /Customer differs from Epic/)
  await expect(flagged.getByTitle("Customer: Acme. Epic's Customer: Beta Ltd.")).toBeVisible()
  await expect(item(/PSAPAC-32,/)).not.toHaveAttribute('aria-label', /differs/)

  // The Peek names both in full.
  await flagged.click()
  await expect(peek()).toContainText("Epic's Customer: Beta Ltd.")
})

test('draws To Do, In Progress and Done as three distinct shapes', async () => {
  await openWithDone()
  await toggle('Hide done').click()
  await expect(item(/PSAPAC-22,/)).toBeVisible()

  const glyph = (row: RegExp) => item(row).locator('[data-glyph=status]')
  const todo = glyph(/PSAPAC-10,/)
  const doing = glyph(/PSAPAC-4,/)
  const done = glyph(/PSAPAC-22,/)
  await expect(todo).toHaveAttribute('aria-label', 'To Do')
  await expect(doing).toHaveAttribute('aria-label', 'In Progress')
  await expect(done).toHaveAttribute('aria-label', 'Done')

  // An empty ring, a ring with its right half filled, a solid circle with a check.
  await expect(todo).toHaveAttribute('data-shape', 'ring')
  await expect(doing).toHaveAttribute('data-shape', 'half')
  await expect(done).toHaveAttribute('data-shape', 'check')
  await expect(todo.locator('path')).toHaveCount(0)
  await expect(doing.locator('path')).toHaveCount(1)
  await expect(done.locator('circle[fill="none"]')).toHaveCount(0)

  // With the three status colours set to one, only shape can tell them apart.
  await window.evaluate(() => {
    for (const token of ['new', 'doing', 'done']) {
      document.documentElement.style.setProperty(`--status-${token}`, 'black')
    }
  })
  const [a, b, c] = await Promise.all([todo, doing, done].map((g) => g.screenshot()))
  expect(a?.equals(b ?? Buffer.alloc(0))).toBe(false)
  expect(b?.equals(c ?? Buffer.alloc(0))).toBe(false)
  expect(a?.equals(c ?? Buffer.alloc(0))).toBe(false)
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

/** Name, left edge and width of each control in the toolbar row, left to right. */
const barBoxes = () =>
  window
    .getByLabel('Filter by key or summary')
    .locator('xpath=..')
    .locator('> button, > input')
    .evaluateAll((controls) =>
      controls.map((control) => {
        const box = control.getBoundingClientRect()
        const name = control.getAttribute('aria-label') ?? control.textContent.trim()
        return { name, x: box.x, width: box.width }
      }),
    )

test('toggling a toolbar button moves no neighbour', async () => {
  await openWithDone()
  const before = await barBoxes()
  expect(before.map((box) => box.name)).toEqual([
    'Hide done',
    'Assignee: me',
    'Hide empty Customers',
    'Filter',
    'Groups',
    'Filter by key or summary',
  ])

  for (const name of ['Hide done', 'Assignee: me', 'Hide empty Customers']) {
    const pressed = await toggle(name).getAttribute('aria-pressed')
    await toggle(name).click()
    await expect(toggle(name)).toHaveAttribute(
      'aria-pressed',
      pressed === 'true' ? 'false' : 'true',
    )
    expect(await barBoxes(), `after toggling ${name}`).toEqual(before)
    await toggle(name).click()
  }
})

test('the Filter and Groups buttons show a chevron and the Filter fields show an icon and a chevron', async () => {
  await open()
  await expect(toggle('Filter').locator('svg')).toHaveCount(1)
  await expect(toggle('Groups').locator('svg')).toHaveCount(1)
  await expect(toggle('Hide done').locator('svg')).toHaveCount(1)

  await toggle('Filter').click()
  const fields = window.locator('#filter-menu summary')
  await expect(fields).toHaveCount(5)
  for (const field of await fields.all()) {
    await expect(field.locator('svg')).toHaveCount(2)
    expect((await field.boundingBox())?.height).toBe(32)
  }
})

/** The colour the renderer paints for a CSS value, such as `var(--type-bug)`. */
const painted = (value: string) =>
  window.evaluate((css) => {
    const probe = document.createElement('span')
    probe.style.color = css
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  }, value)

const iconColour = (row: RegExp, type: string) =>
  item(row)
    .getByRole('img', { name: type })
    .evaluate((icon) => getComputedStyle(icon).color)

test('type icons are grey at rest except Bug, and show their type colour on hover', async () => {
  await openWithDone()
  const types: [RegExp, string, string][] = [
    [/PSAPAC-10, Epic/, 'Epic', '--type-epic'],
    [/PSAPAC-4, Story/, 'Story', '--type-story'],
    [/PSAPAC-3, Bug/, 'Bug', '--type-bug'],
    [/PSAPAC-13, Task/, 'Task', '--type-task'],
    [/PSAPAC-12, Subtask/, 'Subtask', '--type-task'],
  ]

  // Park the pointer away from every row.
  await window.mouse.move(0, 0)
  const rest = await painted('var(--type-rest)')
  for (const [row, type, token] of types) {
    expect(await iconColour(row, type), `${type} at rest`).toBe(
      type === 'Bug' ? await painted(`var(${token})`) : rest,
    )
  }

  for (const [row, type, token] of types) {
    await item(row).hover()
    expect(await iconColour(row, type), `${type} on hover`).toBe(await painted(`var(${token})`))
  }
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
    .poll(async () => (await readState<{ toggles?: unknown }>(stateDir, 'settings.json'))?.toggles)
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

  await expect(window.getByText('No issues match “zzzz-no-such-issue”')).toBeVisible()
  await expect(window.getByText('Hide done and Hide empty Customers are also on.')).toBeVisible()
  // One button clears: the chip row's own Clear steps aside.
  await expect(window.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0)
  await window.getByRole('button', { name: 'Clear filters' }).click()
  await expect(window.getByText('No issues match')).toHaveCount(0)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByLabel('Filter by key or summary')).toHaveValue('')
  await expect(tree()).toBeFocused()
})

test('names the text and the chips that match nothing', async () => {
  await open()
  await window.getByRole('button', { name: 'Filter', exact: true }).click()
  await window.getByText('Status', { exact: true }).click()
  await window.getByRole('checkbox', { name: 'In Progress' }).check()
  await window.keyboard.press('Escape')
  await window.getByLabel('Filter by key or summary').fill('zzzzqq')

  await expect(window.getByText('No issues match “zzzzqq” with Status: In Progress')).toBeVisible()
  await expect(window.getByText('Hide done and Hide empty Customers are also on.')).toBeVisible()
  await expect(window.getByRole('button', { name: 'Clear filters' })).toHaveCount(1)

  await window.getByRole('button', { name: 'Clear filters' }).click()
  await expect(window.getByRole('list', { name: 'Active filters' })).toHaveCount(0)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
})

test('keeps the Tree and offers Retry when the Done load fails', async () => {
  await open()
  await failDone(app)
  await releaseDone(app)

  const banner = window.getByRole('alert')
  await expect(banner).toContainText('Could not load Done issues. Done counts are hidden.')
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

test('saves an unsaved summary when another row is clicked, and cancels one on Esc', async () => {
  await open()
  await item(/PSAPAC-11,/).click()
  await peek().getByRole('button', { name: 'Draft the runbook' }).click()
  await peek().getByLabel('Summary').fill('Draft the runbook, edited')

  // The click takes focus from the field, which saves, and the Peek follows the active row.
  await item(/PSAPAC-2,/).click()
  await expect(item(/PSAPAC-2,/)).toHaveAttribute('data-active', 'true')
  await expect(peek().getByRole('heading', { name: 'Review the data model' })).toBeVisible()
  await expect(item(/Draft the runbook, edited/)).toBeVisible()
  expect((await counts(app)).edits).toBe(1)

  // Esc cancels the edit and puts focus on the Tree.
  await peek().getByRole('button', { name: 'Review the data model' }).click()
  await peek().getByLabel('Summary').fill('Never saved')
  await peek().getByLabel('Summary').press('Escape')
  await expect(tree()).toBeFocused()
  await expect(peek().getByRole('heading', { name: 'Review the data model' })).toBeVisible()
  expect((await counts(app)).edits).toBe(1)
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
  await expect(window.getByText('Hide done is also on.')).toBeVisible()
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

/** What paints a row's state: its fill and weight, and every border, ring or outline that could mark it. */
const paint = (row: Locator) =>
  row.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      fill: s.backgroundColor,
      weight: s.fontWeight,
      shadow: s.boxShadow,
      outline: s.outlineStyle,
      borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
      radius: s.borderTopLeftRadius,
      inset: [s.left, s.right],
    }
  })

test('marks the active and the open row by distinct fills, with no ring, edge or bar', async () => {
  await open()
  await window.keyboard.press('j')
  await window.keyboard.press(' ')
  await expect(peek()).toBeVisible()
  const row = item(/PSAPAC-10,/)

  // Active and open at once: the brightest fill, in medium weight.
  await expect(tree()).toBeFocused()
  const both = await paint(row)
  // Open only: the active row moved to the header above.
  await window.keyboard.press('k')
  await expect(tree()).toHaveAttribute('aria-activedescendant', 'tree-row-c:1')
  const peeked = await paint(row)
  // Active only: the Peek closed, and the active row came back.
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await window.keyboard.press('j')
  await expect(row).toHaveAttribute('data-active', 'true')
  const focus = await paint(row)
  const rest = await paint(item(/PSAPAC-3,/))

  expect(new Set([both.fill, peeked.fill, focus.fill, rest.fill]).size).toBe(4)
  expect(peeked.weight).toBe('500')
  expect(both.weight).toBe('500')
  for (const state of [both, peeked, focus, rest]) {
    expect(state.shadow).toBe('none')
    expect(state.outline).toBe('none')
    expect(state.borders).toEqual(['0px', '0px', '0px', '0px'])
    expect(state.radius).toBe('8px')
    expect(state.inset).toEqual(['8px', '8px'])
  }
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
