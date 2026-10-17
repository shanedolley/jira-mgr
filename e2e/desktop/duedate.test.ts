/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  fieldsOf,
  launch,
  logIn,
  moveIssue,
  notices,
  refuseKeys,
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

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const slot = (row: RegExp) => item(row).locator('[data-prop=due]')
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const displayButton = () => window.getByRole('button', { name: 'Display', exact: true })
/** The editor, drawn by the cell editor against the clicked slot. */
const editor = () => window.getByRole('dialog', { name: 'Due date' })
const field = () => editor().locator('input[type=date]')

/** PSAPAC-11 has no due date; PSAPAC-40 is overdue (2020-01-02). */
const EMPTY = /PSAPAC-11,/
const FILLED = /PSAPAC-40,/

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
  const ordering = window.getByRole('group', { name: 'Ordering', exact: true })
  await displayButton().click()
  await expect(ordering).toBeVisible()
  await window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name: 'Due date', exact: true })
    .click()
  await window.keyboard.press('Escape')
  await expect(ordering).toBeHidden()
  await expect(slot(FILLED)).toHaveAttribute('data-tone', 'overdue')
}

const writes = async () => (await counts(app)).edits

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

/** Clicks a row, then closes the Peek the click opened, which would narrow the Tree under the width the slots need. */
async function pick(row: RegExp) {
  await item(row).click()
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
}

const width = async (row: RegExp) => (await slot(row).boundingBox())?.width

test('a click on an empty slot opens the editor beside it, focused, and not the Peek', async () => {
  await open()
  const before = await width(EMPTY)
  await slot(EMPTY).click()

  await expect(editor()).toBeVisible()
  await expect(field()).toBeFocused()
  await expect(peek()).toHaveCount(0)
  await expect(item(EMPTY)).toHaveAttribute('data-active', 'true')
  // Below the slot, and the slot keeps its width.
  const cell = await slot(EMPTY).boundingBox()
  const box = await editor().boundingBox()
  if (cell === null || box === null) throw new Error('the slot or the editor is not drawn')
  expect(box.y).toBeGreaterThanOrEqual(cell.y + cell.height - 1)
  expect(await width(EMPTY)).toBe(before)
  await window.keyboard.press('Escape')
  await expect(editor()).toHaveCount(0)
  expect(await width(EMPTY)).toBe(before)
})

test('Enter saves the date at once, closes the editor and returns focus to the Tree', async () => {
  await open()
  const before = await writes()

  await slot(EMPTY).click()
  await field().fill('2099-01-01')
  await window.keyboard.press('Enter')

  await expect(editor()).toHaveCount(0)
  // The slot shows the date and its tone before Jira answers.
  await expect(slot(EMPTY)).toHaveAttribute('data-tone', 'later')
  await expect(slot(EMPTY)).toHaveAttribute('title', 'Due 2099-01-01 (Shift+D)')
  await settle(before + 1)
  expect((await fieldsOf(app, 'PSAPAC-11'))?.duedate).toBe('2099-01-01')
  await expect(tree()).toBeFocused()
  await expect(peek()).toHaveCount(0)
})

test('the editor stays open while the date field is in use and sends nothing until Enter or leaving', async () => {
  await open()
  const before = await writes()

  await slot(EMPTY).click()
  await field().click()
  await expect(editor()).toBeVisible()
  await field().fill('2099-01-01')
  // A date typed digit by digit is a valid date after each digit of the year: none is sent.
  await field().focus()
  await window.keyboard.press('ArrowUp')
  await expect(editor()).toBeVisible()
  await expect(field()).toBeFocused()
  expect(await writes()).toBe(before)
})

test('leaving the field with a date typed saves it', async () => {
  await open()
  const before = await writes()

  await slot(EMPTY).click()
  await field().fill('2099-02-03')
  // A press on another row blurs the field, which sends the date, and then closes the editor.
  await item(/PSAPAC-10,/).click({ position: { x: 40, y: 8 } })

  await expect(editor()).toHaveCount(0)
  await settle(before + 1)
  expect((await fieldsOf(app, 'PSAPAC-11'))?.duedate).toBe('2099-02-03')
})

test('Esc drops a typed date: nothing is sent and the slot is as it was', async () => {
  await open()
  const before = await writes()

  await slot(EMPTY).click()
  await field().fill('2099-01-01')
  await window.keyboard.press('Escape')

  await expect(editor()).toHaveCount(0)
  await expect(slot(EMPTY)).not.toHaveAttribute('data-tone', /.+/)
  await expect(tree()).toBeFocused()
  expect(await writes()).toBe(before)
})

test('Clear removes the date', async () => {
  await open()
  const before = await writes()
  await expect(slot(FILLED)).toHaveAttribute('data-tone', 'overdue')

  await slot(FILLED).click()
  await expect(field()).toHaveValue('2020-01-02')
  await editor().getByRole('button', { name: 'Clear' }).click()

  await expect(editor()).toHaveCount(0)
  await expect(slot(FILLED)).not.toHaveAttribute('data-tone', /.+/)
  await settle(before + 1)
  expect((await fieldsOf(app, 'PSAPAC-40'))?.duedate).toBeNull()
})

test('Clear after a typed date sends one write, the clear', async () => {
  await open()
  const before = await writes()

  await slot(FILLED).click()
  await field().fill('2099-05-06')
  await editor().getByRole('button', { name: 'Clear' }).click()

  await expect(editor()).toHaveCount(0)
  await settle(before + 1)
  expect((await fieldsOf(app, 'PSAPAC-40'))?.duedate).toBeNull()
  expect(await writes()).toBe(before + 1)
})

test('Shift+D opens the editor on the active row and the keyboard alone saves', async () => {
  await open()
  const before = await writes()

  await pick(EMPTY)
  await window.keyboard.press('Shift+D')

  await expect(field()).toBeFocused()
  await field().fill('2099-03-04')
  await window.keyboard.press('Enter')
  await expect(editor()).toHaveCount(0)
  await settle(before + 1)
  expect((await fieldsOf(app, 'PSAPAC-11'))?.duedate).toBe('2099-03-04')
  await expect(tree()).toBeFocused()
})

test('a refused write puts the date back and the toast offers Retry', async () => {
  await open()
  await refuseKeys(app, ['PSAPAC-11'])
  const before = await writes()

  await slot(EMPTY).click()
  await field().fill('2099-01-01')
  await window.keyboard.press('Enter')
  await expect(slot(EMPTY)).toHaveAttribute('data-tone', 'later')
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Due date not changed')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(slot(EMPTY)).not.toHaveAttribute('data-tone', /.+/)
})

test('a Hold row stays editable', async () => {
  await moveIssue(app, 'PSAPAC-11', 'hold')
  await open()
  const before = await writes()

  await slot(EMPTY).click()
  await field().fill('2099-01-01')
  await window.keyboard.press('Enter')

  await expect(slot(EMPTY)).toHaveAttribute('data-tone', 'later')
  await settle(before + 1)
})

test('holds its layout with a wide font: the slot keeps its width and the editor fits the window', async () => {
  await open()
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })
  const before = await width(EMPTY)

  await slot(EMPTY).click()
  await expect(editor()).toBeVisible()
  const fits = await editor().evaluate((el) => {
    const box = el.getBoundingClientRect()
    const input = el.querySelector('input')
    return {
      inside:
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= globalThis.innerWidth &&
        box.bottom <= globalThis.innerHeight,
      clipped: input === null || input.scrollWidth > input.clientWidth + 0.5,
    }
  })
  expect(fits).toEqual({ inside: true, clipped: false })
  expect(await width(EMPTY)).toBe(before)
})
