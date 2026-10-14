import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { launch, logIn, notices, readState, showEverything } from './harness.js'

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

interface Display {
  properties: string[]
  order: string
  direction: string
  manual?: string[]
}

const tree = () => window.getByRole('tree', { name: 'Issues' })
/** A row by its key, anchored so PSAPAC-4 does not match PSAPAC-40. */
const row = (n: number) =>
  tree().getByRole('treeitem', { name: new RegExp(`^PSAPAC-${String(n)},`) })
const heard = () => window.getByRole('status', { name: 'Notice' })
const displayButton = () => window.getByRole('button', { name: 'Display', exact: true })
const choice = (group: string, name: string) =>
  window.getByRole('group', { name: group, exact: true }).getByRole('button', { name, exact: true })

const savedDisplay = async () =>
  (await readState<{ display?: Display }>(stateDir, 'settings.json'))?.display
const savedViews = async () =>
  (await readState<{ id: string; name: string; display?: Display }[]>(stateDir, 'views.json')) ?? []

/** Epic PSAPAC-10 holds these six, newest first under the default order. PSAPAC-12 hangs under PSAPAC-11. */
const SIBLINGS = [1, 2, 3, 4, 11, 13]
const DEFAULT = [13, 11, 12, 4, 3, 2, 1]

/** The keys of a manual list that belong to Epic PSAPAC-10's children, in list order. */
const ofEpic = (list: string[] | undefined) =>
  list?.filter((k) => SIBLINGS.includes(Number(k.slice(k.indexOf('-') + 1))))

/** The keys of the rows in the DOM that belong to Epic PSAPAC-10, top to bottom. */
async function epicOrder() {
  const keys = await Promise.all(
    (await tree().getByRole('treeitem').all()).map(
      async (r) => /PSAPAC-(\d+)/.exec((await r.getAttribute('aria-label')) ?? '')?.[1],
    ),
  )
  return keys.flatMap((k) =>
    k !== undefined && [...SIBLINGS, 12].includes(Number(k)) ? [Number(k)] : [],
  )
}

async function open() {
  await logIn(window)
  await expect(row(10)).toBeVisible()
  // PSAPAC-12 is a Subtask, which shows only from the Everything level.
  await showEverything(window)
  await expect(row(12)).toBeVisible()
}

async function inDisplayMenu(choose: () => Promise<void>) {
  await displayButton().click()
  await expect(window.getByRole('group', { name: 'Ordering', exact: true })).toBeVisible()
  await choose()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('group', { name: 'Ordering', exact: true })).toBeHidden()
}

async function throttle(rate: number) {
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
}

async function restart() {
  await app.close()
  ;({ app, window } = await launch(stateDir))
  await open()
}

test('Manual starts from the order on screen, and a drag moves a row among its siblings and survives a restart', async () => {
  await open()
  expect(await epicOrder()).toEqual(DEFAULT)
  await inDisplayMenu(async () => {
    await choice('Ordering', 'Manual').click()
    await expect(choice('Ordering', 'Manual')).toHaveAttribute('aria-pressed', 'true')
    // Direction does not apply to a hand-made order.
    await expect(choice('Direction', 'Ascending')).toBeDisabled()
    await expect(choice('Direction', 'Descending')).toBeDisabled()
  })
  // Choosing Manual changes no row, and names the order on screen.
  await expect.poll(epicOrder).toEqual(DEFAULT)
  await expect
    .poll(async () => ofEpic((await savedDisplay())?.manual))
    .toEqual(['PSAPAC-13', 'PSAPAC-11', 'PSAPAC-4', 'PSAPAC-3', 'PSAPAC-2', 'PSAPAC-1'])

  // PSAPAC-1 moves up onto PSAPAC-11, taking its place; the rest keep their order.
  await row(1).dragTo(row(11))
  await expect.poll(epicOrder).toEqual([13, 1, 11, 12, 4, 3, 2])
  await expect(row(1)).toHaveAttribute('data-active', 'true')
  await expect
    .poll(async () => ofEpic((await savedDisplay())?.manual))
    .toEqual(['PSAPAC-13', 'PSAPAC-1', 'PSAPAC-11', 'PSAPAC-4', 'PSAPAC-3', 'PSAPAC-2'])

  // A move down: PSAPAC-13 onto PSAPAC-4 lands after it.
  await row(13).dragTo(row(4))
  await expect.poll(epicOrder).toEqual([1, 11, 12, 4, 13, 3, 2])
  await expect(row(13)).toHaveAttribute('aria-posinset', '4')

  await restart()
  expect(await epicOrder()).toEqual([1, 11, 12, 4, 13, 3, 2])
  await inDisplayMenu(async () => {
    await expect(choice('Ordering', 'Manual')).toHaveAttribute('aria-pressed', 'true')
  })
  expect((await savedDisplay())?.order).toBe('manual')
})

test('dragging a row under another order switches to Manual, starting from the order on screen', async () => {
  await open()
  expect((await savedDisplay())?.order).toBe('key')
  await row(1).dragTo(row(13))
  await expect.poll(epicOrder).toEqual([1, 13, 11, 12, 4, 3, 2])
  await expect.poll(async () => (await savedDisplay())?.order).toBe('manual')
  await inDisplayMenu(async () => {
    await expect(choice('Ordering', 'Manual')).toHaveAttribute('aria-pressed', 'true')
    await expect(choice('Ordering', 'Key')).toHaveAttribute('aria-pressed', 'false')
  })
  // Every other level kept the order it had on screen: Customers stay alphabetical.
  await expect(tree().locator('[role=treeitem][aria-level="1"]').first()).toHaveAccessibleName(
    /^Acme,/,
  )
})

test('a drop shows a line where the row lands, and a drop outside the siblings does nothing', async () => {
  await open()
  const centre = async (n: number) => {
    const box = await row(n).boundingBox()
    if (box === null) throw new Error(`PSAPAC-${String(n)} has no box`)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  async function dragOver(from: number, to: number) {
    const start = await centre(from)
    await window.mouse.move(start.x, start.y)
    await window.mouse.down()
    const end = await centre(to)
    await window.mouse.move(end.x, end.y, { steps: 8 })
  }

  // Up: the line sits above the row the drag moves past.
  await dragOver(4, 11)
  await expect(row(11)).toHaveAttribute('data-drop', 'above')
  await expect(row(4)).toHaveAttribute('data-dragging', 'true')
  await window.mouse.up()
  await expect(row(11)).not.toHaveAttribute('data-drop', /.+/)
  await expect.poll(epicOrder).toEqual([13, 4, 11, 12, 3, 2, 1])

  // Down onto a row that shows its Subtask: the issue lands after the Subtask, and the line says so.
  await dragOver(13, 11)
  await expect(row(12)).toHaveAttribute('data-drop', 'below')
  await expect(row(11)).not.toHaveAttribute('data-drop', /.+/)
  await window.mouse.up()
  await expect.poll(epicOrder).toEqual([4, 11, 12, 13, 3, 2, 1])

  // Outside the siblings: another Epic's Story, the Epic's own row, and a Subtask of a sibling.
  const before = await savedDisplay()
  for (const target of [31, 10, 12]) {
    await dragOver(2, target)
    await expect(tree().locator('[data-drop]')).toHaveCount(0)
    await window.mouse.up()
    expect(await epicOrder()).toEqual([4, 11, 12, 13, 3, 2, 1])
  }
  expect(await savedDisplay()).toEqual(before)
  // Nothing was recorded for those drops: only the two moves above can be undone.
  await window.keyboard.press('Meta+z')
  await window.keyboard.press('Meta+z')
  await expect.poll(epicOrder).toEqual(DEFAULT)
  await window.keyboard.press('Meta+z')
  await expect(notices(window)).toContainText('Nothing to undo')
})

test('Alt+Shift with Up and Down moves the focused row, announces its position and stops at the ends', async () => {
  await open()
  await row(4).click()
  await expect(tree()).toBeFocused()
  await window.keyboard.press('Alt+Shift+ArrowUp')
  await expect.poll(epicOrder).toEqual([13, 4, 11, 12, 3, 2, 1])
  await expect(heard()).toHaveText('Moved PSAPAC-4 to position 2 of 6.')
  await expect(row(4)).toHaveAttribute('aria-posinset', '2')
  await expect(row(4)).toHaveAttribute('data-active', 'true')
  await window.keyboard.press('Alt+Shift+ArrowUp')
  await expect(heard()).toHaveText('Moved PSAPAC-4 to position 1 of 6.')
  await expect.poll(epicOrder).toEqual([4, 13, 11, 12, 3, 2, 1])

  // At the top the row stays, and the screen reader hears why.
  await window.keyboard.press('Alt+Shift+ArrowUp')
  await expect(heard()).toHaveText('PSAPAC-4 is already first among its siblings.')
  expect(await epicOrder()).toEqual([4, 13, 11, 12, 3, 2, 1])

  await window.keyboard.press('Alt+Shift+ArrowDown')
  await expect(heard()).toHaveText('Moved PSAPAC-4 to position 2 of 6.')
  // A row with a Subtask steps over it with the row.
  await window.keyboard.press('Alt+Shift+ArrowDown')
  await expect.poll(epicOrder).toEqual([13, 11, 12, 4, 3, 2, 1])
  await row(1).click()
  await window.keyboard.press('Alt+Shift+ArrowDown')
  await expect(heard()).toHaveText('PSAPAC-1 is already last among its siblings.')

  expect((await savedDisplay())?.order).toBe('manual')
  await restart()
  expect(await epicOrder()).toEqual([13, 11, 12, 4, 3, 2, 1])
})

test('quick key presses on a slow machine each move the row one place', async () => {
  await open()
  await row(1).click()
  await expect(tree()).toBeFocused()
  await throttle(20)
  for (let i = 0; i < 3; i++) await window.keyboard.press('Alt+Shift+ArrowUp')
  await throttle(1)
  await expect.poll(epicOrder).toEqual([13, 11, 12, 1, 4, 3, 2])
  await expect(heard()).toHaveText('Moved PSAPAC-1 to position 3 of 6.')
  await expect(row(1)).toHaveAttribute('aria-posinset', '3')
})

test('Undo puts the previous order back, one move at a time', async () => {
  await open()
  await row(4).click()
  await window.keyboard.press('Alt+Shift+ArrowUp')
  await window.keyboard.press('Alt+Shift+ArrowUp')
  await expect.poll(epicOrder).toEqual([4, 13, 11, 12, 3, 2, 1])

  await window.keyboard.press('Meta+z')
  await expect.poll(epicOrder).toEqual([13, 4, 11, 12, 3, 2, 1])
  await expect(notices(window)).toContainText('Undid the move of PSAPAC-4')
  await window.keyboard.press('Meta+z')
  await expect.poll(epicOrder).toEqual(DEFAULT)
  // The first move came from Key, so undoing it is Key again, with the order it had.
  await expect.poll(async () => (await savedDisplay())?.order).toBe('key')
  // Esc closes the Peek that the click opened, so the next one closes the menu.
  await window.keyboard.press('Escape')
  await inDisplayMenu(async () => {
    await expect(choice('Ordering', 'Key')).toHaveAttribute('aria-pressed', 'true')
  })
  await window.keyboard.press('Meta+z')
  await expect(notices(window)).toContainText('Nothing to undo')
})

test('each saved view keeps its own manual order, and the file gains one optional field', async () => {
  const createView = async (name: string) => {
    await window.getByRole('button', { name: 'New view' }).click()
    await window.getByLabel('New view name').fill(name)
    await window.keyboard.press('Enter')
    await expect(window.getByRole('list', { name: 'Saved views' })).toContainText(name)
  }
  const apply = (name: string) =>
    window.getByRole('list', { name: 'Saved views' }).getByRole('button', { name, exact: true })

  await open()
  await row(4).click()
  await window.keyboard.press('Alt+Shift+ArrowUp')
  await window.keyboard.press('Alt+Shift+ArrowUp')
  await expect.poll(epicOrder).toEqual([4, 13, 11, 12, 3, 2, 1])
  await createView('Ranked')

  await row(1).click()
  for (let i = 0; i < 5; i++) await window.keyboard.press('Alt+Shift+ArrowUp')
  await expect.poll(epicOrder).toEqual([1, 4, 13, 11, 12, 3, 2])
  await createView('Reversed')

  await expect
    .poll(async () => (await savedViews()).map((v) => v.name))
    .toEqual(expect.arrayContaining(['Ranked', 'Reversed']))
  const views = await savedViews()
  const named = (name: string) => views.find((v) => v.name === name)?.display
  expect(named('Ranked')?.order).toBe('manual')
  expect(ofEpic(named('Ranked')?.manual)).toEqual([
    'PSAPAC-4',
    'PSAPAC-13',
    'PSAPAC-11',
    'PSAPAC-3',
    'PSAPAC-2',
    'PSAPAC-1',
  ])
  expect(ofEpic(named('Reversed')?.manual)).toEqual([
    'PSAPAC-1',
    'PSAPAC-4',
    'PSAPAC-13',
    'PSAPAC-11',
    'PSAPAC-3',
    'PSAPAC-2',
  ])
  // A view with no display, such as a starter, gains nothing.
  expect(views.find((v) => v.name === 'Backlog')).not.toHaveProperty('display')

  await apply('Ranked').click()
  await expect.poll(epicOrder).toEqual([4, 13, 11, 12, 3, 2, 1])
  await apply('Reversed').click()
  await expect.poll(epicOrder).toEqual([1, 4, 13, 11, 12, 3, 2])

  await restart()
  await apply('Ranked').click()
  await expect.poll(epicOrder).toEqual([4, 13, 11, 12, 3, 2, 1])
})
