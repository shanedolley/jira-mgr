/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  fieldsOf,
  joinSprint,
  launch,
  logIn,
  moveIssue,
  notices,
  refuseKeys,
  releaseEdit,
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

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const avatar = (row: RegExp) => item(row).locator('[data-pick=assignee]')
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const listbox = () => window.getByRole('listbox', { name: 'Assignee' })
const search = () => window.getByRole('combobox', { name: 'Search Assignee' })
const option = (name: string | RegExp) => window.getByRole('option', { name })
/** The open list, drawn by the cell editor against the clicked cell. */
const popover = () => window.locator('.menu:popover-open')
const sidebar = () => window.getByRole('navigation', { name: 'Main' })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
/** A Sprint page row's assignee button; PSAPAC-3 has no assignee to start with. */
const slot = (key: string) =>
  sprintPage().getByRole('button', { name: new RegExp(`^Assignee of ${key}:`) })

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under a click.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

const writes = async () => (await counts(app)).edits

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

/** The account id the fake Jira holds as the issue's assignee, or null. */
const assigneeOf = async (key: string) =>
  ((await fieldsOf(app, key))?.assignee as { accountId: string } | null | undefined)?.accountId ??
  null

test('a click on an avatar opens the list beside the avatar and not the Peek', async () => {
  await open()
  await avatar(/PSAPAC-4,/).click()

  await expect(search()).toBeFocused()
  await expect(listbox()).toBeVisible()
  await expect(peek()).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')
  // Below the avatar, starting at its left edge.
  const cell = await avatar(/PSAPAC-4,/).boundingBox()
  const list = await popover().boundingBox()
  if (cell === null || list === null) throw new Error('the avatar or the list is not drawn')
  expect(list.y).toBeGreaterThanOrEqual(cell.y + cell.height - 1)
  expect(list.x + list.width).toBeLessThanOrEqual(
    await window.evaluate(() => globalThis.innerWidth),
  )
})

test('choosing a user shows it at once, writes it, and returns focus to the Tree', async () => {
  await open()
  const before = await writes()
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/Test User/)

  await avatar(/PSAPAC-4,/).click()
  await search().pressSequentially('cy')
  await option('Cy Young').click()

  // The row shows the new assignee before Jira answers.
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/Cy Young/)
  await expect(listbox()).toHaveCount(0)
  await settle(before + 1)
  expect(await assigneeOf('PSAPAC-4')).toBe('u3')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')
})

test('Unassigned clears the assignee, and the empty avatar is a target that assigns', async () => {
  await open()
  const before = await writes()

  await avatar(/PSAPAC-4,/).click()
  await option('Unassigned').click()
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/unassigned/)
  await settle(before + 1)
  expect(await assigneeOf('PSAPAC-4')).toBeNull()

  // PSAPAC-3 starts unassigned: its dotted person is clickable all the same.
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/unassigned/)
  await avatar(/PSAPAC-3,/).click()
  await expect(search()).toBeFocused()
  await option(/Me/).click()
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/Test User/)
  await settle(before + 2)
  expect(await assigneeOf('PSAPAC-3')).toBe('u1')
})

test('Esc closes the list with no write and leaves the row active and the Tree focused', async () => {
  await open()
  const before = await writes()

  await avatar(/PSAPAC-4,/).click()
  await expect(search()).toBeFocused()
  await window.keyboard.press('Escape')

  await expect(listbox()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/Test User/)
  expect(await writes()).toBe(before)
})

test('a second click on the avatar closes the list and does not open it again', async () => {
  await open()
  await avatar(/PSAPAC-4,/).click()
  await expect(listbox()).toBeVisible()
  await avatar(/PSAPAC-4,/).click()
  await expect(listbox()).toHaveCount(0)
  await window.waitForTimeout(300)
  await expect(listbox()).toHaveCount(0)
})

test('a click on the avatar selects no text, keeps the checked rows and arms no double-click', async () => {
  await open()
  await item(/PSAPAC-2,/).click()
  await window.keyboard.press('Escape')
  await window.keyboard.press('x')
  await expect(item(/PSAPAC-2,/)).toHaveAttribute('aria-checked', 'true')

  await avatar(/PSAPAC-4,/).dblclick()
  await expect(issuePage()).toHaveCount(0)
  await expect(peek()).toHaveCount(0)
  expect(await window.evaluate(() => document.getSelection()?.toString())).toBe('')
  await expect(avatar(/PSAPAC-4,/)).toHaveCSS('user-select', 'none')
  // The checked row stays checked and the clicked one is not.
  await expect(item(/PSAPAC-2,/)).toHaveAttribute('aria-checked', 'true')
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('aria-checked', 'false')
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')
})

test('Shift+click on the avatar checks a range and opens no list', async () => {
  await open()
  await item(/PSAPAC-2,/).click()
  await window.keyboard.press('Escape')
  await avatar(/PSAPAC-4,/).click({ modifiers: ['Shift'] })

  await expect(listbox()).toHaveCount(0)
  await expect(peek()).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('aria-checked', 'true')
})

test('A opens the list on the active row, and arrows and Enter choose by keyboard alone', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  const before = await writes()

  await window.keyboard.press('a')
  await expect(search()).toBeFocused()
  await expect(peek()).toHaveCount(0)
  await expect(listbox()).toHaveAccessibleName('Assignee')
  // Beside the active row's avatar, not at the Peek.
  const cell = await avatar(/PSAPAC-4,/).boundingBox()
  const list = await popover().boundingBox()
  if (cell === null || list === null) throw new Error('the avatar or the list is not drawn')
  expect(list.y).toBeGreaterThanOrEqual(cell.y + cell.height - 1)

  await expect(option('Unassigned')).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await expect(listbox()).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).not.toHaveAccessibleName(/Test User/)
  await settle(before + 1)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')
})

test('a refused write puts the assignee back and the toast offers Retry', async () => {
  await open()
  await refuseKeys(app, ['PSAPAC-4'])
  const before = await writes()

  await avatar(/PSAPAC-4,/).click()
  await option('Unassigned').click()
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/unassigned/)
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Assignee not changed')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/Test User/)
  expect(await assigneeOf('PSAPAC-4')).toBe('u1')
})

test('a Hold row stays editable', async () => {
  await moveIssue(app, 'PSAPAC-4', 'hold')
  await open()
  const before = await writes()

  await avatar(/PSAPAC-4,/).click()
  await expect(search()).toBeFocused()
  // The row fades, but the list over it is not part of the row.
  const drawn = await popover().evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return opacity
  })
  expect(drawn).toBe(1)
  await option('Unassigned').click()
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/unassigned/)
  await settle(before + 1)
})

test('holds its layout with a wide font: the list fits the window and no option clips', async () => {
  await open()
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })

  await avatar(/PSAPAC-4,/).click()
  await expect(option('Unassigned')).toBeVisible()
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
})

/** Only PSAPAC-13 starts in the active sprint; PSAPAC-3 (no assignee) and PSAPAC-4 join it. */
async function openSprint() {
  await joinSprint(app, ['PSAPAC-3', 'PSAPAC-4'], 5)
  await open()
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
  await expect(slot('PSAPAC-4')).toBeVisible()
}

test('the Sprint page rows offer the same list, named by assignee, and still open their issue', async () => {
  await openSprint()
  const before = await writes()
  await expect(slot('PSAPAC-4')).toHaveAccessibleName('Assignee of PSAPAC-4: Test User')
  await expect(slot('PSAPAC-3')).toHaveAccessibleName('Assignee of PSAPAC-3: Unassigned')

  await slot('PSAPAC-4').click()
  await expect(search()).toBeFocused()
  await expect(listbox()).toBeVisible()
  await expect(sprintPage()).toBeVisible()
  await expect(issuePage()).toHaveCount(0)
  await search().pressSequentially('cy')
  await option('Cy Young').click()

  // The slot shows the new assignee before Jira answers.
  await expect(slot('PSAPAC-4')).toHaveAccessibleName('Assignee of PSAPAC-4: Cy Young')
  await settle(before + 1)
  expect(await assigneeOf('PSAPAC-4')).toBe('u3')
  await expect(issuePage()).toHaveCount(0)

  // An unassigned row's empty avatar is a target, and Unassigned clears one.
  await slot('PSAPAC-3').click()
  await option(/Me/).click()
  await expect(slot('PSAPAC-3')).toHaveAccessibleName('Assignee of PSAPAC-3: Test User')
  await settle(before + 2)
  await slot('PSAPAC-3').click()
  await option('Unassigned').click()
  await expect(slot('PSAPAC-3')).toHaveAccessibleName('Assignee of PSAPAC-3: Unassigned')
  await settle(before + 3)
  expect(await assigneeOf('PSAPAC-3')).toBeNull()

  // The row button still opens the issue.
  await sprintPage()
    .getByRole('button', { name: /^PSAPAC-13 / })
    .click()
  await expect(issuePage()).toBeVisible()
})

test('a Sprint page assignee button works by keyboard alone: Enter opens, arrows and Enter choose, Esc leaves', async () => {
  await openSprint()
  const before = await writes()
  const inSprint = () => sprintPage().evaluate((el) => el.contains(document.activeElement))

  await slot('PSAPAC-4').focus()
  await window.keyboard.press('Enter')
  await expect(search()).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(listbox()).toHaveCount(0)
  expect(await inSprint()).toBe(true)
  expect(await writes()).toBe(before)

  await slot('PSAPAC-4').focus()
  await window.keyboard.press('Enter')
  // A precondition: the arrows need the search to hold focus.
  await expect(search()).toBeFocused()
  await expect(option('Unassigned')).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await settle(before + 1)
  await expect(slot('PSAPAC-4')).not.toHaveAccessibleName(/Test User/)
  await expect(sprintPage()).toBeVisible()
  expect(await inSprint()).toBe(true)
})

test('a refused write on the Sprint page puts the assignee back and offers Retry', async () => {
  await openSprint()
  await refuseKeys(app, ['PSAPAC-4'])
  const before = await writes()

  await slot('PSAPAC-4').click()
  await option('Unassigned').click()
  await expect(slot('PSAPAC-4')).toHaveAccessibleName('Assignee of PSAPAC-4: Unassigned')
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Assignee not changed')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(slot('PSAPAC-4')).toHaveAccessibleName('Assignee of PSAPAC-4: Test User')
})

test('a Hold row on the Sprint page keeps its fade and stays editable', async () => {
  await moveIssue(app, 'PSAPAC-3', 'hold')
  await openSprint()
  const before = await writes()
  const faded = (key: string) =>
    sprintPage()
      .locator(`li[data-issue-key=${key}] [data-pick=assignee] > *`)
      .evaluate((el) => {
        let opacity = 1
        for (let node: Element | null = el; node !== null; node = node.parentElement) {
          opacity *= Number(getComputedStyle(node).opacity)
        }
        return Math.round(opacity * 100) / 100
      })
  await expect.poll(() => faded('PSAPAC-3')).toBe(0.3)
  await expect.poll(() => faded('PSAPAC-4')).toBe(1)

  await slot('PSAPAC-3').click()
  await expect(search()).toBeFocused()
  await option(/Me/).click()
  await expect(slot('PSAPAC-3')).toHaveAccessibleName('Assignee of PSAPAC-3: Test User')
  await settle(before + 1)
})

test('holds its layout with a wide font on the Sprint page: the avatar button clears the row edge and the list fits', async () => {
  await openSprint()
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })

  // The button sits inside its row, left of the pencil, in every row.
  const overlaps = await sprintPage().evaluate((page) =>
    [...page.querySelectorAll('li[data-issue-key]')].flatMap((row) => {
      const button = row.querySelector('[data-pick=assignee]')
      const pencil = row.querySelector('[aria-label^="Edit summary of"]')
      if (button === null || pencil === null) return ['row without its parts']
      const box = button.getBoundingClientRect()
      const edge = row.getBoundingClientRect()
      return box.right > pencil.getBoundingClientRect().left + 0.5 ||
        box.right > edge.right ||
        box.left < edge.left
        ? [row.getAttribute('data-issue-key') ?? '']
        : []
    }),
  )
  expect(overlaps).toEqual([])

  await slot('PSAPAC-4').click()
  await expect(option('Unassigned')).toBeVisible()
  const fits = await popover().evaluate((list) => {
    const box = list.getBoundingClientRect()
    return (
      box.left >= 0 &&
      box.top >= 0 &&
      box.right <= globalThis.innerWidth &&
      box.bottom <= globalThis.innerHeight
    )
  })
  expect(fits).toBe(true)
})
