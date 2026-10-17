import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

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
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const prop = (key: RegExp, name: string) => item(key).locator(`[data-prop=${name}]`)
const header = () => window.getByRole('group', { name: 'Column widths' })
const headerCell = (name: string) => header().locator(`[data-col=${name}]`)
const separator = (label: string) =>
  window.getByRole('separator', { name: `Resize ${label} column` })
const displayButton = () => window.getByRole('button', { name: 'Display', exact: true })
const chip = (name: string) =>
  window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name, exact: true })
const view = (name: string) =>
  window.getByRole('list', { name: 'Saved views' }).getByRole('button', { name, exact: true })
const update = (name: string) =>
  window.getByRole('button', { name: `Update view ${name}`, exact: true })
const sidebar = () => window.getByRole('navigation', { name: 'Main' })
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
async function toggle(...names: string[]) {
  await displayButton().click()
  await expect(chip('Updated')).toBeVisible()
  for (const name of names) await chip(name).click()
  await window.keyboard.press('Escape')
  await expect(chip('Updated')).toBeHidden()
}

const widthOf = async (locator: Locator) => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('not on screen')
  return box.width
}

/** A press on the separator and a move of `dx` pixels, the button still down. */
async function dragBy(label: string, dx: number) {
  const box = await separator(label).boundingBox()
  if (box === null) throw new Error('no separator')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  // The pointer stays inside the window, where a mouse can go.
  const edge = (await window.evaluate(() => globalThis.innerWidth)) - 1
  const to = Math.min(Math.max(x + dx, 1), edge)
  await window.mouse.move(x, y)
  await window.mouse.down()
  await window.mouse.move((x + to) / 2, y, { steps: 4 })
  await window.mouse.move(to, y, { steps: 4 })
}

/** Slows the renderer, so a render a drag should not need would show as a lag. */
async function throttle(rate: number) {
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
}

/** Sets the window's size, below the app's own minimum if need be. */
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

/**
 * What is wrong with the header now: a column whose name does not sit over its slots (left or right
 * edge off by more than a pixel), in any issue row, or a title under its 5rem.
 */
async function misaligned(properties: string[]) {
  const header = await window.locator('[data-column-header] [data-col]').evaluateAll((cells) =>
    Object.fromEntries(
      cells.map((cell) => {
        const r = cell.getBoundingClientRect()
        return [cell.getAttribute('data-col') ?? '', { left: r.left, right: r.right }]
      }),
    ),
  )
  return tree()
    .getByRole('treeitem')
    .evaluateAll(
      (rows, [names, columns]) =>
        rows
          .filter((row) => row.querySelector('.tree-key') !== null)
          .flatMap((row) => {
            const found: string[] = []
            const title = row.querySelector('[data-summary]')?.getBoundingClientRect().width ?? 0
            if (title < 80) found.push(`title ${String(title)}`)
            for (const name of names) {
              const cell = row.querySelector(`[data-prop=${name}]`)?.getBoundingClientRect()
              const over = (columns as Record<string, { left: number; right: number }>)[name]
              if (cell === undefined || over === undefined) found.push(`${name} missing`)
              else if (Math.abs(cell.left - over.left) > 1 || Math.abs(cell.right - over.right) > 1)
                found.push(
                  `${name} ${String(cell.left - over.left)}/${String(cell.right - over.right)}`,
                )
            }
            return found
          }),
      [properties, header] as const,
    )
}

test('names each Display property above the list, with a separator, lined up with the row slots', async () => {
  await open()
  await toggle('Labels', 'Sprint', 'Start date', 'Due date', 'Created')
  await expect(prop(ROW, 'labels')).toBeVisible()
  const names = ['Labels', 'Sprint', 'Start date', 'Due date', 'Created', 'Updated']
  await expect(header()).toBeVisible()
  await expect(header()).toHaveText(names.join(''))
  for (const name of names) await expect(separator(name)).toHaveAttribute('role', 'separator')
  await expect(window.getByRole('separator')).toHaveCount(names.length)
  const props = ['labels', 'sprint', 'start', 'due', 'created', 'updated']
  expect(await misaligned(props)).toEqual([])

  // The key, status, priority and avatar keep their anatomy and get no header.
  await expect(header().locator('[data-col]')).toHaveCount(props.length)
})

test('lines the header up with the rows in a wide font, with a scrollbar, and at a narrower window', async () => {
  await open()
  await toggle('Labels', 'Sprint', 'Start date', 'Due date', 'Created')
  await expect(prop(ROW, 'labels')).toBeVisible()
  const style = await window.addStyleTag({ content: WIDE_FONT })
  const props = ['labels', 'sprint', 'start', 'due', 'created', 'updated']
  // A short window makes the list scroll, so its scrollbar takes room on Linux (15px) and none on macOS.
  for (const [width, height] of [
    [1200, 700],
    [1200, 380],
    [1000, 380],
  ] as const) {
    await resize(width, height)
    await expect.poll(() => misaligned(props)).toEqual([])
  }
  const scroller = await tree().evaluate((el) => ({
    scrolls: el.scrollHeight > el.clientHeight,
    bar: (el as HTMLElement).offsetWidth - el.clientWidth,
  }))
  expect(scroller.scrolls).toBe(true)
  expect(scroller.bar).toBeGreaterThanOrEqual(0)
  await style.evaluate((node) => {
    node.parentNode?.removeChild(node)
  })
})

test('drags a separator to resize its column, repaints without saving, and saves on release', async () => {
  await open()
  await toggle('Labels')
  const before = {
    column: await widthOf(prop(ROW, 'labels')),
    title: await widthOf(item(ROW).locator('[data-summary]')),
  }
  expect(before.column).toBe(96)

  await dragBy('Labels', -40)
  // The pointer is still down: every row repaints at once and nothing is saved yet.
  await expect.poll(() => widthOf(prop(ROW, 'labels'))).toBe(136)
  await expect.poll(() => widthOf(headerCell('labels'))).toBe(136)
  expect(await widthOf(item(ROW).locator('[data-summary]'))).toBeCloseTo(before.title - 40, 0)
  await expect(separator('Labels')).toHaveAttribute('aria-valuenow', '136')
  expect((await savedDisplay())?.widths).toBeUndefined()
  await window.mouse.up()

  await expect.poll(async () => (await savedDisplay())?.widths).toEqual({ labels: 136 })
  expect((await savedDisplay())?.properties).toEqual(['labels', 'updated'])
  await expect(prop(ROW, 'labels')).toBeVisible()
  expect(await widthOf(prop(ROW, 'labels'))).toBe(136)

  // The width survives a restart.
  await app.close()
  ;({ app, window } = await launch(stateDir, { TZ: 'Etc/UTC' }))
  await open()
  await expect.poll(() => widthOf(prop(ROW, 'labels'))).toBe(136)
  await expect(separator('Labels')).toHaveAttribute('aria-valuenow', '136')
})

test('caps a drag so every title keeps 5rem, and keeps a 1px column', async () => {
  await open()
  // Wide enough that the five columns at their defaults leave the drag room to grow.
  await resize(1400, 800)
  await toggle('Labels', 'Sprint', 'Due date', 'Created')
  await dragBy('Labels', -3000)
  const cap = Number(await separator('Labels').getAttribute('aria-valuenow'))
  expect(cap).toBeGreaterThan(96)
  expect(cap).toBeLessThan(1000)
  await expect.poll(() => misaligned(['labels', 'sprint', 'due', 'created', 'updated'])).toEqual([])
  await window.mouse.up()
  await expect.poll(async () => (await savedDisplay())?.widths?.labels).toBe(cap)

  // A 1px column stays, and shows nothing readable.
  const width = await widthOf(headerCell('due'))
  await dragBy('Due date', width - 1)
  await window.mouse.up()
  await expect.poll(async () => (await savedDisplay())?.widths?.due).toBe(1)
  await expect(prop(ROW, 'due')).toHaveCount(1)
})

test('releasing at 0 removes the column like its chip and keeps the view lit; Escape cancels', async () => {
  await open()
  await toggle('Labels')
  await window.getByRole('button', { name: 'New view' }).click()
  await window.getByLabel('New view name').fill('Triage')
  await window.keyboard.press('Enter')
  await expect(view('Triage')).toHaveAttribute('aria-current', 'true')
  await expect(update('Triage')).toBeDisabled()

  // Held at 0: the column is empty and the cue shows.
  await dragBy('Labels', 400)
  await expect.poll(() => widthOf(prop(ROW, 'labels'))).toBe(0)
  await expect(
    window.getByRole('status').filter({ hasText: 'Release to remove Labels' }),
  ).toBeVisible()
  await expect(separator('Labels')).toHaveAttribute('aria-valuenow', '0')
  // Escape puts the column back, and the release after it does nothing.
  await window.keyboard.press('Escape')
  await expect.poll(() => widthOf(prop(ROW, 'labels'))).toBe(96)
  await window.mouse.up()
  await expect(window.getByRole('status').filter({ hasText: 'Release to remove' })).toHaveCount(0)
  expect((await savedDisplay())?.properties).toEqual(['labels', 'updated'])

  // Released at 0: the property goes, as with the chip, and the view stays lit.
  await dragBy('Labels', 400)
  await expect.poll(() => widthOf(prop(ROW, 'labels'))).toBe(0)
  await window.mouse.up()
  await expect(prop(ROW, 'labels')).toHaveCount(0)
  await expect(separator('Labels')).toHaveCount(0)
  await expect.poll(savedDisplay).toEqual({
    properties: ['updated'],
    order: 'key',
    direction: 'desc',
  })
  await expect(view('Triage')).toHaveAttribute('aria-current', 'true')
  await expect(update('Triage')).toBeEnabled()
  await displayButton().click()
  await expect(chip('Labels')).toHaveAttribute('aria-pressed', 'false')
  await window.keyboard.press('Escape')
  // The saved view keeps its own display until Update view.
  expect((await savedViews()).find((v) => v.name === 'Triage')?.display?.properties).toEqual([
    'labels',
    'updated',
  ])
})

test('adding a removed column back starts it at its default width', async () => {
  await open()
  await toggle('Labels')
  await dragBy('Labels', -30)
  await window.mouse.up()
  await expect.poll(async () => (await savedDisplay())?.widths).toEqual({ labels: 126 })
  // The chip off is the same removal: the width goes with it.
  await toggle('Labels')
  await expect(prop(ROW, 'labels')).toHaveCount(0)
  await expect.poll(async () => (await savedDisplay())?.widths).toBeUndefined()
  await toggle('Labels')
  await expect.poll(() => widthOf(prop(ROW, 'labels'))).toBe(96)
})

test('a drag starts no row drag, selects no text, moves no active row and opens no Peek', async () => {
  await open()
  await toggle('Labels', 'Sprint')
  const active = await tree().locator('[data-active=true]').count()
  await dragBy('Sprint', -40)
  await expect(tree().locator('[data-dragging=true]')).toHaveCount(0)
  expect(await window.evaluate(() => globalThis.getSelection()?.toString())).toBe('')
  await window.mouse.move(400, 300, { steps: 6 })
  await window.mouse.up()
  expect(await window.evaluate(() => globalThis.getSelection()?.toString())).toBe('')
  expect(await tree().locator('[data-active=true]').count()).toBe(active)
  await expect(peek()).toHaveCount(0)
  await expect(tree().locator('[aria-selected=true]')).toHaveCount(0)
})

test('keeps working under a throttled renderer: the width follows the pointer and releases exactly', async () => {
  await open()
  await toggle('Labels', 'Due date')
  await throttle(20)
  await dragBy('Due date', -24)
  await expect.poll(() => widthOf(prop(ROW, 'due')), { timeout: 20_000 }).toBe(120)
  await window.mouse.up()
  await expect
    .poll(async () => (await savedDisplay())?.widths, { timeout: 20_000 })
    .toEqual({ due: 120 })
  await expect.poll(() => misaligned(['labels', 'due', 'updated']), { timeout: 20_000 }).toEqual([])
  // And a release at 0 still removes the column.
  await dragBy('Due date', 400)
  await window.mouse.up()
  await expect(prop(ROW, 'due')).toHaveCount(0, { timeout: 20_000 })
  await expect
    .poll(async () => (await savedDisplay())?.properties, { timeout: 20_000 })
    .toEqual(['labels', 'updated'])
})

test('a separator resizes and removes by keyboard, and says what it is', async () => {
  await open()
  await toggle('Labels')
  const labels = separator('Labels')
  await expect(labels).toHaveAttribute('aria-orientation', 'vertical')
  await expect(labels).toHaveAttribute('aria-valuemin', '0')
  await expect(labels).toHaveAttribute('aria-valuenow', '96')
  await labels.focus()
  await window.keyboard.press('ArrowLeft')
  await expect(labels).toHaveAttribute('aria-valuenow', '104')
  await window.keyboard.press('Shift+ArrowLeft')
  await expect(labels).toHaveAttribute('aria-valuenow', '136')
  await window.keyboard.press('ArrowRight')
  await expect(labels).toHaveAttribute('aria-valuenow', '128')
  await expect.poll(() => widthOf(prop(ROW, 'labels'))).toBe(128)
  await expect.poll(async () => (await savedDisplay())?.widths).toEqual({ labels: 128 })
  // A held arrow stops at 1px: only Delete removes.
  await window.keyboard.press('Shift+ArrowRight')
  await window.keyboard.press('Shift+ArrowRight')
  await window.keyboard.press('Shift+ArrowRight')
  await window.keyboard.press('Shift+ArrowRight')
  await window.keyboard.press('Shift+ArrowRight')
  await expect(labels).toHaveAttribute('aria-valuenow', '1')
  await window.keyboard.press('ArrowRight')
  await expect(labels).toHaveAttribute('aria-valuenow', '1')
  expect((await savedDisplay())?.properties).toEqual(['labels', 'updated'])

  await window.keyboard.press('Delete')
  await expect(prop(ROW, 'labels')).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect.poll(savedDisplay).toEqual({
    properties: ['updated'],
    order: 'key',
    direction: 'desc',
  })
})

test('shows no header below the Tree breakpoint, with the strip', async () => {
  await open()
  await toggle('Labels')
  // The Tree is 48px narrower than the window while the sidebar is a rail.
  await resize(747)
  await expect(header()).toBeHidden()
  await expect(prop(ROW, 'labels')).toBeHidden()
  await resize(749)
  await expect(header()).toBeVisible()
  await expect(prop(ROW, 'labels')).toBeVisible()
})

test('the Sprint page shows one header row at the widths the Tree set', async () => {
  await joinSprint(app, ['PSAPAC-3', 'PSAPAC-4', 'PSAPAC-13'], 5)
  await open()
  await toggle('Labels', 'Sprint')
  await separator('Labels').focus()
  await window.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => (await savedDisplay())?.widths).toEqual({ labels: 128 })

  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  const row = sprintPage().locator('[data-issue-key=PSAPAC-13]')
  await expect(row).toBeVisible()
  const names = sprintPage().locator('[data-column-names]')
  await expect(names).toHaveCount(1)
  await expect(names).toContainText('Labels')
  await expect(names).toContainText('Sprint')
  expect(await widthOf(names.locator('[data-col=labels]'))).toBe(128)
  expect(await widthOf(row.locator('[data-prop=labels]'))).toBe(128)
  expect(await widthOf(names.locator('[data-col=sprint]'))).toBe(104)
  // The cells keep their editors.
  await expect(row.locator('[data-prop=labels]')).toHaveAttribute('data-pick', 'labels')
})

/** Makes the row active and closes the Peek the click opened, which leaves the Tree too narrow to draw its slots. */
async function select(row: RegExp) {
  await item(row).click()
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
}

test('a key on a column cut to a sliver opens no editor in it', async () => {
  await open()
  // At 1200 the strip has no room left for the estimate column to anchor an editor.
  await resize(1400, 800)
  await toggle('Original estimate')
  const slot = prop(/PSAPAC-4,/, 'estimate')
  // At its width the slot takes Shift+E in place.
  await select(/PSAPAC-4,/)
  await window.keyboard.press('Shift+E')
  await expect(slot.locator('input')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(slot.locator('input')).toHaveCount(0)

  // Cut to 1px it has no box to anchor to, so the key falls back as it does for a hidden slot.
  const estimate = separator('Original estimate')
  await estimate.focus()
  await window.keyboard.press('Shift+ArrowRight')
  await window.keyboard.press('Shift+ArrowRight')
  await expect(estimate).toHaveAttribute('aria-valuenow', '1')
  await select(/PSAPAC-4,/)
  await window.keyboard.press('Shift+E')
  await expect(window.getByRole('menu')).toBeVisible()
  await expect(slot.locator('input')).toHaveCount(0)
})

test('Delete removes a column the window draws at 0, and its separator is not a tab stop', async () => {
  await open()
  await toggle('Labels', 'Sprint', 'Original estimate', 'Logged', 'Remaining', 'Remaining %')
  await toggle('Due date', 'Created')
  await resize(900)
  const updated = separator('Updated')
  await expect(updated).toHaveAttribute('aria-valuenow', '0')
  await expect(updated).toHaveAttribute('tabindex', '-1')
  await updated.focus()
  await window.keyboard.press('Delete')
  await expect(prop(ROW, 'updated')).toHaveCount(0)
  await expect.poll(async () => (await savedDisplay())?.properties).not.toContain('updated')
})

test('the Sprint page draws a 1px column at the least a button can be clicked at', async () => {
  await joinSprint(app, ['PSAPAC-3', 'PSAPAC-4', 'PSAPAC-13'], 5)
  await open()
  await toggle('Labels')
  await separator('Labels').focus()
  for (let i = 0; i < 4; i++) await window.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => (await savedDisplay())?.widths).toEqual({ labels: 1 })
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  const row = sprintPage().locator('[data-issue-key=PSAPAC-13]')
  await expect(row).toBeVisible()
  expect(await widthOf(row.locator('[data-prop=labels]'))).toBe(16)
  expect(await widthOf(sprintPage().locator('[data-column-names] [data-col=labels]'))).toBe(16)
})
