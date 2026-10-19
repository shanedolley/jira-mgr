/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  joinSprint,
  launch,
  logIn,
  moveIssue,
  notices,
  openSprintRow,
  peekRow,
  refuseKeys,
  releaseEdit,
} from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  // UTC, so a sprint date reads the same on every machine.
  ;({ app, window } = await launch(stateDir, { TZ: 'Etc/UTC' }))
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const dot = (row: RegExp) => item(row).locator('[data-pick=status]')
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const sidebar = () => window.getByRole('navigation', { name: 'Main' })
const listbox = () => window.getByRole('listbox', { name: 'Status' })
const option = (name: string | RegExp) => window.getByRole('option', { name })
/** The open list, drawn by the cell editor against the clicked cell. */
const popover = () => window.locator('.menu:popover-open')
const ring = (key: string, status: string) =>
  sprintPage().getByRole('button', { name: `Status of ${key}: ${status}` })

/** PSAPAC-4 and PSAPAC-13 start in the active sprint; these join them, as in the Sprint page tests. */
const MEMBERS = [
  'PSAPAC-1',
  'PSAPAC-2',
  'PSAPAC-4',
  'PSAPAC-11',
  'PSAPAC-13',
  'PSAPAC-14',
  'PSAPAC-22',
]

async function open() {
  await joinSprint(app, MEMBERS, 5)
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under a click.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

async function openSprint() {
  await open()
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
  await expect(sprintPage().getByRole('status')).toHaveText('7 issues')
}

const writes = async () => (await counts(app)).edits

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

/** Whether focus is on `page` or inside it. */
const focusWithin = (page: ReturnType<typeof sprintPage>) =>
  page.evaluate((el) => el.contains(document.activeElement))

test('a click on a status dot opens the list beside the dot and not the Peek', async () => {
  await open()
  await dot(/PSAPAC-3,/).click()

  await expect(listbox()).toBeFocused()
  await expect(peek()).toHaveCount(0)
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')
  // Below the dot, starting at its left edge.
  const cell = await dot(/PSAPAC-3,/).boundingBox()
  const list = await popover().boundingBox()
  if (cell === null || list === null) throw new Error('the dot or the list is not drawn')
  expect(list.y).toBeGreaterThanOrEqual(cell.y + cell.height - 1)
  expect(Math.abs(list.x - cell.x)).toBeLessThanOrEqual(4)
})

test('choosing a status moves the issue, shows it at once and returns focus to the Tree', async () => {
  await open()
  const before = await writes()
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/To Do/)

  await dot(/PSAPAC-3,/).click()
  await option('In Progress').click()

  // The row shows the new status before Jira answers.
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/In Progress/)
  await expect(listbox()).toHaveCount(0)
  await settle(before + 1)
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')
})

test('Esc closes the list with no write and leaves the row active and the Tree focused', async () => {
  await open()
  const before = await writes()

  await dot(/PSAPAC-3,/).click()
  await expect(listbox()).toBeFocused()
  await window.keyboard.press('Escape')

  await expect(listbox()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')
  expect(await writes()).toBe(before)
})

test('a click outside closes the list, and a second click on the dot closes it too', async () => {
  await open()
  const before = await writes()

  await dot(/PSAPAC-3,/).click()
  await expect(listbox()).toBeVisible()
  await sidebar()
    .getByRole('link', { name: /^Issues/ })
    .click()
  await expect(listbox()).toHaveCount(0)

  await dot(/PSAPAC-3,/).click()
  await expect(listbox()).toBeVisible()
  await dot(/PSAPAC-3,/).click()
  await expect(listbox()).toHaveCount(0)
  // It stays closed: the click that closed it did not open it again.
  await window.waitForTimeout(300)
  await expect(listbox()).toHaveCount(0)
  expect(await writes()).toBe(before)
})

test('a click on the dot selects no text, keeps the checked rows and arms no double-click', async () => {
  await open()
  await peekRow(item(/PSAPAC-4,/))
  await window.keyboard.press('Escape')
  await window.keyboard.press('x')
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('aria-checked', 'true')

  await dot(/PSAPAC-3,/).dblclick()
  await expect(issuePage()).toHaveCount(0)
  await expect(peek()).toHaveCount(0)
  expect(await window.evaluate(() => document.getSelection()?.toString())).toBe('')
  await expect(dot(/PSAPAC-3,/)).toHaveCSS('user-select', 'none')
  // The checked row stays checked and the clicked one is not.
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('aria-checked', 'true')
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('aria-checked', 'false')
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')
})

test('Shift+click on the dot checks a range and opens no list', async () => {
  await open()
  await peekRow(item(/PSAPAC-4,/))
  await window.keyboard.press('Escape')
  await dot(/PSAPAC-3,/).click({ modifiers: ['Shift'] })

  await expect(listbox()).toHaveCount(0)
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('aria-checked', 'true')
})

test('S opens the same list on the active row, and arrows and Enter choose', async () => {
  await open()
  await peekRow(item(/PSAPAC-3,/))
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  const before = await writes()

  await window.keyboard.press('s')
  await expect(listbox()).toBeFocused()
  await expect(peek()).toHaveCount(0)
  // Beside the active row's dot, not at the Peek.
  const cell = await dot(/PSAPAC-3,/).boundingBox()
  const list = await popover().boundingBox()
  if (cell === null || list === null) throw new Error('the dot or the list is not drawn')
  expect(list.y).toBeGreaterThanOrEqual(cell.y + cell.height - 1)
  expect(Math.abs(list.x - cell.x)).toBeLessThanOrEqual(4)

  // The statuses load when the list opens.
  await expect(option('In Progress')).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await expect(listbox()).toHaveCount(0)
  await expect(item(/PSAPAC-3,/)).not.toHaveAccessibleName(/To Do/)
  await settle(before + 1)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')
})

test('the list is named Status and answers to the keys 1 to 9', async () => {
  await open()
  await dot(/PSAPAC-3,/).click()
  await expect(listbox()).toHaveAccessibleName('Status')
  await expect(option('In Progress')).toBeVisible()
  const before = await writes()
  await window.keyboard.press('2')
  await settle(before + 1)
  await expect(item(/PSAPAC-3,/)).not.toHaveAccessibleName(/To Do/)
})

test('a refused transition puts the status back and the toast offers Retry', async () => {
  await open()
  await refuseKeys(app, ['PSAPAC-3'])
  const before = await writes()

  await dot(/PSAPAC-3,/).click()
  await option('In Progress').click()
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/In Progress/)
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Status not changed')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/To Do/)
})

test('a Hold row stays editable', async () => {
  await moveIssue(app, 'PSAPAC-3', 'hold')
  await open()
  const before = await writes()

  await dot(/PSAPAC-3,/).click()
  await expect(listbox()).toBeFocused()
  // The row fades to 30%, but the list over it is not part of the row.
  const drawn = await popover().evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return opacity
  })
  expect(drawn).toBe(1)
  await option('In Progress').click()
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/In Progress/)
  await settle(before + 1)
})

/** Shrinks the window to its smallest height, so the Tree is short enough to have a row at its foot. */
async function shortWindow() {
  const width = await window.evaluate(() => globalThis.innerWidth)
  await app.evaluate(({ BrowserWindow }, w) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(w, 520)
  }, width)
  await expect.poll(() => window.evaluate(() => globalThis.innerHeight)).toBe(520)
}

/**
 * Scrolls the Tree until the issue row that crosses its foot hangs 6px below it, and returns that
 * row's key. Its dot is in view and the lower part of the row is clipped.
 */
async function clipAtFoot() {
  const key = await tree().evaluate((el) => {
    const frame = el.getBoundingClientRect()
    for (const row of el.querySelectorAll('[role=treeitem]')) {
      const box = row.getBoundingClientRect()
      const key = /^(PSAPAC-\d+),/.exec(row.getAttribute('aria-label') ?? '')?.[1]
      if (key !== undefined && box.top < frame.bottom - 20 && box.bottom > frame.bottom) {
        el.scrollTop += box.bottom - frame.bottom - 6
        return key
      }
    }
    throw new Error('no row crosses the foot of the Tree')
  })
  return new RegExp(`^${key},`)
}

/** Whether the dot of `row` sits wholly inside the Tree. */
const dotInView = (row: RegExp) =>
  dot(row).evaluate((el) => {
    const box = el.getBoundingClientRect()
    const frame = el.closest('[role=tree]')?.getBoundingClientRect()
    return frame !== undefined && box.top >= frame.top && box.bottom <= frame.bottom
  })

test('a click on the dot of a row clipped at the Tree foot scrolls it into view and keeps the list open', async () => {
  await open()
  await shortWindow()
  const row = await clipAtFoot()
  // The precondition: the row hangs below the Tree's foot, with its dot in view to click.
  const hanging = () =>
    item(row).evaluate((el) => {
      const frame = el.closest('[role=tree]')?.getBoundingClientRect()
      return el.getBoundingClientRect().bottom - (frame?.bottom ?? 0)
    })
  expect(await hanging()).toBeGreaterThan(0)
  expect(await dotInView(row)).toBe(true)
  const cell = await dot(row).boundingBox()
  if (cell === null) throw new Error('the dot is not drawn')
  // A raw click, so Playwright does not scroll the dot into view first.
  await window.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2)

  await expect(listbox()).toBeFocused()
  // The row scrolls fully into view, and the list stays open through it, below the dot.
  await window.waitForTimeout(500)
  await expect(listbox()).toBeVisible()
  const overhang = await hanging()
  expect(overhang).toBeLessThanOrEqual(0)
  const moved = await dot(row).boundingBox()
  const list = await popover().boundingBox()
  if (moved === null || list === null) throw new Error('the dot or the list is not drawn')
  // The row sits at the foot of a 520px window with no room below, so the list flips above the dot.
  const below = list.y >= moved.y + moved.height - 1
  const above = list.y + list.height <= moved.y + 1
  expect(below || above).toBe(true)
  // Anchored to the dot, not fallen to a corner of the window.
  expect(Math.abs(list.x - moved.x)).toBeLessThanOrEqual(4)
  await expect(item(row)).toHaveAttribute('data-active', 'true')
  await expect(peek()).toHaveCount(0)
})

test('S on an active row scrolled partly out at the Tree top brings its dot into view before the list opens', async () => {
  await open()
  // A short window, so the Tree scrolls.
  await shortWindow()
  await peekRow(item(/PSAPAC-3,/))
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  // The wheel scrolls the row 12px above the top edge. The keyboard did not move the active row.
  await tree().evaluate((el) => {
    const row = [...el.querySelectorAll('[role=treeitem]')].find((r) =>
      (r.getAttribute('aria-label') ?? '').startsWith('PSAPAC-3,'),
    )
    if (row === undefined) throw new Error('no such row')
    el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top + 12
  })
  expect(await dotInView(/PSAPAC-3,/)).toBe(false)

  await window.keyboard.press('s')
  await expect(listbox()).toBeFocused()
  await window.waitForTimeout(500)
  await expect(listbox()).toBeVisible()
  expect(await dotInView(/PSAPAC-3,/)).toBe(true)
})

test('the Sprint page rows offer the same list and still open their issue', async () => {
  await openSprint()
  const before = await writes()
  const done = sprintPage().getByRole('region', { name: 'Done' }).getByRole('listitem')
  await expect(done).toHaveCount(2)

  await ring('PSAPAC-4', 'In Progress').click()
  await expect(listbox()).toBeFocused()
  await expect(sprintPage()).toBeVisible()
  await option('Done').click()

  // The row changes group before Jira answers.
  await expect(done).toHaveCount(3)
  await settle(before + 1)
  await expect(issuePage()).toHaveCount(0)

  // The row button still opens the issue.
  await openSprintRow(sprintPage().getByRole('button', { name: /^PSAPAC-13 / }))
  await expect(issuePage()).toBeVisible()
})

test('a Sprint page ring works by keyboard alone: Enter opens, arrows and Enter choose, Esc leaves', async () => {
  await openSprint()
  const before = await writes()

  await ring('PSAPAC-4', 'In Progress').focus()
  await window.keyboard.press('Enter')
  await expect(listbox()).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(listbox()).toHaveCount(0)
  expect(await focusWithin(sprintPage())).toBe(true)
  expect(await writes()).toBe(before)

  await ring('PSAPAC-4', 'In Progress').focus()
  await window.keyboard.press('Enter')
  // A precondition: the arrows need the list to hold focus.
  await expect(listbox()).toBeFocused()
  await expect(option('Done')).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await settle(before + 1)
  await expect(sprintPage()).toBeVisible()
  // The row moves to Done, which remounts its ring; the page takes focus two frames after the list closes.
  await expect.poll(() => focusWithin(sprintPage())).toBe(true)
})

test('a refused transition on the Sprint page puts the row back in its group', async () => {
  await openSprint()
  await refuseKeys(app, ['PSAPAC-4'])
  const before = await writes()
  const done = sprintPage().getByRole('region', { name: 'Done' }).getByRole('listitem')
  const doing = sprintPage().getByRole('region', { name: 'In Progress' }).getByRole('listitem')

  await ring('PSAPAC-4', 'In Progress').click()
  await option('Done').click()
  await expect(done).toHaveCount(3)
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  await expect(notices(window).getByRole('alert')).toContainText('Status not changed')
  await expect(done).toHaveCount(2)
  await expect(doing).toHaveCount(3)
})

test('holds its layout with a wide font: the list fits the window and the Sprint page ring clears the key', async () => {
  await openSprint()
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })

  // The ring sits left of the key in every row, and the key is not covered.
  const overlaps = await sprintPage().evaluate((page) =>
    [...page.querySelectorAll('li[data-issue-key]')].flatMap((row) => {
      const button = row.querySelector('[data-pick=status]')
      const key = row.querySelector('.sprint-key')
      if (button === null || key === null) return ['row without its parts']
      return button.getBoundingClientRect().right > key.getBoundingClientRect().left + 0.5
        ? [row.getAttribute('data-issue-key') ?? '']
        : []
    }),
  )
  expect(overlaps).toEqual([])

  await ring('PSAPAC-4', 'In Progress').click()
  await expect(option('Done')).toBeVisible()
  const fits = await popover().evaluate((list) => {
    const box = list.getBoundingClientRect()
    const clipped = [...list.querySelectorAll('[role=option]')].filter(
      (o) => o.scrollWidth > o.clientWidth + 0.5,
    ).length
    return {
      inside:
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= globalThis.innerWidth &&
        box.bottom <= globalThis.innerHeight,
      clipped,
    }
  })
  expect(fits).toEqual({ inside: true, clipped: 0 })
  await window.keyboard.press('Escape')

  await sidebar()
    .getByRole('link', { name: /^Issues/ })
    .click()
  await dot(/PSAPAC-4,/).click()
  await expect(option('Done')).toBeVisible()
  const treeFits = await popover().evaluate((list) => {
    const box = list.getBoundingClientRect()
    return box.right <= globalThis.innerWidth && box.bottom <= globalThis.innerHeight
  })
  expect(treeFits).toBe(true)
})
