import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { joinSprint, launch, logIn, readState, showEverything } from './harness.js'

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

interface Display {
  properties: string[]
  order: string
  direction: string
  widths?: Record<string, number>
}

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const header = () => window.getByRole('group', { name: 'Column widths' })
const name = (property: string) => header().locator(`[data-col-name=${property}]`)
const displayButton = () => window.getByRole('button', { name: 'Display', exact: true })
const chip = (label: string) =>
  window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name: label, exact: true })
const view = (label: string) =>
  window
    .getByRole('list', { name: 'Saved views' })
    .getByRole('button', { name: label, exact: true })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })

const savedDisplay = async () =>
  (await readState<{ display?: Display }>(stateDir, 'settings.json'))?.display
const savedViews = async () =>
  (await readState<{ id: string; name: string; display?: Display }[]>(stateDir, 'views.json')) ?? []

const ROW = /PSAPAC-11,/
const WIDE_FONT = '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }'

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
}

/** Turns the named Display chips on or off, and closes the menu. */
async function toggle(...labels: string[]) {
  await displayButton().click()
  await expect(chip('Updated')).toBeVisible()
  for (const label of labels) await chip(label).click()
  await window.keyboard.press('Escape')
  await expect(chip('Updated')).toBeHidden()
}

/** The property of each Column header name, left to right. */
const headerOrder = () =>
  header()
    .locator('[data-col]')
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-col')))

/** The property of each slot in a Tree row, left to right. */
const rowOrder = () =>
  item(ROW)
    .locator('[data-prop]')
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-prop')))

const centre = async (locator: ReturnType<typeof name>) => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('not on screen')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, right: box.x + box.width }
}

/** A press on `property`'s name and a move to the x `target` reads once the press is down, the button still down. */
async function dragNameTo(property: string, target: () => Promise<number>) {
  // Wait for the layout to settle after the menu closes, so the press lands on the name.
  let from = await centre(name(property))
  await expect
    .poll(async () => {
      const now = await centre(name(property))
      const still = now.x === from.x && now.y === from.y
      from = now
      return still
    })
    .toBe(true)
  await window.mouse.move(from.x, from.y)
  await window.mouse.down()
  await window.mouse.move(from.x + 8, from.y)
  const x = await target()
  await window.mouse.move((from.x + x) / 2, from.y, { steps: 4 })
  await window.mouse.move(x, from.y, { steps: 4 })
}

/** The x just inside the right edge of `property`'s column, where a drop lands the dragged one after it. */
const rightOf = (property: string) => async () =>
  (await centre(header().locator(`[data-col=${property}]`))).right - 6

/** The x just inside the left edge of `property`'s column. */
const leftOf = (property: string) => async () =>
  (await centre(header().locator(`[data-col=${property}]`))).x - 30

async function setUp() {
  await open()
  // A property turned on goes last, so Updated is cycled to follow the other two.
  await toggle('Labels', 'Sprint', 'Updated', 'Updated')
  await expect.poll(headerOrder).toEqual(['labels', 'sprint', 'updated'])
}

test('drags a name to a new place with a drop line, saves once on release, and the rows follow', async () => {
  await setUp()
  expect(await rowOrder()).toEqual(['labels', 'sprint', 'updated'])

  await dragNameTo('labels', rightOf('updated'))
  // Held: the line shows beside the column it would land after, and nothing moves or saves yet.
  await expect(header().locator('[data-drop-line=after]')).toHaveCount(1)
  await expect(
    header().locator('[data-col=updated]').locator('[data-drop-line=after]'),
  ).toHaveCount(1)
  await expect(tree().locator('[data-dragging=true]')).toHaveCount(0)
  expect(await headerOrder()).toEqual(['labels', 'sprint', 'updated'])
  expect((await savedDisplay())?.properties).toEqual(['labels', 'sprint', 'updated'])
  await window.mouse.up()

  await expect.poll(headerOrder).toEqual(['sprint', 'updated', 'labels'])
  await expect.poll(rowOrder).toEqual(['sprint', 'updated', 'labels'])
  await expect
    .poll(async () => (await savedDisplay())?.properties)
    .toEqual(['sprint', 'updated', 'labels'])
  await expect(header().locator('[data-drop-line]')).toHaveCount(0)
  // A drag is a move, not a resize.
  expect((await savedDisplay())?.widths).toBeUndefined()
  // The title, the key and the avatar keep their places: only the strip changed.
  await expect(item(ROW).locator('[data-summary]')).toBeVisible()

  // The order survives a restart.
  await app.close()
  ;({ app, window } = await launch(stateDir, { TZ: 'Etc/UTC' }))
  await open()
  await expect.poll(headerOrder).toEqual(['sprint', 'updated', 'labels'])
  await expect.poll(rowOrder).toEqual(['sprint', 'updated', 'labels'])
})

test('drops before a column when dragged leftwards', async () => {
  await setUp()
  await dragNameTo('updated', leftOf('labels'))
  await expect(header().locator('[data-col=labels] [data-drop-line=before]')).toHaveCount(1)
  await window.mouse.up()
  await expect.poll(headerOrder).toEqual(['updated', 'labels', 'sprint'])
})

test('Escape cancels a drag, and a click on a name moves nothing', async () => {
  await setUp()
  await dragNameTo('labels', rightOf('updated'))
  await expect(header().locator('[data-drop-line]')).toHaveCount(1)
  await window.keyboard.press('Escape')
  await expect(header().locator('[data-drop-line]')).toHaveCount(0)
  await window.mouse.up()
  expect(await headerOrder()).toEqual(['labels', 'sprint', 'updated'])
  expect((await savedDisplay())?.properties).toEqual(['labels', 'sprint', 'updated'])

  await name('sprint').click()
  expect(await headerOrder()).toEqual(['labels', 'sprint', 'updated'])
  expect((await savedDisplay())?.properties).toEqual(['labels', 'sprint', 'updated'])
})

test('a name drag starts no resize and a separator drag starts no move', async () => {
  await setUp()
  await dragNameTo('sprint', rightOf('updated'))
  await window.mouse.up()
  await expect.poll(headerOrder).toEqual(['labels', 'updated', 'sprint'])
  expect((await savedDisplay())?.widths).toBeUndefined()

  const sep = window.getByRole('separator', { name: 'Resize Updated column' })
  const box = await sep.boundingBox()
  if (box === null) throw new Error('no separator')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await window.mouse.move(x, y)
  await window.mouse.down()
  await window.mouse.move(x - 60, y, { steps: 6 })
  await expect(header().locator('[data-drop-line]')).toHaveCount(0)
  await window.mouse.up()
  await expect.poll(async () => (await savedDisplay())?.widths).toEqual({ updated: 132 })
  expect(await headerOrder()).toEqual(['labels', 'updated', 'sprint'])
  expect((await savedDisplay())?.properties).toEqual(['labels', 'updated', 'sprint'])
})

test('Alt+Left and Alt+Right move a focused name one place, say where, and stop at the ends', async () => {
  await setUp()
  const said = header().locator('[aria-live=polite]')
  await name('labels').focus()
  // At the first place, Alt+Left does nothing.
  await window.keyboard.press('Alt+ArrowLeft')
  expect(await headerOrder()).toEqual(['labels', 'sprint', 'updated'])
  await expect(said).toHaveText('')

  await window.keyboard.press('Alt+ArrowRight')
  await expect(said).toHaveText('Labels moved to position 2 of 3')
  await expect.poll(headerOrder).toEqual(['sprint', 'labels', 'updated'])
  await expect.poll(rowOrder).toEqual(['sprint', 'labels', 'updated'])
  await expect(name('labels')).toBeFocused()
  await window.keyboard.press('Alt+ArrowRight')
  await expect(said).toHaveText('Labels moved to position 3 of 3')
  await expect(name('labels')).toBeFocused()
  await window.keyboard.press('Alt+ArrowRight')
  await expect(said).toHaveText('Labels moved to position 3 of 3')
  await expect
    .poll(async () => (await savedDisplay())?.properties)
    .toEqual(['sprint', 'updated', 'labels'])
  await window.keyboard.press('Alt+ArrowLeft')
  await expect(said).toHaveText('Labels moved to position 2 of 3')
  await expect
    .poll(async () => (await savedDisplay())?.properties)
    .toEqual(['sprint', 'labels', 'updated'])
})

test('the Display menu appends a new property and keeps the order of the others', async () => {
  await setUp()
  await name('labels').focus()
  await window.keyboard.press('Alt+ArrowRight')
  await window.keyboard.press('Alt+ArrowRight')
  await expect.poll(headerOrder).toEqual(['sprint', 'updated', 'labels'])
  await toggle('Due date')
  await expect.poll(headerOrder).toEqual(['sprint', 'updated', 'labels', 'due'])
  await toggle('Sprint')
  await expect.poll(headerOrder).toEqual(['updated', 'labels', 'due'])
  await expect
    .poll(async () => (await savedDisplay())?.properties)
    .toEqual(['updated', 'labels', 'due'])
})

test('the Sprint page draws the order the Tree set', async () => {
  await joinSprint(app, ['PSAPAC-3', 'PSAPAC-4', 'PSAPAC-13'], 5)
  await setUp()
  await name('labels').focus()
  await window.keyboard.press('Alt+ArrowRight')
  await window.keyboard.press('Alt+ArrowRight')
  await expect
    .poll(async () => (await savedDisplay())?.properties)
    .toEqual(['sprint', 'updated', 'labels'])
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  const row = sprintPage().locator('[data-issue-key=PSAPAC-13]')
  await expect(row).toBeVisible()
  const names = sprintPage().locator('[data-column-names] [data-col]')
  await expect(names).toHaveCount(3)
  expect(await names.evaluateAll((cells) => cells.map((c) => c.getAttribute('data-col')))).toEqual([
    'sprint',
    'updated',
    'labels',
  ])
  const slots = await row
    .locator('[data-prop]')
    .evaluateAll((cells) => cells.map((c) => c.getAttribute('data-prop')))
  expect(slots.filter((p) => ['sprint', 'updated', 'labels'].includes(p ?? ''))).toEqual([
    'sprint',
    'updated',
    'labels',
  ])
})

test('a view saves its own column order and applying it restores it', async () => {
  await setUp()
  await window.getByRole('button', { name: 'New view' }).click()
  await window.getByLabel('New view name').fill('Triage')
  await window.keyboard.press('Enter')
  await expect(view('Triage')).toHaveAttribute('aria-current', 'true')
  const update = window.getByRole('button', { name: 'Update view Triage', exact: true })
  await expect(update).toBeDisabled()

  await name('labels').focus()
  await window.keyboard.press('Alt+ArrowRight')
  // The view stays lit and offers to save the new order.
  await expect(view('Triage')).toHaveAttribute('aria-current', 'true')
  await expect(update).toBeEnabled()
  await update.click()
  await expect
    .poll(async () => (await savedViews()).find((v) => v.name === 'Triage')?.display?.properties)
    .toEqual(['sprint', 'labels', 'updated'])

  // Another order, then the view puts its own back.
  await name('labels').focus()
  await window.keyboard.press('Alt+ArrowRight')
  await expect.poll(headerOrder).toEqual(['sprint', 'updated', 'labels'])
  await view('Triage').click()
  await expect.poll(headerOrder).toEqual(['sprint', 'labels', 'updated'])
  await expect.poll(rowOrder).toEqual(['sprint', 'labels', 'updated'])
})

test('drags a name in a wide font and keeps the header lined up with the rows', async () => {
  await setUp()
  await window.addStyleTag({ content: WIDE_FONT })
  await dragNameTo('labels', rightOf('updated'))
  await window.mouse.up()
  await expect.poll(headerOrder).toEqual(['sprint', 'updated', 'labels'])
  const edges = async () => ({
    header: await header()
      .locator('[data-col]')
      .evaluateAll((cells) => cells.map((c) => Math.round(c.getBoundingClientRect().left))),
    row: await item(ROW)
      .locator('[data-prop]')
      .evaluateAll((cells) => cells.map((c) => Math.round(c.getBoundingClientRect().left))),
  })
  await expect
    .poll(async () => {
      const { header: h, row: r } = await edges()
      return h.map((left, i) => Math.abs(left - (r[i] ?? Infinity)) <= 1)
    })
    .toEqual([true, true, true])
})

/**
 * Counts the `settings:setDisplay` calls the main process gets from now on, by wrapping the
 * handler Electron holds for the channel.
 */
async function countSetDisplay() {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> }
    )._invokeHandlers
    const original = handlers.get('settings:setDisplay')
    if (original === undefined) throw new Error('no settings:setDisplay handler')
    const counter = globalThis as unknown as { setDisplayCalls?: number }
    counter.setDisplayCalls = 0
    handlers.set('settings:setDisplay', (...args: unknown[]) => {
      counter.setDisplayCalls = (counter.setDisplayCalls ?? 0) + 1
      return original(...args)
    })
  })
  return () =>
    app.evaluate(() => (globalThis as unknown as { setDisplayCalls?: number }).setDisplayCalls ?? 0)
}

test('a drag writes the display once, on release', async () => {
  await setUp()
  const calls = await countSetDisplay()
  await dragNameTo('labels', rightOf('updated'))
  // Held across several pointer moves: nothing has been written.
  await expect(header().locator('[data-drop-line=after]')).toHaveCount(1)
  expect(await calls()).toBe(0)
  await window.mouse.up()
  await expect.poll(headerOrder).toEqual(['sprint', 'updated', 'labels'])
  await expect
    .poll(async () => (await savedDisplay())?.properties)
    .toEqual(['sprint', 'updated', 'labels'])
  // Give a stray second write time to arrive before counting.
  await window.waitForTimeout(500)
  expect(await calls()).toBe(1)
})

test('a click on a name leaves it focused, so Alt+Arrow works at once', async () => {
  await setUp()
  await name('labels').click()
  await expect(name('labels')).toBeFocused()
  await window.keyboard.press('Alt+ArrowRight')
  await expect.poll(headerOrder).toEqual(['sprint', 'labels', 'updated'])
  await expect(name('labels')).toBeFocused()
})

test('a press on a separator while a name moves starts no resize and does not cancel the move', async () => {
  await setUp()
  await dragNameTo('labels', rightOf('updated'))
  await expect(header().locator('[data-drop-line=after]')).toHaveCount(1)
  // A second press on the same pointer, as a touch or a stray event would send.
  await window.getByRole('separator', { name: 'Resize Sprint column' }).evaluate((el) => {
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, isPrimary: true }),
    )
  })
  await expect(header().locator('[data-drop-line=after]')).toHaveCount(1)
  await window.mouse.up()
  await expect.poll(headerOrder).toEqual(['sprint', 'updated', 'labels'])
  expect((await savedDisplay())?.widths).toBeUndefined()
})
