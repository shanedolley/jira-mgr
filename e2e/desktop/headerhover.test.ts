import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { joinSprint, launch, logIn, moveIssue, readState, showEverything } from './harness.js'

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

const HOLD_OPACITY = 0.3
const WIDE_FONT = '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }'

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const header = () => window.getByRole('group', { name: 'Column widths' })
const name = (property: string) => header().locator(`[data-col-name=${property}]`)
const separator = (label: string) =>
  window.getByRole('separator', { name: `Resize ${label} column` })
const highlight = () => window.locator('[data-tree-pane] > [data-col-highlight]')
const displayButton = () => window.getByRole('button', { name: 'Display', exact: true })
const chip = (label: string) =>
  window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name: label, exact: true })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const names = () => sprintPage().locator('[data-column-names]')
const sprintHighlight = () => names().locator('[data-col-highlight]')

const savedWidths = async () =>
  (await readState<{ display?: { widths?: Record<string, number> } }>(stateDir, 'settings.json'))
    ?.display?.widths

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
  await displayButton().click()
  await expect(chip('Updated')).toBeVisible()
  for (const label of ['Labels', 'Sprint']) await chip(label).click()
  await window.keyboard.press('Escape')
  await expect(chip('Updated')).toBeHidden()
  await expect(name('labels')).toBeVisible()
}

async function openSprint() {
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage().locator('[data-issue-key=PSAPAC-13]')).toBeVisible()
}

/** The opacity a viewer sees: the element's own times every ancestor's. */
const opacityOf = (target: Locator) =>
  target.evaluate((element) => {
    let seen = 1
    for (let node: Element | null = element; node; node = node.parentElement)
      seen *= Number(getComputedStyle(node).opacity)
    return seen
  })

/** Hovers, then reads the opacity, so `expect.poll` hovers again on each try. */
async function hoveredOpacityOf(
  over: Locator,
  target: Locator,
  position?: { x: number; y: number },
) {
  await over.hover({ position })
  return opacityOf(target)
}

/** The strip's empty left end, where no name sits. */
const STRIP = { x: 20, y: 12 }

/** Moves the pointer off the strip, onto the sidebar. */
const leave = () => window.mouse.move(2, 400)

const centreOf = async (locator: Locator) => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('not on screen')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** What `--row-selected` computes to, as a `color` value. */
const rowSelected = () =>
  window.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--row-selected)'
    document.body.append(probe)
    const { color } = getComputedStyle(probe)
    probe.remove()
    return color
  })

const props = ['updated', 'labels', 'sprint']
const LABELS: Record<string, string> = { updated: 'Updated', labels: 'Labels', sprint: 'Sprint' }

test('hides the names and separators until the pointer is over the Tree header', async () => {
  await open()
  await leave()
  for (const p of props) {
    await expect.poll(() => opacityOf(name(p))).toBe(0)
    expect(await opacityOf(separator(LABELS[p] ?? ''))).toBe(0)
  }
  await expect(highlight()).toBeHidden()

  // The strip keeps its 24px and its border, so nothing moves.
  const strip = await header().boundingBox()
  const row = await item(/PSAPAC-11,/).boundingBox()
  expect(strip?.height).toBe(24)

  for (const p of props) {
    await expect.poll(() => hoveredOpacityOf(header(), name(p), STRIP)).toBeCloseTo(HOLD_OPACITY, 2)
  }
  await expect.poll(() => hoveredOpacityOf(header(), separator('Labels'), STRIP)).toBe(1)
  expect(await header().boundingBox()).toEqual(strip)
  expect(await item(/PSAPAC-11,/).boundingBox()).toEqual(row)

  await leave()
  await expect.poll(() => opacityOf(name('labels'))).toBe(0)
  await expect.poll(() => opacityOf(separator('Labels'))).toBe(0)
})

test('shows the name under the pointer in full and highlights its column down the list', async () => {
  await moveIssue(app, 'PSAPAC-11', 'hold')
  await open()
  await name('sprint').hover()
  await expect.poll(() => opacityOf(name('sprint'))).toBe(1)
  expect(await opacityOf(name('labels'))).toBeCloseTo(HOLD_OPACITY, 2)
  expect(await opacityOf(name('updated'))).toBeCloseTo(HOLD_OPACITY, 2)
  await expect(highlight()).toBeVisible()
  const edge = await highlight().evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      left: style.borderLeftColor,
      right: style.borderRightColor,
      width: style.borderLeftWidth,
      events: style.pointerEvents,
    }
  })
  const blue = await rowSelected()
  expect(edge).toEqual({ left: blue, right: blue, width: '2px', events: 'none' })
  // On a Hold row it draws at full strength, and a click on the row beneath reaches the row.
  expect(await opacityOf(highlight())).toBe(1)
  expect(await tree().locator('[data-hold]').count()).toBeGreaterThan(0)

  // Moving to another name moves the highlight; leaving the strip removes it.
  await name('labels').hover()
  await expect.poll(() => opacityOf(name('labels'))).toBe(1)
  await expect.poll(() => opacityOf(name('sprint'))).toBeCloseTo(HOLD_OPACITY, 2)
  await leave()
  await expect(highlight()).toBeHidden()
})

test('the highlight wears --row-selected in the light and the dark theme', async () => {
  await open()
  const seen: string[] = []
  for (const colorScheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme })
    await name('labels').hover()
    await expect(highlight()).toBeVisible()
    await expect
      .poll(() => highlight().evaluate((el) => getComputedStyle(el).borderLeftColor))
      .toBe(await rowSelected())
    seen.push(await rowSelected())
  }
  expect(seen[0]).not.toBe(seen[1])
})

for (const [label, css] of [
  ['the default font', ''],
  ['a wide font', WIDE_FONT],
] as const) {
  test(`the Tree highlight spans its column and the list (${label})`, async () => {
    await open()
    if (css !== '') await window.addStyleTag({ content: css })
    for (const p of props) {
      await name(p).hover()
      await expect(highlight()).toBeVisible()
      const cell = await header().locator(`[data-col=${p}]`).boundingBox()
      const pane = await window.locator('[data-tree-pane]').boundingBox()
      const bar = await highlight().boundingBox()
      if (cell === null || pane === null || bar === null) throw new Error('not on screen')
      expect(bar.x).toBeCloseTo(cell.x, 0)
      expect(bar.x + bar.width).toBeCloseTo(cell.x + cell.width, 0)
      expect(bar.y).toBeCloseTo(pane.y, 0)
      expect(bar.y + bar.height).toBeCloseTo(pane.y + pane.height, 0)
      // A press anywhere on the highlight's edge lands on what is under it, not on the highlight.
      const hit = await window.evaluate(
        ([x, y]) =>
          document.elementFromPoint(x ?? 0, y ?? 0)?.closest('[data-col-highlight]') !== null,
        [bar.x + 1, bar.y + pane.height / 2],
      )
      expect(hit).toBe(false)
    }
  })
}

test('under reduced motion the header changes at once, otherwise over 100ms', async () => {
  await open()
  const fade = () => name('labels').evaluate((el) => getComputedStyle(el).transitionDuration)
  expect(await fade()).toBe('0.1s')
  await window.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(fade).toBe('0s')
  await leave()
  expect(await opacityOf(name('labels'))).toBe(0)
  await name('labels').hover()
  expect(await opacityOf(name('labels'))).toBe(1)
})

test('a drag from the hidden header keeps it shown wherever the pointer goes, and the red state too', async () => {
  await open()
  await leave()
  const at = await centreOf(separator('Labels'))
  await window.mouse.move(at.x, at.y)
  await window.mouse.down()
  // Out of the strip and down into the rows, the button still down.
  await window.mouse.move(at.x - 10, at.y + 200, { steps: 4 })
  await expect.poll(() => opacityOf(name('sprint'))).toBeCloseTo(HOLD_OPACITY, 2)
  expect(await opacityOf(separator('Sprint'))).toBe(1)
  // Far to the right the column hits 0 and "Release to remove" shows.
  await window.mouse.move(at.x + 400, at.y + 200, { steps: 6 })
  await expect(header().getByRole('status')).toHaveText('Release to remove Labels')
  await expect.poll(() => opacityOf(name('sprint'))).toBeCloseTo(HOLD_OPACITY, 2)
  await window.mouse.up()
  await expect.poll(() => opacityOf(name('sprint'))).toBe(0)
  await expect(header().getByRole('status')).toHaveText('')
})

test('a drag of a name keeps the header shown until it ends', async () => {
  await open()
  await leave()
  const at = await centreOf(name('labels'))
  await window.mouse.move(at.x, at.y)
  await window.mouse.down()
  await window.mouse.move(at.x - 20, at.y + 200, { steps: 4 })
  await expect(name('labels')).toHaveAttribute('data-moving', '')
  await expect.poll(() => opacityOf(name('sprint'))).toBeCloseTo(HOLD_OPACITY, 2)
  expect(await opacityOf(separator('Sprint'))).toBe(1)
  await window.keyboard.press('Escape')
  await expect(name('labels')).not.toHaveAttribute('data-moving')
  await expect.poll(() => opacityOf(name('sprint'))).toBe(0)
})

test('Tab reaches the hidden separators and names, reveals the header and resizes from there', async () => {
  await open()
  await leave()
  await tree().focus()
  expect(await opacityOf(name('labels'))).toBe(0)

  // Shift+Tab from the Tree lands on the last separator, then its name.
  await window.keyboard.press('Shift+Tab')
  await expect(separator('Sprint')).toBeFocused()
  await expect.poll(() => opacityOf(separator('Labels'))).toBe(1)
  await expect.poll(() => opacityOf(name('labels'))).toBeCloseTo(HOLD_OPACITY, 2)
  await window.keyboard.press('Shift+Tab')
  await expect(name('sprint')).toBeFocused()
  await expect.poll(() => opacityOf(name('sprint'))).toBeCloseTo(HOLD_OPACITY, 2)

  // A key from the hidden state resizes: Tab on to the separator and widen it.
  await window.keyboard.press('Tab')
  await expect(separator('Sprint')).toBeFocused()
  await window.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => (await savedWidths())?.sprint).toBeGreaterThan(0)

  // Focus back in the Tree hides the header again.
  await tree().focus()
  await expect.poll(() => opacityOf(name('sprint'))).toBe(0)
  await expect.poll(() => opacityOf(separator('Sprint'))).toBe(0)
})

test('Delete on a hidden separator removes the column', async () => {
  await open()
  await leave()
  await tree().focus()
  await window.keyboard.press('Shift+Tab')
  await expect(separator('Sprint')).toBeFocused()
  await window.keyboard.press('Delete')
  await expect(header().locator('[data-col]')).toHaveCount(2)
})

test('the Sprint page hides the names and separators, shows 30% and 100%, and highlights down every section', async () => {
  await joinSprint(app, ['PSAPAC-3', 'PSAPAC-4', 'PSAPAC-13'], 5)
  await moveIssue(app, 'PSAPAC-13', 'hold')
  await open()
  await openSprint()
  await leave()

  const label = (p: string) => names().locator(`[data-col-name=${p}]`)
  const line = (p: string) => names().locator(`[data-col-sep=${p}]`)
  const strip = await names().boundingBox()
  const row = await sprintPage().locator('[data-issue-key=PSAPAC-13]').boundingBox()
  for (const p of props) {
    await expect.poll(() => opacityOf(label(p))).toBe(0)
    expect(await opacityOf(line(p))).toBe(0)
  }
  await expect(sprintHighlight()).toBeHidden()

  await expect
    .poll(() => hoveredOpacityOf(names(), label('labels'), { x: 20, y: 12 }))
    .toBeCloseTo(HOLD_OPACITY, 2)
  await expect.poll(() => hoveredOpacityOf(names(), line('labels'), { x: 20, y: 12 })).toBe(1)
  // Nothing moved.
  expect(await names().boundingBox()).toEqual(strip)
  expect(await sprintPage().locator('[data-issue-key=PSAPAC-13]').boundingBox()).toEqual(row)

  await label('sprint').hover()
  await expect.poll(() => opacityOf(label('sprint'))).toBe(1)
  expect(await opacityOf(label('labels'))).toBeCloseTo(HOLD_OPACITY, 2)
  await expect(sprintHighlight()).toBeVisible()
  const blue = await rowSelected()
  expect(await sprintHighlight().evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe(blue)
  expect(await sprintHighlight().evaluate((el) => getComputedStyle(el).borderRightColor)).toBe(blue)
  expect(await opacityOf(sprintHighlight())).toBe(1)

  // From the top of the strip to the bottom of the last section.
  const cell = await names().locator('[data-col=sprint]').boundingBox()
  const bar = await sprintHighlight().boundingBox()
  const sections = sprintPage().locator('article section')
  const last = await sections.last().boundingBox()
  if (cell === null || bar === null || last === null || strip === null) throw new Error('missing')
  expect(bar.x).toBeCloseTo(cell.x, 0)
  expect(bar.x + bar.width).toBeCloseTo(cell.x + cell.width, 0)
  expect(bar.y).toBeCloseTo(strip.y, 0)
  expect(bar.y + bar.height).toBeCloseTo(last.y + last.height, 0)
  expect(await sections.count()).toBeGreaterThan(1)

  await leave()
  await expect(sprintHighlight()).toBeHidden()
  await expect.poll(() => opacityOf(label('sprint'))).toBe(0)
})
