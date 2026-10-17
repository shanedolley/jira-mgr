/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

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
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const slot = (row: RegExp) => item(row).locator('[data-prop=labels]')
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const listbox = () => window.getByRole('listbox', { name: 'Labels' })
const search = () => window.getByRole('combobox', { name: 'Search Labels' })
const option = (name: string) => listbox().getByRole('option', { name, exact: true })
/** The open list, drawn by the cell editor against the clicked slot. */
const popover = () => window.locator('.menu:popover-open')
const sidebar = () => window.getByRole('navigation', { name: 'Main' })

/**
 * The open list sits below `cell`, aligned to its left edge or, where the slot is near the window's
 * right edge and the list flips (`flip-inline`), to its right edge, and stays inside the window.
 */
async function expectBeside(cell: Locator) {
  const slotBox = await cell.boundingBox()
  const list = await popover().boundingBox()
  if (slotBox === null || list === null) throw new Error('the slot or the list is not drawn')
  expect(list.y).toBeGreaterThanOrEqual(slotBox.y + slotBox.height - 1)
  const leftAligned = Math.abs(list.x - slotBox.x) <= 4
  const rightAligned = Math.abs(list.x + list.width - (slotBox.x + slotBox.width)) <= 4
  expect(leftAligned || rightAligned).toBe(true)
  const width = await window.evaluate(() => globalThis.innerWidth)
  expect(list.x + list.width).toBeLessThanOrEqual(width)
}

/** PSAPAC-3 has no label. PSAPAC-11 has `docs`, the only label in the project. */
const EMPTY = /PSAPAC-3,/
const FILLED = /PSAPAC-11,/

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
  // Labels is not a default Display property.
  await window.getByRole('button', { name: 'Display', exact: true }).click()
  await window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name: 'Labels', exact: true })
    .click()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('group', { name: 'Ordering', exact: true })).toBeHidden()
  await expect(slot(FILLED)).toHaveText('docs')
}

/** Resizes the window's content, as `narrow.test.ts` does. Under 700px of Tree the row properties hide. */
async function resize(width: number, height = 700) {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.setMinimumSize(1, 1)
      win?.setContentSize(w ?? 0, h ?? 0)
    },
    [width, height],
  )
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width)
}

/** Whether any labels slot carries the cell editor's anchor, which an open cell editor gives its cell. */
const slotAnchored = () =>
  window.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('[data-pick=labels]')].filter(
        (cell) => cell.style.getPropertyValue('anchor-name') !== '',
      ).length > 0,
  )

const writes = async () => (await counts(app)).edits
const labelsOf = async (key: string) => ((await fieldsOf(app, key)) as { labels: string[] }).labels

/** Lets the fake Jira answer the next `n` edits, in the order they arrive, then waits for them to land. */
async function settle(from: number, n: number) {
  for (let i = 1; i <= n; i++) {
    await expect.poll(writes).toBeGreaterThanOrEqual(from + i)
    await releaseEdit(app)
    await expect.poll(async () => (await counts(app)).applied).toBeGreaterThanOrEqual(from + i)
  }
}

test('a click on a filled slot opens the list beside the slot and not the Peek', async () => {
  await open()
  await slot(FILLED).click()

  await expect(listbox()).toBeVisible()
  await expect(search()).toBeFocused()
  await expect(peek()).toHaveCount(0)
  await expect(item(FILLED)).toHaveAttribute('data-active', 'true')
  await expect(option('docs')).toHaveAttribute('aria-selected', 'true')
  await expectBeside(slot(FILLED))
})

test('a click on an empty slot opens the same list', async () => {
  await open()
  await expect(slot(EMPTY)).toHaveText('')
  await expect(slot(EMPTY)).toHaveAttribute('title', 'Add labels')
  await slot(EMPTY).click()

  await expect(listbox()).toBeVisible()
  await expect(peek()).toHaveCount(0)
  await expect(item(EMPTY)).toHaveAttribute('data-active', 'true')
  await expect(option('docs')).toHaveAttribute('aria-selected', 'false')
})

test('the list stays open across toggles, each one shows at once, and Esc returns focus to the Tree', async () => {
  await open()
  const before = await writes()

  await slot(EMPTY).click()
  await option('docs').click()
  // The slot shows the label before Jira answers, and the list is still open.
  await expect(slot(EMPTY)).toHaveText('docs')
  await expect(listbox()).toBeVisible()
  await expect(option('docs')).toHaveAttribute('aria-selected', 'true')

  await option('docs').click()
  await expect(slot(EMPTY)).toHaveText('')
  await expect(listbox()).toBeVisible()
  await option('docs').click()
  await expect(slot(EMPTY)).toHaveText('docs')

  await window.keyboard.press('Escape')
  await expect(listbox()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(item(EMPTY)).toHaveAttribute('data-active', 'true')
  await expect(peek()).toHaveCount(0)

  await settle(before, 3)
  expect(await labelsOf('PSAPAC-3')).toEqual(['docs'])
})

test('a new label is created from the typed text and the slot counts the rest', async () => {
  await open()
  const before = await writes()

  await slot(FILLED).click()
  await search().fill('needs review')
  // A label holds no space, so nothing is offered to create.
  await expect(window.getByRole('option', { name: /^Create/ })).toHaveCount(0)
  await search().fill('triage')
  await expect(window.getByRole('option', { name: 'Create "triage"' })).toBeVisible()
  await window.keyboard.press('Enter')

  // One chip for the first label and +1 for the other.
  await expect(slot(FILLED)).toHaveText('docs+1')
  await expect(slot(FILLED)).toHaveAttribute('title', 'docs, triage')
  await expect(listbox()).toBeVisible()
  await window.keyboard.press('Escape')
  await settle(before, 1)
  expect(await labelsOf('PSAPAC-11')).toEqual(['docs', 'triage'])

  // Another issue now offers the new label.
  await slot(EMPTY).click()
  await expect(option('triage')).toBeVisible()
})

test('a click outside closes the list, a second click on the slot closes it too, and neither writes', async () => {
  await open()
  const before = await writes()

  await slot(EMPTY).click()
  await expect(listbox()).toBeVisible()
  await sidebar()
    .getByRole('link', { name: /^Issues/ })
    .click()
  await expect(listbox()).toHaveCount(0)

  await slot(EMPTY).click()
  await expect(listbox()).toBeVisible()
  await slot(EMPTY).click()
  await expect(listbox()).toHaveCount(0)
  // It stays closed: the click that closed it did not open it again.
  await window.waitForTimeout(300)
  await expect(listbox()).toHaveCount(0)
  expect(await writes()).toBe(before)
})

test('a click on the slot selects no text and arms no double-click', async () => {
  await open()
  await slot(EMPTY).dblclick()
  await expect(peek()).toHaveCount(0)
  await expect(window.getByRole('region', { name: 'Issue page' })).toHaveCount(0)
  expect(await window.evaluate(() => document.getSelection()?.toString())).toBe('')
  await expect(slot(EMPTY)).toHaveCSS('user-select', 'none')
})

test('L opens the list on the active row, and the keyboard alone toggles a label', async () => {
  await open()
  await item(EMPTY).click()
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  // The Tree refits its columns a render after the Peek closes; until then the slot is 0px wide and
  // L would open the Peek picker.
  await expect
    .poll(async () => (await slot(EMPTY).boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(16)
  const before = await writes()

  await window.keyboard.press('l')
  await expect(listbox()).toBeVisible()
  await expect(search()).toBeFocused()
  await expect(peek()).toHaveCount(0)
  await expectBeside(slot(EMPTY))

  await window.keyboard.press('Enter')
  await expect(slot(EMPTY)).toHaveText('docs')
  await expect(listbox()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(tree()).toBeFocused()
  await settle(before, 1)
  expect(await labelsOf('PSAPAC-3')).toEqual(['docs'])
})

test('L opens the Peek picker when a narrow Tree hides the slot, and anchors nothing to it', async () => {
  await open()
  await item(EMPTY).click()
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)

  // Under 700px of Tree the row properties are not drawn.
  await resize(720)
  await expect(slot(EMPTY)).toBeHidden()
  await window.keyboard.press('l')

  await expect(peek()).toBeVisible()
  await expect(peek().getByRole('button', { name: /^Labels:/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(search()).toBeFocused()
  expect(await slotAnchored()).toBe(false)
})

test('L pressed in the Peek opens the Peek picker, not the Tree row cell', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await expect(peek()).toBeVisible()
  // Focus inside the Peek, on its summary button, so the key does not come from the Tree.
  await peek().getByRole('button', { name: 'Migrate the dashboards' }).focus()
  await window.keyboard.press('l')

  await expect(peek().getByRole('listbox', { name: 'Labels' })).toBeVisible()
  await expect(search()).toBeFocused()
  expect(await slotAnchored()).toBe(false)
})

test('a Hold row stays editable', async () => {
  await moveIssue(app, 'PSAPAC-3', 'hold')
  await open()
  const before = await writes()

  await slot(EMPTY).click()
  await expect(listbox()).toBeVisible()
  // The row fades to 30%, but the list over it is not part of the row.
  const drawn = await popover().evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return opacity
  })
  expect(drawn).toBe(1)
  await option('docs').click()
  await expect(slot(EMPTY)).toHaveText('docs')
  await window.keyboard.press('Escape')
  await settle(before, 1)
  expect(await labelsOf('PSAPAC-3')).toEqual(['docs'])
})

test('the list is named Labels and the search field names itself', async () => {
  await open()
  await slot(EMPTY).click()
  await expect(listbox()).toHaveAccessibleName('Labels')
  await expect(listbox()).toHaveAttribute('aria-multiselectable', 'true')
  await expect(search()).toBeFocused()
})

test('a refused label puts that one label back and the toast offers Retry', async () => {
  await open()
  await refuseKeys(app, ['PSAPAC-3'])
  const before = await writes()

  await slot(EMPTY).click()
  await option('docs').click()
  await expect(slot(EMPTY)).toHaveText('docs')
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Labels not changed')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(slot(EMPTY)).toHaveText('')
  expect(await labelsOf('PSAPAC-3')).toEqual([])
})

test('holds its layout with a wide font: the slot keeps its width and the list fits the window', async () => {
  await open()
  const width = (await slot(FILLED).boundingBox())?.width
  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })

  expect((await slot(FILLED).boundingBox())?.width).toBe(width)

  await slot(FILLED).click()
  await expect(listbox()).toBeVisible()
  const fits = await popover().evaluate((list) => {
    const box = list.getBoundingClientRect()
    const clipped = [...list.querySelectorAll('[role=option]')].filter(
      (o) => o.scrollWidth > o.clientWidth + 0.5,
    ).length
    return {
      left: box.left >= 0,
      right: box.right <= document.documentElement.clientWidth,
      bottom: box.bottom <= document.documentElement.clientHeight,
      clipped,
    }
  })
  expect(fits).toEqual({ left: true, right: true, bottom: true, clipped: 0 })
})

const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
/** The Sprint page's labels slot, a button beside the row's own, named for its labels. */
const sprintSlot = (key: string, labels: string) =>
  sprintPage().getByRole('button', { name: `Labels of ${key}: ${labels}` })

/** Only PSAPAC-13 starts in the active sprint; the rest join it, as in the cell tests. */
const MEMBERS = [
  'PSAPAC-1',
  'PSAPAC-2',
  'PSAPAC-4',
  'PSAPAC-11',
  'PSAPAC-13',
  'PSAPAC-14',
  'PSAPAC-22',
]

async function openSprint() {
  await joinSprint(app, MEMBERS, 5)
  await open()
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
  await expect(sprintPage().getByRole('status')).toHaveText('7 issues')
}

/** Whether focus is on `page` or inside it. */
const focusWithin = (page: ReturnType<typeof sprintPage>) =>
  page.evaluate((el) => el.contains(document.activeElement))

test('a click on a Sprint page labels slot, filled or empty, opens the list beside it and not the issue', async () => {
  await openSprint()
  await expect(sprintSlot('PSAPAC-4', 'none')).toBeVisible()
  await sprintSlot('PSAPAC-11', 'docs').click()

  await expect(listbox()).toBeVisible()
  await expect(search()).toBeFocused()
  await expect(issuePage()).toHaveCount(0)
  await expect(option('docs')).toHaveAttribute('aria-selected', 'true')
  await expectBeside(sprintSlot('PSAPAC-11', 'docs'))
  await window.keyboard.press('Escape')
  await expect(listbox()).toHaveCount(0)

  await sprintSlot('PSAPAC-4', 'none').click()
  await expect(listbox()).toBeVisible()
  await expect(option('docs')).toHaveAttribute('aria-selected', 'false')
})

test('the Sprint page list stays open across toggles, renames the slot at once and returns focus to the page', async () => {
  await openSprint()
  const before = await writes()

  await sprintSlot('PSAPAC-4', 'none').click()
  await option('docs').click()
  await expect(sprintSlot('PSAPAC-4', 'docs')).toBeVisible()
  await expect(listbox()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(listbox()).toHaveCount(0)

  await settle(before, 1)
  expect(await labelsOf('PSAPAC-4')).toEqual(['docs'])
  await expect.poll(() => focusWithin(sprintPage())).toBe(true)
  await expect(issuePage()).toHaveCount(0)
})

test('the Sprint page slot is in the tab order and Enter opens the list', async () => {
  await openSprint()
  await sprintSlot('PSAPAC-4', 'none').focus()
  await window.keyboard.press('Enter')
  await expect(listbox()).toBeVisible()
  await expect(listbox()).toHaveAccessibleName('Labels')
  await expect(issuePage()).toHaveCount(0)
})

test('a refused label on the Sprint page puts the slot back and the toast offers Retry', async () => {
  await openSprint()
  await refuseKeys(app, ['PSAPAC-4'])
  const before = await writes()

  await sprintSlot('PSAPAC-4', 'none').click()
  await option('docs').click()
  await expect(sprintSlot('PSAPAC-4', 'docs')).toBeVisible()
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Labels not changed')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(sprintSlot('PSAPAC-4', 'none')).toBeVisible()
})

test('a Hold row on the Sprint page keeps its labels slot editable', async () => {
  await moveIssue(app, 'PSAPAC-4', 'hold')
  await openSprint()
  const before = await writes()

  await sprintSlot('PSAPAC-4', 'none').click()
  await expect(listbox()).toBeVisible()
  const drawn = await popover().evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return opacity
  })
  expect(drawn).toBe(1)
  await option('docs').click()
  await expect(sprintSlot('PSAPAC-4', 'docs')).toBeVisible()
  await window.keyboard.press('Escape')
  await settle(before, 1)
})
