import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { launch, logIn } from './harness.js'

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
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const nav = () => window.getByRole('navigation', { name: 'Main' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const properties = () => window.getByRole('complementary', { name: 'Properties' })
const showSidebar = () => window.getByRole('button', { name: 'Show sidebar' })

/** Hovers the left of a row and peeks it: at a narrow width the Peek card covers its right half. */
async function pick(name: RegExp) {
  await window.mouse.move(2, 2)
  await item(name).hover({ position: { x: 100, y: 10 } })
  await tree().focus()
  await window.keyboard.press('o')
}

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
}

/**
 * Sets the window's content width. The app's own minimum is 900px, which guards a plain resize;
 * below it the layout is reached by zoom (a 1440px window at 200% is 720 CSS px), so the test
 * lifts the minimum to stand in for that.
 */
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

const box = async (locator: ReturnType<typeof peek>) => {
  const rect = await locator.boundingBox()
  if (rect === null) throw new Error('no box')
  return rect
}

interface Reached {
  name: string
  left: number
  right: number
  top: number
  bottom: number
  /** Its whole box lies under the Peek card, so no part of it shows. */
  covered: boolean
}

/**
 * Tabs through the whole page, from the first stop until the order comes round again, and returns
 * every element the focus landed on with its box. Focus scrolls an element into view, so a
 * control a scroll container holds counts as reachable when its box is in the window then. A box
 * is read again until it is inside the window, since content that loads late moves it.
 */
async function tabThrough(): Promise<Reached[]> {
  await window.evaluate(() => {
    for (const el of document.querySelectorAll('[data-walked]')) el.removeAttribute('data-walked')
    ;(document.activeElement as HTMLElement | null)?.blur()
  })
  const seen: Reached[] = []
  for (let step = 0; step < 160; step++) {
    await window.keyboard.press('Tab')
    const reached = await window.evaluate(async () => {
      const el = document.activeElement
      if (el === null || el === document.body) return null
      if (el.hasAttribute('data-walked')) return 'again' as const
      el.setAttribute('data-walked', '')
      const inside = (at: DOMRect) =>
        at.left >= -0.5 &&
        at.right <= globalThis.innerWidth + 0.5 &&
        at.top >= -0.5 &&
        at.bottom <= globalThis.innerHeight + 0.5
      let at = el.getBoundingClientRect()
      for (let tries = 0; tries < 15 && !inside(at); tries++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        at = el.getBoundingClientRect()
      }
      const card = document.querySelector('aside[aria-label=Peek]')?.getBoundingClientRect()
      const under =
        card !== undefined &&
        el.closest('aside[aria-label=Peek]') === null &&
        at.left >= card.left - 0.5 &&
        at.right <= card.right + 0.5 &&
        at.top >= card.top - 0.5 &&
        at.bottom <= card.bottom + 0.5
      return {
        name: el.getAttribute('aria-label') ?? (el.textContent.trim().slice(0, 30) || el.tagName),
        left: at.left,
        right: at.right,
        top: at.top,
        bottom: at.bottom,
        covered: under,
      }
    })
    if (reached === 'again') return seen
    if (reached !== null) seen.push(reached)
  }
  throw new Error('the tab order did not come round in 160 steps')
}

/** The names of the elements whose box is not inside the window. */
async function outside(reached: Reached[]): Promise<string[]> {
  const { width, height } = await window.evaluate(() => ({
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  }))
  return reached
    .filter(
      (r) => r.left < -0.5 || r.right > width + 0.5 || r.top < -0.5 || r.bottom > height + 0.5,
    )
    .map((r) => `${r.name} (${String(Math.round(r.left))}..${String(Math.round(r.right))})`)
}

/** Every control that has a box and could take focus, with a box that lies outside the window. */
const unreachableNow = () =>
  window.evaluate(() => {
    const out: string[] = []
    const width = globalThis.innerWidth
    for (const el of document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    )) {
      const at = el.getBoundingClientRect()
      if (at.width === 0 || at.height === 0 || el.closest('[inert], [popover]:not(:popover-open)'))
        continue
      // The skip link waits above the window until it takes focus.
      if (el.textContent.trim() === 'Skip to issues') continue
      // A scroll container, the view tabs or an overview table, holds the rest of its controls out of view.
      if (el.closest('.overflow-x-auto, .overflow-auto') !== null) continue
      if (at.left < -0.5 || at.right > width + 0.5) {
        out.push(el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 30))
      }
    }
    return out
  })

test('at 720px no control lies outside the window and the keyboard focuses nothing off screen', async () => {
  await open()
  await resize(720)
  await pick(/PSAPAC-2,/)
  await expect(peek()).toBeVisible()
  expect(await unreachableNow()).toEqual([])
  expect(await window.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(720)

  const onTree = await tabThrough()
  expect(onTree.length).toBeGreaterThan(15)
  expect(await outside(onTree)).toEqual([])
  // WCAG 2.4.11: no control the keyboard reaches lies wholly under the Peek card.
  expect(onTree.filter((r) => r.covered).map((r) => r.name)).toEqual([])
  expect(onTree.map((r) => r.name)).toEqual(
    expect.arrayContaining(['Show sidebar', 'Close', 'Open', 'Hide done']),
  )

  await pick(/PSAPAC-2,/)
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  // The page reads its description, links and activity after it opens, and they move its controls.
  await expect(
    issuePage()
      .getByText(/^Loading/)
      .filter({ visible: true }),
  ).toHaveCount(0)
  expect(await unreachableNow()).toEqual([])
  const onPage = await tabThrough()
  expect(onPage.length).toBeGreaterThan(10)
  expect(await outside(onPage)).toEqual([])
})

test('at 720px the Peek keeps Status, Assignee and Priority within the window', async () => {
  await open()
  await resize(720)
  await pick(/PSAPAC-2,/)
  await expect(peek()).toBeVisible()
  for (const field of ['Status', 'Assignee', 'Priority']) {
    // Esc closes the picker and the Peek with it, so each field opens it again.
    await pick(/PSAPAC-2,/)
    await expect(peek()).toBeVisible()
    const button = peek().getByRole('button', { name: new RegExp(`^${field}:`) })
    await expect(button).toBeVisible()
    const at = await box(button)
    expect(at.x).toBeGreaterThanOrEqual(0)
    expect(at.x + at.width).toBeLessThanOrEqual(720)
    await button.click()
    const list = window.getByRole('listbox', { name: field })
    await expect(list).toBeVisible()
    const picked = await box(list)
    expect(picked.x).toBeGreaterThanOrEqual(0)
    expect(picked.x + picked.width).toBeLessThanOrEqual(720)
    await window.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
  }
})

test('under 960px the Peek is a 360px card over the Tree, and from 960px a column beside it', async () => {
  await open()
  await pick(/PSAPAC-2,/)
  await expect(peek()).toBeVisible()

  await resize(1200)
  const list = window.getByRole('region', { name: 'Issue list' })
  const wideList = await box(list)
  const column = await box(peek())
  expect(column.x).toBeCloseTo(wideList.x + wideList.width, 0)

  await resize(960)
  expect((await box(nav())).width).toBeGreaterThan(200)
  expect((await box(peek())).x).toBeGreaterThanOrEqual(
    (await box(list)).x + (await box(list)).width,
  )

  for (const width of [959, 720]) {
    await resize(width)
    const shown = await box(peek())
    const under = await box(list)
    // The rail is 48px, the Tree takes every other pixel, and the card sits inside the Tree.
    expect((await box(nav())).width).toBe(48)
    expect(under.x).toBe(48)
    expect(under.width).toBe(width - 48)
    expect(shown.width).toBe(360)
    expect(shown.x + shown.width).toBe(width - 8)
    expect(shown.x).toBeGreaterThanOrEqual(under.x)
    // Below the page header, so its Search and New issue buttons stay clear.
    expect(shown.y).toBeGreaterThanOrEqual(48)
    expect(shown.y + shown.height).toBeLessThanOrEqual(700)
    await expect(window.getByRole('button', { name: /^New issue/ })).toBeVisible()
    // The row runs under the card: the Tree did not give the Peek a column.
    const row = await box(item(/PSAPAC-2,/))
    expect(row.x + row.width).toBeGreaterThan(shown.x + 100)
  }
})

test('under 960px the sidebar is a rail, and its button lays the full sidebar over the Tree', async () => {
  await open()
  await resize(1200)
  await expect(showSidebar()).toHaveCount(0)
  await expect(window.getByRole('button', { name: 'Log out' })).toBeVisible()

  await resize(720)
  expect((await box(nav())).width).toBe(48)
  await expect(window.getByRole('link', { name: 'Inbox' })).toBeVisible()
  await expect(window.getByRole('link', { name: 'Issues', exact: true })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Log out' })).toHaveCount(0)
  await expect(window.getByRole('link', { name: 'Issues', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )

  await showSidebar().click()
  await expect(window.getByRole('button', { name: 'Log out' })).toBeVisible()
  expect((await box(nav())).width).toBe(232)
  expect(await unreachableNow()).toEqual([])
  // Esc closes it and the button that opened it takes focus back.
  await window.keyboard.press('Escape')
  await expect(window.getByRole('button', { name: 'Log out' })).toHaveCount(0)
  await expect(showSidebar()).toBeFocused()

  // A click outside closes it, and so does a choice in it.
  await showSidebar().click()
  await expect(window.getByRole('button', { name: 'Log out' })).toBeVisible()
  await window.mouse.click(600, 400)
  await expect(window.getByRole('button', { name: 'Log out' })).toHaveCount(0)
  await showSidebar().click()
  await window.getByRole('link', { name: /^Inbox/ }).click()
  await expect(window.getByRole('region', { name: 'Inbox' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Log out' })).toHaveCount(0)

  // Widening the window brings the full sidebar back.
  await resize(1200)
  await expect(window.getByRole('button', { name: 'Log out' })).toBeVisible()
})

test('under 700px of Tree width the toolbar is one row of icons and the filter has its own row', async () => {
  await open()
  const buttons = () =>
    window.getByRole('button', { name: /^(Hide|Assignee|Filter$|Groups|Display)/ })
  const toolbar = async () =>
    window.evaluate(() => {
      const input = document.querySelector<HTMLElement>(
        'input[aria-label="Filter by key or summary"]',
      )
      const row = [...document.querySelectorAll<HTMLElement>('[aria-pressed], [data-menu-button]')]
        .filter(
          (b) => b.tagName === 'BUTTON' && b.closest('#issue-list') && !b.closest('[popover]'),
        )
        .map((b) => {
          const at = b.getBoundingClientRect()
          return {
            name: b.textContent.trim(),
            top: Math.round(at.top),
            width: Math.round(at.width),
          }
        })
      const at = input?.getBoundingClientRect()
      return { row, input: at === undefined ? null : { top: at.top, width: at.width } }
    })

  // At 1200 the Tree is 968px wide: labels show.
  await resize(1200)
  const wide = await toolbar()
  expect(wide.row.length).toBe(6)
  for (const b of wide.row) expect(b.width).toBeGreaterThan(60)

  for (const width of [720, 747]) {
    await resize(width)
    const narrow = await toolbar()
    expect(narrow.row.map((b) => b.name)).toHaveLength(6)
    expect(new Set(narrow.row.map((b) => b.top)).size).toBe(1)
    for (const b of narrow.row) expect(b.width).toBeLessThanOrEqual(32)
    expect(narrow.input?.top).toBeGreaterThan((narrow.row[0]?.top ?? 0) + 24)
    expect(narrow.input?.width).toBeGreaterThan(width - 48 - 40)
  }

  // The names stay, and a toggle still toggles and shows its state by fill.
  await resize(720)
  await expect(buttons()).toHaveCount(6)
  const hideDone = window.getByRole('button', { name: 'Hide done' })
  const pressed = await hideDone.getAttribute('aria-pressed')
  await hideDone.click()
  await expect(hideDone).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true')

  // A Peek at 1200 leaves the Tree 552px wide, so the toolbar is icons there too.
  await resize(1200)
  await pick(/PSAPAC-2,/)
  await expect(peek()).toBeVisible()
  const withPeek = await toolbar()
  expect(new Set(withPeek.row.map((b) => b.top)).size).toBe(1)
  for (const b of withPeek.row) expect(b.width).toBeLessThanOrEqual(32)
})

test('the toolbar and the controls stay inside the window in a wide font', async () => {
  await open()
  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  await resize(720)
  await pick(/PSAPAC-2,/)
  await expect(peek()).toBeVisible()
  expect(await unreachableNow()).toEqual([])
  expect(await outside(await tabThrough())).toEqual([])
  const header = peek().locator('.app-drag')
  const at = await box(header)
  expect(at.width).toBeLessThanOrEqual(360)
  for (const button of await header.getByRole('button').all()) {
    expect((await box(button)).x).toBeGreaterThanOrEqual(at.x)
  }
})

test('row properties and the toolbar share one 700px Tree width', async () => {
  await open()
  const updated = () => item(/PSAPAC-11,/).locator('[data-prop=updated]')
  const hideDone = () => window.getByRole('button', { name: 'Hide done' })
  // The Tree is 48px narrower than the window while the sidebar is a rail.
  await resize(747)
  await expect(updated()).toBeHidden()
  expect((await box(hideDone())).width).toBeLessThanOrEqual(32)
  await resize(749)
  await expect(updated()).toBeVisible()
  expect((await box(hideDone())).width).toBeGreaterThan(60)
})

test('the page stacks its Properties under 760px and puts them beside the content from 760px', async () => {
  await open()
  await pick(/PSAPAC-2,/)
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  const article = () => issuePage().locator('article')

  await resize(800)
  const side = { content: await box(article()), props: await box(properties()) }
  expect(side.props.x).toBeGreaterThanOrEqual(side.content.x + side.content.width - 1)
  expect(side.props.width).toBe(336)

  for (const width of [759, 720]) {
    await resize(width)
    const content = await box(article())
    const props = await box(properties())
    expect(props.y).toBeGreaterThanOrEqual(content.y + content.height - 1)
    // Nothing of the content is clipped by its own box, and the Peek card does not sit over the page.
    expect(
      await article().evaluate((el) => el.scrollHeight - el.clientHeight),
      `content clipped at ${String(width)}`,
    ).toBeLessThanOrEqual(1)
    expect(
      await window.evaluate(
        () => document.elementFromPoint(600, 200)?.closest('[aria-label="Issue page"]') !== null,
      ),
    ).toBe(true)
    expect(props.x).toBe(48)
    // The stacked page scrolls, so a classic scrollbar (Linux) takes its gutter from the width.
    const gutter = await issuePage().evaluate(
      (el) => (el as HTMLElement).offsetWidth - el.clientWidth,
    )
    expect(props.width).toBe(width - 48 - gutter)
    // The whole page scrolls, and Status is one Tab or a scroll away, never out of the window.
    await expect(properties().getByRole('button', { name: /^Status:/ })).toBeAttached()
    await properties()
      .getByRole('button', { name: /^Status:/ })
      .focus()
    const status = await box(properties().getByRole('button', { name: /^Status:/ }))
    expect(status.x).toBeGreaterThanOrEqual(0)
    expect(status.x + status.width).toBeLessThanOrEqual(width)
    expect(status.y).toBeGreaterThanOrEqual(40)
    expect(status.y + status.height).toBeLessThanOrEqual(700)
  }
})

test('no side border highlight or coloured edge appears at any width', async () => {
  await open()
  await pick(/PSAPAC-2,/)
  await expect(peek()).toBeVisible()
  // `--line` and `--field-border` as the browser resolves them, to tell a neutral edge from a coloured one.
  const neutral = async () =>
    window.evaluate(() => {
      const probe = (token: string) => {
        const el = document.createElement('i')
        el.style.background = `var(${token})`
        document.body.append(el)
        const colour = getComputedStyle(el).backgroundColor
        el.remove()
        return colour
      }
      return [probe('--line'), probe('--field-border'), 'rgba(0, 0, 0, 0)']
    })
  const edges = (selector: string) =>
    window.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (el === null) return null
      const style = getComputedStyle(el)
      return (['Top', 'Right', 'Bottom', 'Left'] as const)
        .filter(
          (side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0,
        )
        .map((side) => style.getPropertyValue(`border-${side.toLowerCase()}-color`))
    }, selector)
  for (const width of [1200, 960, 959, 720]) {
    await resize(width)
    const allowed = await neutral()
    for (const selector of ['nav[aria-label=Main]', 'aside[aria-label=Peek]', '#issue-list']) {
      const found = await edges(selector)
      expect(found, `${selector} at ${String(width)}`).not.toBeNull()
      for (const colour of found ?? [])
        expect(allowed, `${selector} at ${String(width)}`).toContain(colour)
    }
  }
  await window.keyboard.press('Escape')
  await pick(/PSAPAC-2,/)
  await window.keyboard.press('Enter')
  await expect(issuePage()).toBeVisible()
  for (const width of [800, 720]) {
    await resize(width)
    const allowed = await neutral()
    for (const colour of (await edges('aside[aria-label=Properties]')) ?? [])
      expect(allowed, `Properties at ${String(width)}`).toContain(colour)
  }
})

test('the Epics and Customers pages open from the sidebar overlay and keep every control reachable at 720px', async () => {
  await open()
  await resize(720)
  for (const name of ['Epics', 'Customers']) {
    await showSidebar().click()
    await nav().getByRole('link', { name, exact: true }).click()
    const page = window.getByRole('region', { name, exact: true })
    await expect(page).toBeVisible()
    // The overlay closed with the choice, and the page itself never scrolls sideways.
    await expect(window.getByRole('button', { name: 'Log out' })).toHaveCount(0)
    expect(await window.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      720,
    )
    expect(await unreachableNow()).toEqual([])
    const pageBox = await box(page)
    expect(pageBox.x + pageBox.width).toBeLessThanOrEqual(720)
    // A table wider than the window scrolls inside its own region.
    expect(
      await page.locator('table').evaluate((table) => {
        const region = table.parentElement
        return region !== null && region.scrollWidth >= region.clientWidth
      }),
    ).toBe(true)
    expect(await outside(await tabThrough())).toEqual([])
    await window.keyboard.press('Escape')
    await expect(page).toHaveCount(0)
  }
})

test('the block pills and a Story’s progress pill stay inside a narrow row', async () => {
  await open()
  for (const width of [720, 1200]) {
    await resize(width)
    const found = await window.evaluate(() => {
      const view = globalThis.innerWidth
      const rows = [...document.querySelectorAll<HTMLElement>('[role=treeitem]')]
      const pills = [...document.querySelectorAll<HTMLElement>('[data-pill], [data-progress]')]
      const rowOf = (key: string) =>
        document.querySelector(`[role=treeitem][aria-label^="${key},"]`)?.getBoundingClientRect()
      const ring = (key: string) => [
        ...document.querySelectorAll<HTMLElement>(
          `[role=treeitem][aria-label^="${key},"] [data-progress]`,
        ),
      ]
      return {
        pills: pills.length,
        pillsOutside: pills.filter((p) => p.getBoundingClientRect().right > view + 0.5).length,
        // PSAPAC-11 has a Subtask, so its ring sits last after the other chips on the row. The
        // Epic PSAPAC-10 has children but no ring.
        rings: ring('PSAPAC-11').length,
        ringsOutsideRow: ring('PSAPAC-11').filter(
          (p) => p.getBoundingClientRect().right > (rowOf('PSAPAC-11')?.right ?? 0) + 0.5,
        ).length,
        epicRings: ring('PSAPAC-10').length,
        rowsOverflowing: rows.filter((r) => r.scrollWidth > r.clientWidth + 1).length,
      }
    })
    expect(found.pills, `pills at ${String(width)}`).toBeGreaterThan(0)
    expect(found.rings, `progress pills at ${String(width)}`).toBeGreaterThan(0)
    expect(found.ringsOutsideRow).toBe(0)
    expect(found.epicRings).toBe(0)
    expect(found.pillsOutside).toBe(0)
    expect(found.rowsOverflowing).toBe(0)
  }
})

test('the Peek header drags the window only while the Peek is a column', async () => {
  await open()
  await pick(/PSAPAC-2,/)
  await expect(peek()).toBeVisible()
  const region = () =>
    peek()
      .locator('.app-drag')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))
  await resize(1200)
  expect(await region()).toBe('drag')
  await resize(720)
  expect(await region()).toBe('no-drag')
})

test('Esc after a click on bare sidebar overlay closes the overlay and leaves the Peek open', async () => {
  await open()
  await resize(720)
  await pick(/PSAPAC-2,/)
  await expect(peek()).toBeVisible()
  await showSidebar().click()
  await expect(window.getByRole('button', { name: 'Log out' })).toBeVisible()
  // The Sprints heading takes no focus, so a click on it left focus on the body.
  await window.getByRole('heading', { name: 'Sprints' }).click()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('button', { name: 'Log out' })).toHaveCount(0)
  await expect(peek()).toBeVisible()
  await expect(showSidebar()).toBeFocused()
})
