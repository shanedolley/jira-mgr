/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  expectBeside,
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
/** The Sprint slot of a row, which is the cell the editor anchors to. */
const slot = (row: RegExp) => item(row).locator('[data-prop=sprint]')
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const listbox = () => window.getByRole('listbox', { name: 'Sprint' })
const option = (name: string | RegExp) => window.getByRole('option', { name })
/** The open list, drawn by the cell editor against the clicked slot. */
const popover = () => window.locator('.menu:popover-open')
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const sprintRow = (key: string) => sprintPage().locator(`li[data-issue-key=${key}]`)
/** A Sprint page row's Sprint slot: a button beside the row's own, named by its value. */
const sprintSlot = (key: string, name: string) =>
  sprintRow(key).getByRole('button', { name: `Sprint of ${key}: ${name}` })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const chip = (name: string) =>
  window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name, exact: true })

/** PSAPAC-13 is a Task in the active Sprint 5 (ends 14 Oct); PSAPAC-3 is a Bug in the backlog; PSAPAC-10 is an Epic. */
async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under a click.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
  await window.getByRole('button', { name: 'Display', exact: true }).click()
  await chip('Sprint').click()
  await window.keyboard.press('Escape')
  await expect(chip('Sprint')).toBeHidden()
  await expect(slot(/PSAPAC-13,/)).toHaveText('S 5')
}

const writes = async () => (await counts(app)).edits

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

test('a click on a Sprint slot opens the list below the slot and not the Peek', async () => {
  await open()
  await slot(/PSAPAC-13,/).click()

  await expect(listbox()).toBeFocused()
  await expect(peek()).toHaveCount(0)
  await expect(item(/PSAPAC-13,/)).toHaveAttribute('data-active', 'true')
  // Full names, with the start and end days beside them, though the slot shows only the number.
  await expect(option('Backlog')).toBeVisible()
  await expect(option(/^Sprint 5/)).toHaveAttribute('aria-selected', 'true')
  await expect(option(/^Sprint 5/)).toContainText('1 Oct - 14 Oct')
  await expect(option(/^Sprint 6/)).toContainText('Future')
  await expectBeside(window, slot(/PSAPAC-13,/), popover())
})

test('choosing a sprint shows it at once, moves the issue and returns focus to the Tree', async () => {
  await open()
  const before = await writes()

  await slot(/PSAPAC-13,/).click()
  await option(/^Sprint 6/).click()

  // The slot shows the new sprint before Jira answers.
  await expect(slot(/PSAPAC-13,/)).toHaveText('S 6')
  await expect(listbox()).toHaveCount(0)
  await settle(before + 1)
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-13,/)).toHaveAttribute('data-active', 'true')
})

test('Backlog empties the slot, and an empty slot is a target that moves the issue into a sprint', async () => {
  await open()
  const before = await writes()

  await slot(/PSAPAC-13,/).click()
  await option('Backlog').click()
  await expect(slot(/PSAPAC-13,/)).toHaveText('')
  await settle(before + 1)

  // The now empty slot still opens the list, as does the backlog Story's.
  await expect(slot(/PSAPAC-13,/)).toHaveAttribute('title', 'Set sprint')
  await slot(/PSAPAC-3,/).click()
  await expect(listbox()).toBeFocused()
  await expect(option('Backlog')).toHaveAttribute('aria-selected', 'true')
  await option(/^Sprint 5/).click()
  await expect(slot(/PSAPAC-3,/)).toHaveText('S 5')
  await settle(before + 2)
  await expect(peek()).toHaveCount(0)
})

test('Esc closes the list with no write and leaves the Tree focused', async () => {
  await open()
  const before = await writes()

  await slot(/PSAPAC-13,/).click()
  await expect(listbox()).toBeFocused()
  await window.keyboard.press('Escape')

  await expect(listbox()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-13,/)).toHaveAttribute('data-active', 'true')
  expect(await writes()).toBe(before)
})

test('Shift+C opens the same list below the active row slot, and arrows and Enter choose', async () => {
  await open()
  await peekRow(item(/PSAPAC-13,/))
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  const before = await writes()

  await window.keyboard.press('Shift+C')
  await expect(listbox()).toBeFocused()
  // No issue menu and no Peek: the list sits against the slot.
  await expect(peek()).toHaveCount(0)
  await expect(window.getByRole('menu')).toHaveCount(0)
  await expectBeside(window, slot(/PSAPAC-13,/), popover())

  await expect(option(/^Sprint 6/)).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await expect(listbox()).toHaveCount(0)
  await expect(slot(/PSAPAC-13,/)).toHaveText('S 6')
  await settle(before + 1)
  await expect(tree()).toBeFocused()
})

test('Shift+C opens the issue menu list when the Peek narrows the Tree and hides the slot', async () => {
  await open()
  await peekRow(item(/PSAPAC-13,/))
  await expect(peek()).toBeVisible()
  // The open Peek leaves the Tree too narrow to draw its slots.
  await expect(slot(/PSAPAC-13,/)).toBeHidden()

  await window.keyboard.press('Shift+C')
  await expect(listbox()).toBeFocused()
  await expect(window.getByRole('menu')).toBeVisible()
  await expect(option(/^Sprint 6/)).toBeVisible()
})

test('an Epic offers no Sprint target, and Shift+C opens nothing on it', async () => {
  await open()
  await expect(slot(/PSAPAC-10,/)).not.toHaveAttribute('data-pick', /.+/)

  await peekRow(item(/PSAPAC-10,/))
  await window.keyboard.press('Escape')
  await window.keyboard.press('Shift+C')
  await window.waitForTimeout(150)
  await expect(listbox()).toHaveCount(0)

  await slot(/PSAPAC-10,/).click()
  await expect(listbox()).toHaveCount(0)
})

test('a refused move puts the sprint back and the toast offers Retry', async () => {
  await open()
  await refuseKeys(app, ['PSAPAC-13'])
  const before = await writes()

  await slot(/PSAPAC-13,/).click()
  await option(/^Sprint 6/).click()
  await expect(slot(/PSAPAC-13,/)).toHaveText('S 6')
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Sprint not changed')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(slot(/PSAPAC-13,/)).toHaveText('S 5')
})

test('a Hold row stays editable', async () => {
  await moveIssue(app, 'PSAPAC-13', 'hold')
  await open()
  const before = await writes()

  await slot(/PSAPAC-13,/).click()
  await expect(listbox()).toBeFocused()
  // The row fades, but the list over it is not part of the row.
  const drawn = await popover().evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return opacity
  })
  expect(drawn).toBe(1)
  await option(/^Sprint 6/).click()
  await expect(slot(/PSAPAC-13,/)).toHaveText('S 6')
  await settle(before + 1)
})

test('holds its layout with a wide font: the slot stays inside its row and the list fits the window', async () => {
  await open()
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })

  const inside = await slot(/PSAPAC-13,/).evaluate((el) => {
    const box = el.getBoundingClientRect()
    const row = el.closest('[role=treeitem]')?.getBoundingClientRect()
    return row !== undefined && box.left >= row.left && box.right <= row.right + 0.5
  })
  expect(inside).toBe(true)

  await slot(/PSAPAC-13,/).click()
  await expect(option(/^Sprint 6/)).toBeVisible()
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
  // The wide list (26rem), so a name and both dates sit on one line.
  const box = await popover().boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(416)
  await expect(option(/^Sprint 5/)).toContainText('1 Oct - 14 Oct')
})

async function openSprintPage() {
  await open()
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
  await expect(sprintRow('PSAPAC-13')).toBeVisible()
}

/** Whether focus is on the Sprint page or inside it. */
const focusInPage = () => sprintPage().evaluate((el) => el.contains(document.activeElement))

test('a Sprint page row offers the same list from its Sprint slot and still opens its issue', async () => {
  await openSprintPage()
  const before = await writes()
  const slotButton = sprintSlot('PSAPAC-13', 'Sprint 5')
  await expect(slotButton).toHaveText('S 5')
  // The full name is back as a tooltip, as on the Tree.
  await expect(slotButton).toHaveAttribute('title', 'Sprint 5, ends 2026-10-14')

  await slotButton.click()
  await expect(listbox()).toBeFocused()
  await expect(issuePage()).toHaveCount(0)
  await expect(option(/^Sprint 5/)).toHaveAttribute('aria-selected', 'true')
  await window.keyboard.press('Escape')
  await expect(listbox()).toHaveCount(0)
  expect(await focusInPage()).toBe(true)
  expect(await writes()).toBe(before)

  // The row button still opens the issue.
  await openSprintRow(sprintPage().getByRole('button', { name: /^PSAPAC-13 / }))
  await expect(issuePage()).toBeVisible()
})

test('moving an issue out of the sprint takes its row off the page at once and keeps focus on the page', async () => {
  await openSprintPage()
  const before = await writes()

  await sprintSlot('PSAPAC-13', 'Sprint 5').click()
  await option(/^Sprint 6/).click()

  // The row leaves before Jira answers.
  await expect(sprintRow('PSAPAC-13')).toHaveCount(0)
  await settle(before + 1)
  await expect(sprintRow('PSAPAC-13')).toHaveCount(0)
  await expect(issuePage()).toHaveCount(0)
  await expect.poll(focusInPage).toBe(true)
})

test('a Sprint page Sprint slot works by keyboard alone: Enter opens, arrows and Enter choose', async () => {
  await openSprintPage()
  const before = await writes()

  await sprintSlot('PSAPAC-13', 'Sprint 5').focus()
  await window.keyboard.press('Enter')
  await expect(listbox()).toBeFocused()
  await expect(option(/^Sprint 6/)).toBeVisible()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')

  await expect(sprintRow('PSAPAC-13')).toHaveCount(0)
  await settle(before + 1)
  await expect.poll(focusInPage).toBe(true)
})

test('a refused move on the Sprint page puts the row back with a Retry toast', async () => {
  await openSprintPage()
  await refuseKeys(app, ['PSAPAC-13'])
  const before = await writes()

  await sprintSlot('PSAPAC-13', 'Sprint 5').click()
  await option('Backlog').click()
  await expect(sprintRow('PSAPAC-13')).toHaveCount(0)
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Sprint not changed')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(sprintRow('PSAPAC-13')).toBeVisible()
  await expect(sprintSlot('PSAPAC-13', 'Sprint 5')).toBeVisible()
})
