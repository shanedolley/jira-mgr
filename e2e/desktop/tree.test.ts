import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import {
  counts,
  failDone,
  launch,
  logIn,
  moveIssue,
  readState,
  releaseDone,
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
  await expect(window.getByText('Loading Done issues:')).toHaveCount(0)
}

/** As `openWithDone`, then turns "Hide done" off, which is when the N done chips show. */
async function openWithChips() {
  await openWithDone()
  await toggle('Hide done').click()
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
  // The Epic sits under its Customer, with the child types below it.
  const labels = await rowNames()
  expect(labels.indexOf('Acme, 8 issues')).toBeLessThan(
    labels.findIndex((l) => l.startsWith('PSAPAC-10, Epic')),
  )
  await expect(item(/PSAPAC-3, Bug/)).toHaveAttribute('aria-level', '3')
  // The Subtask sits one level below its Story, and shows from the Everything level.
  await showEverything(window)
  await expect(item(/PSAPAC-12, Subtask/)).toHaveAttribute('aria-level', '4')
})

test('opens at the Stories level on a first launch', async () => {
  await open()

  // Customers, Epics and Stories open; each Story is closed, so no Subtask shows.
  await expect(item(/^Acme, /)).toHaveAttribute('aria-expanded', 'true')
  await expect(item(/PSAPAC-10, Epic/)).toHaveAttribute('aria-expanded', 'true')
  await expect(item(/PSAPAC-11,/)).toHaveAttribute('aria-expanded', 'false')
  await expect(item(/PSAPAC-12,/)).toHaveCount(0)
  await window.getByRole('button', { name: 'Groups', exact: true }).click()
  await expect(window.getByRole('button', { name: 'Stories', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test("shows each row's type icon by its accessible name", async () => {
  await open()
  await showEverything(window)
  await expect(item(/PSAPAC-10, Epic/).getByRole('img', { name: 'Epic' })).toBeVisible()
  await expect(item(/PSAPAC-3, Bug/).getByRole('img', { name: 'Bug' })).toBeVisible()
  await expect(item(/PSAPAC-12, Subtask/).getByRole('img', { name: 'Subtask' })).toBeVisible()
})

test('shows the Tree before Done issues load, then their N done chips once Hide done is off', async () => {
  await open()

  // The fake holds the first Done page, so no chip can exist yet.
  await expect(item('2 done', true)).toHaveCount(0)
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
  expect((await counts(app)).searches.done).toBe(0)

  await releaseDone(app)
  await expect(window.getByText('Loading Done issues:')).toHaveCount(0)
  // "Hide done" is on, so the loaded Done issues add no chip and no row.
  await expect(item(/^\d+ done$/)).toHaveCount(0)
  await expect(item(/PSAPAC-14,/)).toHaveCount(0)
  await expect(item(/PSAPAC-22,/)).toHaveCount(0)

  await toggle('Hide done').click()
  await expect(item('2 done', true)).toBeVisible()
})

test('keeps an open Story under No Epic while its Epic is Done and Hide done is on', async () => {
  await open()
  await expect(item(/PSAPAC-21,/)).toBeVisible()
  await expect(item(/PSAPAC-20,/)).toHaveCount(0)
  // A Story's progress pill grows when Done loads, so compare the keys.
  const keysOf = async () => (await rowNames()).map((l) => l.split(',')[0])
  const before = await keysOf()

  await releaseDone(app)
  await expect(window.getByText('Loading Done issues:')).toHaveCount(0)
  // No Done Epic context row appears, and the Story does not move.
  await expect(item(/PSAPAC-20,/)).toHaveCount(0)
  expect(await keysOf()).toEqual(before)

  // With "Hide done" off, the Done Epic shows, not as context, with the Story below it.
  await toggle('Hide done').click()
  await expect(item(/PSAPAC-20, Epic, Done/)).toBeVisible()
  await expect(item(/PSAPAC-20,.*context/)).toHaveCount(0)
  const labels = await rowNames()
  const epic = labels.findIndex((l) => l.startsWith('PSAPAC-20,'))
  // Its children run by key, so the Done Story PSAPAC-22 comes before the open PSAPAC-21.
  expect(labels[epic + 1]).toMatch(/^PSAPAC-22,/)
  expect(labels[epic + 2]).toMatch(/^PSAPAC-21,/)
})

test("reveals a parent's Done children from its chip", async () => {
  await openWithChips()
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

test("collapses and expands groups by click, by arrow keys and with the Groups menu's levels", async () => {
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

  // By the Groups menu, one level at a time.
  const pick = async (level: string) => {
    await window.getByRole('button', { name: 'Groups', exact: true }).click()
    await window.getByRole('button', { name: level, exact: true }).click()
    await expect(tree()).toBeFocused()
  }
  await pick('Customers')
  await expect(tree().locator('[role=treeitem]')).toHaveCount(3)
  // The Customer header of the active row becomes the active row.
  await expect(tree()).toHaveAttribute('aria-activedescendant', 'tree-row-c:1')
  await pick('Epics')
  await expect(item(/PSAPAC-10, Epic/)).toHaveAttribute('aria-expanded', 'false')
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)
  await pick('Stories')
  await expect(item(/PSAPAC-2,/)).toBeVisible()
  await expect(item(/PSAPAC-11,/)).toHaveAttribute('aria-expanded', 'false')
  await expect(item(/PSAPAC-12,/)).toHaveCount(0)
  await pick('Everything')
  await expect(item(/PSAPAC-12,/)).toBeVisible()

  // Shift+Left and Shift+Right set the Customers and Everything levels.
  await window.keyboard.press('Shift+ArrowLeft')
  await expect(tree().locator('[role=treeitem]')).toHaveCount(3)
  await window.keyboard.press('Shift+ArrowRight')
  await expect(item(/PSAPAC-12,/)).toBeVisible()

  // A row opened by hand shows its children at the Stories level, where the level closes it.
  await pick('Stories')
  await item(/PSAPAC-11,/)
    .locator('[data-chevron]')
    .click()
  await expect(item(/PSAPAC-12,/)).toBeVisible()
})

const filterBox = () => window.getByLabel('Filter by key or summary')
const pickLevel = async (level: string) => {
  await window.getByRole('button', { name: 'Groups', exact: true }).click()
  await window.getByRole('button', { name: level, exact: true }).click()
}

test('a filter keeps its matches under the default level, and clearing it restores the level', async () => {
  await open()

  await filterBox().fill('PSAPAC-12')
  // The Story is context for its Subtask, so it stays open at the Stories level.
  await expect(item(/PSAPAC-12,/)).toBeVisible()
  await expect(item(/PSAPAC-11,.*context/)).toHaveAttribute('aria-expanded', 'true')

  await filterBox().fill('')
  await expect(item(/PSAPAC-11,/)).toHaveAttribute('aria-expanded', 'false')
  await expect(item(/PSAPAC-12,/)).toHaveCount(0)
})

test('a filter opens a Story whose Subtask also matches, and a hand toggle still closes it', async () => {
  await open()

  // The key text matches the Story and its Subtask, so neither is context.
  await filterBox().fill('PSAPAC-1')
  await expect(item(/PSAPAC-12,/)).toBeVisible()
  await expect(item(/PSAPAC-11,/)).not.toHaveAttribute('aria-label', /context/)
  // A hand toggle wins over the filter for the session.
  await item(/PSAPAC-11,/)
    .locator('[data-chevron]')
    .click()
  await expect(item(/PSAPAC-12,/)).toHaveCount(0)
  // Clearing the filter returns to the level, with the Story still closed by hand.
  await filterBox().fill('')
  await expect(item(/PSAPAC-12,/)).toHaveCount(0)
  await item(/PSAPAC-11,/)
    .locator('[data-chevron]')
    .click()
  await expect(item(/PSAPAC-12,/)).toBeVisible()
})

test('a filter at the Epics level still shows a match with no Epic', async () => {
  await open()
  await pickLevel('Epics')

  // PSAPAC-40 has no Epic, so it sits under Beta's No Epic header, which the level would close.
  await filterBox().fill('Tidy the wiki')
  await expect(item(/PSAPAC-40,/)).toBeVisible()

  await filterBox().fill('')
  await expect(item(/PSAPAC-40,/)).toHaveCount(0)
})

test('closing and reopening a Story under a filter leaves it following the level once the filter clears', async () => {
  await open()

  await filterBox().fill('PSAPAC-1')
  await expect(item(/PSAPAC-12,/)).toBeVisible()
  const story = item(/PSAPAC-11,/)
  await story.locator('[data-chevron]').click()
  await expect(story).toHaveAttribute('aria-expanded', 'false')
  await story.locator('[data-chevron]').click()
  await expect(story).toHaveAttribute('aria-expanded', 'true')

  await filterBox().fill('')
  await expect(item(/PSAPAC-11,/)).toHaveAttribute('aria-expanded', 'false')
  await expect(item(/PSAPAC-12,/)).toHaveCount(0)
})

test('a toggle by hand survives a filter and the chevrons used under it', async () => {
  await open()
  await item(/PSAPAC-11,/)
    .locator('[data-chevron]')
    .click()
  await expect(item(/PSAPAC-12,/)).toBeVisible()

  // PSAPAC-11 has no match here, so the groups do not hold it while the chevrons are used.
  await filterBox().fill('data model')
  const epic = item(/PSAPAC-10,/)
  await expect(epic).toBeVisible()
  await expect(item(/PSAPAC-11,/)).toHaveCount(0)
  await epic.locator('[data-chevron]').click()
  await expect(epic).toHaveAttribute('aria-expanded', 'false')
  await epic.locator('[data-chevron]').click()
  await expect(epic).toHaveAttribute('aria-expanded', 'true')

  await filterBox().fill('')
  await expect(item(/PSAPAC-12,/)).toBeVisible()
})

test('a level picked with no row shown is kept and stored', async () => {
  await open()

  await filterBox().fill('zzzz-no-such-issue')
  await expect(window.getByText('No issues match')).toBeVisible()
  await pickLevel('Everything')
  await filterBox().fill('')

  await expect(item(/PSAPAC-12,/)).toBeVisible()
  await expect
    .poll(
      async () => (await readState<{ treeLevel?: unknown }>(stateDir, 'settings.json'))?.treeLevel,
    )
    .toBe('all')
})

test('picking a level hides the revealed chips unless it is Everything', async () => {
  await openWithChips()
  await item('2 done', true).click()
  await expect(item(/PSAPAC-14,/)).toBeVisible()

  await pickLevel('Epics')
  await expect(item(/PSAPAC-10, Epic/)).toHaveAttribute('aria-expanded', 'false')
  await pickLevel('Stories')
  // The Epic's chip comes back hidden.
  await expect(item('2 done', true)).toContainText('2 done')
  await expect(item('2 done', true)).not.toContainText('Hide')
  await expect(item(/PSAPAC-14,/)).toHaveCount(0)

  await item('2 done', true).click()
  await expect(item(/PSAPAC-14,/)).toBeVisible()
  await pickLevel('Everything')
  await expect(item(/PSAPAC-14,/)).toBeVisible()
})

test('keeps a row opened by hand when Done issues load, and new rows follow the level', async () => {
  await open()
  await item(/PSAPAC-11,/)
    .locator('[data-chevron]')
    .click()
  await expect(item(/PSAPAC-12,/)).toBeVisible()

  await releaseDone(app)
  await expect(window.getByText('Loading Done issues:')).toHaveCount(0)
  await toggle('Hide done').click()

  // The Done Epic that appears follows the level: open, with its Story showing.
  await expect(item(/PSAPAC-20, Epic, Done/)).toHaveAttribute('aria-expanded', 'true')
  await expect(item(/PSAPAC-22,/)).toBeVisible()
  // The Story opened by hand keeps its Subtask.
  await expect(item(/PSAPAC-12,/)).toBeVisible()
})

test('moves with J and K and peeks with the space bar', async () => {
  await open()
  const active = (id: string) => expect(tree()).toHaveAttribute('aria-activedescendant', id)
  await expect(tree()).toBeFocused()

  await active('tree-row-c:1')
  await window.keyboard.press('j')
  await active('tree-row-i:PSAPAC-10')
  // Children run by key descending, so PSAPAC-13 leads.
  await window.keyboard.press('J')
  await active('tree-row-i:PSAPAC-13')
  await window.keyboard.press('k')
  await active('tree-row-i:PSAPAC-10')

  await expect(peek()).toHaveCount(0)
  await window.keyboard.press(' ')
  await expect(peek()).toBeVisible()
  await expect(peek().getByRole('heading', { name: 'Customer onboarding' })).toBeVisible()
  // The Peek follows the active row, and focus stays on the Tree.
  await window.keyboard.press('j')
  await expect(peek().getByRole('heading', { name: 'Book the kickoff' })).toBeVisible()
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-13,/)).toHaveAttribute('aria-selected', 'true')

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
  // The match keeps its Epic as a context row, whose summary draws at regular weight.
  await expect(item(/PSAPAC-10,.*context/)).toBeVisible()
  await expect(item(/PSAPAC-10,.*context/).locator('.tree-summary')).toHaveCSS('font-weight', '400')
  await expect(item(/PSAPAC-3,/).locator('.tree-summary')).toHaveCSS('font-weight', '500')

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
  await expect(item(/^\d+ done$/)).toHaveCount(0)

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
    'Display',
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
  // Each button also holds the icon it shows in a narrow Tree, which is hidden at this width.
  await expect(toggle('Filter').locator('svg:visible')).toHaveCount(1)
  await expect(toggle('Groups').locator('svg:visible')).toHaveCount(1)
  await expect(toggle('Hide done').locator('svg:visible')).toHaveCount(1)

  await toggle('Filter').click()
  const fields = window.locator('#filter-menu summary')
  await expect(fields).toHaveCount(15)
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
  await showEverything(window)
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

test('Assignee: me keeps my issues with their ancestors as context', async () => {
  await openWithDone()

  await toggle('Assignee: me').click()

  await expect(toggle('Assignee: me')).toHaveAttribute('aria-pressed', 'true')
  await expect(item(/PSAPAC-3,/)).toHaveCount(0)
  // Mine, not context.
  await expect(item(/PSAPAC-2,/)).toBeVisible()
  await expect(item(/PSAPAC-2,/)).not.toHaveAttribute('aria-label', /context/)
  // Their ancestors, as context: another person's Story above my Subtask. "Hide done" is on, so a
  // Done Epic does not show as context.
  await expect(item(/PSAPAC-11,.*context/)).toBeVisible()
  await expect(item(/PSAPAC-10,.*context/)).toBeVisible()
  await expect(item(/PSAPAC-20,/)).toHaveCount(0)
  // No filter narrows, so the Stories level applies, but a context Story stays open: the other
  // person's Story shows my Subtask. The fake has no Story of mine with a
  // Subtask of mine, so the closed own Story is covered by the unit test.
  await expect(item(/PSAPAC-11,.*context/)).toHaveAttribute('aria-expanded', 'true')
  await expect(item(/PSAPAC-12,/)).toBeVisible()
})

test('Assignee: me lets an Epic shown only as context follow the level', async () => {
  await openWithDone()
  await toggle('Assignee: me').click()
  const epic = item(/PSAPAC-10,.*context/)
  await expect(epic).toHaveAttribute('aria-expanded', 'true')

  // The Epic is not mine, so Epics closes it; its Story, context for my Subtask, stays open below.
  await pickLevel('Epics')
  await expect(epic).toHaveAttribute('aria-expanded', 'false')
  await expect(item(/PSAPAC-12,/)).toHaveCount(0)

  await pickLevel('Stories')
  await expect(epic).toHaveAttribute('aria-expanded', 'true')
  await expect(item(/PSAPAC-11,.*context/)).toHaveAttribute('aria-expanded', 'true')
  await expect(item(/PSAPAC-12,/)).toBeVisible()
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

test('remembers the expansion level across a relaunch', async () => {
  await open()
  await window.getByRole('button', { name: 'Groups', exact: true }).click()
  await window.getByRole('button', { name: 'Epics', exact: true }).click()
  await expect(item(/PSAPAC-2,/)).toHaveCount(0)
  // The write lands in the settings file under treeLevel.
  await expect
    .poll(
      async () => (await readState<{ treeLevel?: unknown }>(stateDir, 'settings.json'))?.treeLevel,
    )
    .toBe('epics')

  // The fake Keychain lives in the process, so the relaunch logs in again.
  await app.close()
  ;({ app, window } = await launch(stateDir))
  await logIn(window)

  await expect(item(/^Acme, /)).toBeVisible()
  await expect(item(/PSAPAC-10, Epic/)).toHaveAttribute('aria-expanded', 'false')
  await window.getByRole('button', { name: 'Groups', exact: true }).click()
  await expect(window.getByRole('button', { name: 'Epics', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('filters by status and by text, keeping ancestors as context', async () => {
  await open()

  await window.getByRole('button', { name: 'Filter', exact: true }).click()
  await window.getByRole('group', { name: 'Filter' }).getByText('Status', { exact: true }).click()
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
  await window.getByRole('group', { name: 'Filter' }).getByText('Status', { exact: true }).click()
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
  await toggle('Hide done').click()
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
  // Stories, then Epic PSAPAC-50 and its Story. Each of the 3 headers holds 12px more than a row.
  const rowCount = 9 + 7 + 2004
  const canvas = await tree().locator(':scope > div').boundingBox()
  expect(Math.abs((canvas?.height ?? 0) - (rowCount * 32 + 3 * 12))).toBeLessThanOrEqual(32)
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

/** The issue key's weight and colour, and whether the text fits its 5.5rem box. */
const keyPaint = (row: Locator) =>
  row.locator('.tree-key').evaluate((el) => {
    const s = getComputedStyle(el)
    return { weight: s.fontWeight, colour: s.color, fits: el.scrollWidth <= el.clientWidth }
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
  const bothKey = await keyPaint(row)
  // Open only: the active row moved to the header above.
  await window.keyboard.press('k')
  await expect(tree()).toHaveAttribute('aria-activedescendant', 'tree-row-c:1')
  const peeked = await paint(row)
  const peekedKey = await keyPaint(row)
  // Active only: the Peek closed, and the active row came back.
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await window.keyboard.press('j')
  await expect(row).toHaveAttribute('data-active', 'true')
  const focus = await paint(row)
  const focusKey = await keyPaint(row)
  const rest = await paint(item(/PSAPAC-3,/))
  const restKey = await keyPaint(item(/PSAPAC-3,/))

  expect(new Set([both.fill, peeked.fill, focus.fill, rest.fill]).size).toBe(4)
  expect(peeked.weight).toBe('500')
  expect(both.weight).toBe('500')
  // The open row's key is bold in ink, whether or not the row is active. No other key is.
  const ink = await painted('var(--ink)')
  for (const key of [bothKey, peekedKey]) expect(key).toMatchObject({ weight: '600', colour: ink })
  for (const key of [focusKey, restKey]) expect(key.weight).toBe('450')
  expect(restKey.colour).not.toBe(ink)
  for (const state of [both, peeked, focus, rest]) {
    expect(state.shadow).toBe('none')
    expect(state.outline).toBe('none')
    expect(state.borders).toEqual(['0px', '0px', '0px', '0px'])
    expect(state.radius).toBe('8px')
    expect(state.inset).toEqual(['8px', '8px'])
  }
})

test('draws the summary of a row in the key colour, at medium weight, open or not', async () => {
  await open()
  const colour = (field: Locator) => field.evaluate((el) => getComputedStyle(el).color)
  const summaryOf = (row: Locator) => row.locator('.tree-summary')

  const rest = item(/PSAPAC-3,/)
  const restKey = await colour(rest.locator('.tree-key'))
  expect(await colour(summaryOf(rest))).toBe(restKey)
  expect(restKey).toBe(await painted('var(--muted)'))
  await expect(summaryOf(rest)).toHaveCSS('font-weight', '500')

  // The open row's key turns ink, and its summary follows in colour but not in weight.
  await window.keyboard.press('j')
  await window.keyboard.press(' ')
  await expect(peek()).toBeVisible()
  const peeked = item(/PSAPAC-10,/)
  await expect(peeked).toHaveAttribute('aria-selected', 'true')
  const openKey = await colour(peeked.locator('.tree-key'))
  expect(openKey).toBe(await painted('var(--ink)'))
  expect(await colour(summaryOf(peeked))).toBe(openKey)
  await expect(summaryOf(peeked)).toHaveCSS('font-weight', '500')
})

test('keeps the bold key inside its box in a wide font', async () => {
  await open()
  await window.keyboard.press('j')
  await window.keyboard.press(' ')
  await expect(peek()).toBeVisible()
  const style = await window.addStyleTag({
    content: '* { font-family: Verdana, sans-serif !important }',
  })
  const key = await keyPaint(item(/PSAPAC-10,/))
  await style.evaluate((node) => {
    node.parentNode?.removeChild(node)
  })
  expect(key.weight).toBe('600')
  expect(key.fits).toBe(true)
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

  for (const key of ['j', ' ', 'PageDown', 'ArrowRight', 'Home', 'q', 'Meta+k']) {
    await window.keyboard.press(key)
  }

  const seen = await window.evaluate<[string, boolean][]>('window.__keys')
  // Handled keys, Space and the page keys included, never reach the container's own scrolling.
  // The unhandled `q` stays available (`x` checks the active issue, so it is handled) to the system. Cmd+K is the palette's (D7), so it is handled.
  expect(
    seen.filter(([key]) => ['j', ' ', 'PageDown', 'ArrowRight', 'Home'].includes(key)),
  ).toEqual([
    ['j', true],
    [' ', true],
    ['PageDown', true],
    ['ArrowRight', true],
    ['Home', true],
  ])
  expect(seen.filter(([key]) => key === 'q' || key === 'k')).toEqual([
    ['q', false],
    ['k', true],
  ])
})

test('draws a Hold issue with a dashed ring at 30% opacity, and no other row', async () => {
  await open()
  await moveIssue(app, 'PSAPAC-10', 'hold')
  await app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows()
    first?.emit('blur')
    first?.emit('focus')
  })
  const row = item(/PSAPAC-10,/)
  const dot = row.locator('svg[data-glyph="status"]')
  await expect(dot).toHaveAttribute('data-shape', 'hold')
  await expect(dot).toHaveAttribute('aria-label', 'Hold')
  await expect(dot.locator('circle')).toHaveAttribute('stroke-dasharray', /\d/)
  await expect(row).toHaveAttribute('aria-label', /Hold/)

  // The row's content fades once, at its container, so the ring itself stays at 100% and draws at
  // 30%: holdfade.test.ts measures that and the other fields.
  const other = item(/PSAPAC-13,/)
  await expect(other.locator('svg[data-glyph="status"]')).not.toHaveAttribute('data-shape', 'hold')
})
