import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { counts, joinSprint, launch, logIn, releaseDone } from './harness.js'

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
const item = (name: string | RegExp, exact = false) => tree().getByRole('treeitem', { name, exact })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const dialog = () => window.getByRole('dialog', { name: 'Edit summary' })
/** The Peek's heading for the issue with this summary. */
const peeked = (summary: string) => peek().getByRole('heading', { name: summary })
const active = () => tree().locator('[role="treeitem"][data-active="true"]')
const four = () => item(/PSAPAC-4,/)
const three = () => item(/PSAPAC-3,/)

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under the pointer.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Moves the pointer into `row` by `dx` pixels from its left edge, one pixel below its top third. */
async function pointAt(row: Locator, dx = 120) {
  const box = await row.boundingBox()
  if (box === null) throw new Error('the row is not drawn')
  await window.mouse.move(box.x + dx, box.y + box.height / 2)
}

/** The type icon of an issue row, which is neither the summary nor a control: blank row space. */
const blank = (row: Locator) => row.getByRole('img').first()
/** The key text of an issue row: a click on it peeks the issue (#299). */
const keyOf = (row: Locator) => row.locator('.tree-key')

test('the row under the pointer is the active row, with no click', async () => {
  await open()
  await four().hover()
  await expect(four()).toHaveAttribute('data-active', 'true')
  await expect(active()).toHaveCount(1)
  await three().hover()
  await expect(three()).toHaveAttribute('data-active', 'true')
  await expect(four()).toHaveAttribute('data-active', 'false')

  await item('Acme, 8 issues', true).hover()
  await expect(item('Acme, 8 issues', true)).toHaveAttribute('data-active', 'true')
  await expect(active()).toHaveCount(1)
  // A hover opens nothing.
  await expect(peek()).toHaveCount(0)
  await expect(issuePage()).toHaveCount(0)
})

test('a chip becomes the active row under the pointer', async () => {
  await open()
  await releaseDone(app)
  await expect(window.getByText('Loading Done issues:')).toHaveCount(0)
  await window.getByRole('button', { name: 'Hide done', exact: true }).click()
  await item('2 done', true).hover()
  await expect(item('2 done', true)).toHaveAttribute('data-active', 'true')
  await expect(item('2 done', true)).toContainText('2 done')
})

test('the last input wins: J moves the row under a still pointer, and moving the pointer takes it back', async () => {
  await open()
  await pointAt(four())
  await expect(four()).toHaveAttribute('data-active', 'true')

  await window.keyboard.press('j')
  const next = four().locator('xpath=following-sibling::*[1]')
  await expect(next).toHaveAttribute('data-active', 'true')
  await expect(four()).toHaveAttribute('data-active', 'false')
  // The pointer still rests on the first row, and a rebuild or a repeat of its position moves nothing.
  await pointAt(four())
  await expect(next).toHaveAttribute('data-active', 'true')

  // A real move over the row hands the active row back to the pointer.
  await pointAt(four(), 121)
  await expect(four()).toHaveAttribute('data-active', 'true')
  await expect(active()).toHaveCount(1)

  await window.keyboard.press('k')
  await expect(four().locator('xpath=preceding-sibling::*[1]')).toHaveAttribute(
    'data-active',
    'true',
  )
})

test('a scroll under a still pointer leaves the active row alone', async () => {
  await open()
  // A short window, so the rows overflow the Tree and the scroll below is a real one.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.setMinimumSize(1, 1)
    win?.setContentSize(1200, 320)
  })
  await expect
    .poll(() => tree().evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(100)
  // The first header, which the short window still shows at the top.
  const top = item('Acme, 8 issues', true)
  await pointAt(top)
  await expect(top).toHaveAttribute('data-active', 'true')
  const box = await top.boundingBox()
  if (box === null) throw new Error('the row is not drawn')
  const x = box.x + 120
  const y = box.y + box.height / 2
  const under = () =>
    window.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px ?? 0, py ?? 0)?.closest('[role="treeitem"]')?.id ?? '',
      [x, y],
    )
  const before = await under()

  await tree().evaluate((el) => {
    el.scrollTop += 96
  })
  await expect.poll(under).not.toBe(before)
  // Time for a hover to have been applied, if one were going to be.
  await window.waitForTimeout(300)
  await expect(top).toHaveAttribute('data-active', 'true')
  await expect(active()).toHaveCount(1)

  // The wheel too: the rows under the pointer change, the active row does not.
  await window.mouse.wheel(0, 64)
  await window.waitForTimeout(300)
  await expect(top).toHaveAttribute('data-active', 'true')
})

test('leaving the list keeps the last row active, and the letter keys keep their target', async () => {
  await open()
  await four().hover()
  await expect(four()).toHaveAttribute('data-active', 'true')
  await window.mouse.move(640, 2)
  await window.waitForTimeout(150)
  await expect(four()).toHaveAttribute('data-active', 'true')

  await window.keyboard.press('e')
  await expect(dialog()).toBeVisible()
  await expect(dialog().getByLabel('Summary of PSAPAC-4')).toHaveValue('Migrate the dashboards')
})

test('o opens the Peek on the hovered issue and O opens its page', async () => {
  await open()
  await four().hover()
  await window.keyboard.press('o')
  await expect(peek()).toBeVisible()
  await expect(peeked('Migrate the dashboards')).toBeVisible()
  await expect(four()).toHaveAttribute('aria-current', 'true')
  // `o` opens and never closes: a second press leaves the Peek where it is.
  await window.keyboard.press('o')
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)

  await three().hover()
  await window.keyboard.press('Shift+O')
  await expect(issuePage().getByRole('heading', { name: 'Fix the export timeout' })).toBeVisible()
  await expect(peek()).toHaveCount(0)
})

test('with the Peek open it stays on its issue while the pointer moves, and o switches it', async () => {
  await open()
  await four().hover()
  await window.keyboard.press('o')
  await expect(peeked('Migrate the dashboards')).toBeVisible()

  await three().hover()
  await expect(three()).toHaveAttribute('data-active', 'true')
  await expect(peeked('Migrate the dashboards')).toBeVisible()
  await expect(four()).toHaveAttribute('aria-current', 'true')
  // Another key on the hovered row leaves the Peek as it is too.
  await window.keyboard.press('x')
  await expect(peeked('Migrate the dashboards')).toBeVisible()
  await window.keyboard.press('x')

  await window.keyboard.press('o')
  await expect(peeked('Fix the export timeout')).toBeVisible()
  await expect(three()).toHaveAttribute('aria-current', 'true')
  await expect(four()).not.toHaveAttribute('aria-current', 'true')
})

test('hovering a row when focus is on the page body lets o peek it, with no focus move of the test', async () => {
  await open()
  await window.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
  })
  await expect(tree()).not.toBeFocused()
  await window.mouse.move(2, 2)
  await four().hover()
  await window.keyboard.press('o')
  await expect(peeked('Migrate the dashboards')).toBeVisible()
  await expect(four()).toHaveAttribute('aria-current', 'true')
})

test('hovering the same row again after focus left for the page body lets o peek it', async () => {
  await open()
  await four().hover()
  await expect(four()).toHaveAttribute('data-active', 'true')
  // A click on empty canvas, which sends focus to the body.
  await window.mouse.click(2, 2)
  await window.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
  })
  await expect(tree()).not.toBeFocused()
  // Back onto the row that is already active: the row does not change, the focus must still come.
  await four().hover()
  await window.keyboard.press('o')
  await expect(peeked('Migrate the dashboards')).toBeVisible()
})

test('with focus inside the Peek, o and Shift+O act on the hovered row', async () => {
  await open()
  await four().hover()
  await window.keyboard.press('o')
  await expect(peeked('Migrate the dashboards')).toBeVisible()
  await peek().getByRole('button', { name: 'Close' }).focus()

  await three().hover()
  await window.keyboard.press('o')
  await expect(peeked('Fix the export timeout')).toBeVisible()
  await expect(three()).toHaveAttribute('aria-current', 'true')

  await peek().getByRole('button', { name: 'Close' }).focus()
  await four().hover()
  await window.keyboard.press('Shift+O')
  await expect(issuePage().getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
})

test('while a cell editor or a menu is open the pointer moves no row, and moves one again once it closes', async () => {
  await open()
  await four().locator('[data-pick="status"]').click()
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeVisible()
  await expect(four()).toHaveAttribute('data-active', 'true')
  // A row above the list, which the list does not cover.
  await item(/PSAPAC-10,/).hover()
  await window.waitForTimeout(200)
  await expect(four()).toHaveAttribute('data-active', 'true')
  await expect(active()).toHaveCount(1)
  await window.keyboard.press('Escape')
  await expect(window.getByRole('listbox', { name: 'Status' })).toHaveCount(0)

  await window.mouse.move(2, 2)
  await item(/PSAPAC-10,/).hover()
  await expect(item(/PSAPAC-10,/)).toHaveAttribute('data-active', 'true')

  // A context menu holds its row the same way.
  await four().click({ button: 'right', position: { x: 120, y: 8 } })
  await expect(window.getByRole('menu')).toBeVisible()
  await expect(four()).toHaveAttribute('data-active', 'true')
  await window.mouse.move(700, 80)
  await window.waitForTimeout(200)
  await expect(four()).toHaveAttribute('data-active', 'true')
})

test('o and O do nothing on a header or a chip, or in a text field', async () => {
  await open()
  await item('Acme, 8 issues', true).hover()
  await window.keyboard.press('o')
  await window.keyboard.press('Shift+O')
  await expect(peek()).toHaveCount(0)
  await expect(issuePage()).toHaveCount(0)

  await window.keyboard.press('/')
  const filter = window.getByLabel('Filter by key or summary')
  await expect(filter).toBeFocused()
  await window.keyboard.type('oO')
  await expect(filter).toHaveValue('oO')
  await expect(peek()).toHaveCount(0)
  await expect(issuePage()).toHaveCount(0)
})

test('a click on blank row space does nothing, a double-click opens the page, and a chevron still toggles', async () => {
  await open()
  await four().hover()
  await blank(four()).click()
  await expect(four()).toHaveAttribute('data-active', 'true')
  await expect(peek()).toHaveCount(0)
  await expect(dialog()).toHaveCount(0)
  await expect(four()).not.toHaveAttribute('aria-current', 'true')

  // A click on a row the pointer has not reached by moving is not an activation either.
  await window.waitForTimeout(600)
  await blank(four()).dblclick()
  await expect(issuePage().getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
  await expect(dialog()).toHaveCount(0)
  await window.keyboard.press('Escape')

  const first = tree().locator('[role="treeitem"][aria-level="2"][aria-expanded="true"]').first()
  const epic = tree().locator(`[data-row-id="${(await first.getAttribute('data-row-id')) ?? ''}"]`)
  const shown = await tree().getByRole('treeitem').count()
  await epic.locator('[data-chevron]').click()
  await expect.poll(() => tree().getByRole('treeitem').count()).toBeLessThan(shown)
  await epic.locator('[data-chevron]').click()
  await expect.poll(() => tree().getByRole('treeitem').count()).toBe(shown)
  await expect(peek()).toHaveCount(0)
})

test('a click on the key peeks the issue, a double-click on it still opens the page, and Cmd+click checks', async () => {
  await open()
  await expect(keyOf(four())).toHaveCSS('cursor', 'pointer')
  await keyOf(four()).click()
  await expect(four()).toHaveAttribute('data-active', 'true')
  await expect(peeked('Migrate the dashboards')).toBeVisible()
  await expect(dialog()).toHaveCount(0)
  await expect(issuePage()).toHaveCount(0)

  // Another key switches the Peek.
  await keyOf(three()).click()
  await expect(peeked('Fix the export timeout')).toBeVisible()

  await window.waitForTimeout(600)
  await keyOf(four()).dblclick()
  await expect(issuePage().getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
  await window.keyboard.press('Escape')

  // Cmd+click checks the row and leaves the Peek on its issue.
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await keyOf(three()).click({ modifiers: ['ControlOrMeta'] })
  await expect(three()).toHaveAttribute('aria-checked', 'true')
  await expect(peek()).toHaveCount(0)
})

test('a single click on a summary opens the editor, and a click on a status dot only its list', async () => {
  await open()
  await four().getByText('Migrate the dashboards').click()
  await expect(dialog()).toBeVisible()
  await expect(peek()).toHaveCount(0)
  await window.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)

  await three().locator('[data-pick="status"]').click()
  await expect(window.getByRole('listbox')).toBeVisible()
  await expect(peek()).toHaveCount(0)
  await expect(dialog()).toHaveCount(0)
  await expect(three()).toHaveAttribute('data-active', 'true')
})

/** Slows the renderer, so a key can arrive before a render that followed the pointer lands. */
async function throttle(rate: number) {
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
}

for (const rate of [1, 20]) {
  test(`o right after the pointer moves peeks the row under it, at ${String(rate)}x CPU`, async () => {
    await open()
    await throttle(rate)
    await window.mouse.move(2, 2)
    await four().hover()
    // No wait for the hover to render: the key must read the row the pointer is on.
    await window.keyboard.press('o')
    await expect(peeked('Migrate the dashboards')).toBeVisible()
    await expect(four()).toHaveAttribute('aria-current', 'true')
  })
}

test('no write goes to Jira from hovering, o or O', async () => {
  await open()
  await four().hover()
  await window.keyboard.press('o')
  await window.keyboard.press('Shift+O')
  await expect(issuePage()).toBeVisible()
  expect((await counts(app)).edits).toBe(0)
})

test('in a wide font the hover, o and the summary click still work', async () => {
  await open()
  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  await four().hover()
  await expect(four()).toHaveAttribute('data-active', 'true')
  await window.keyboard.press('o')
  await expect(peek()).toBeVisible()
  // The Peek narrows the Tree, and the summary text is still a target inside the row.
  const inside = await four().evaluate((el) => {
    const summary = el.querySelector('[data-summary]')?.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    return summary !== undefined && summary.width > 0 && summary.right <= box.right
  })
  expect(inside).toBe(true)
  await three().getByText('Fix the export timeout').click()
  await expect(dialog()).toBeVisible()
  await expect(three()).toHaveAttribute('data-active', 'true')
})

test.describe('the Sprint page', () => {
  const listed = (key: string) => sprintPage().getByRole('button', { name: new RegExp(`^${key} `) })
  const li = (key: string) => sprintPage().locator(`[data-issue-key="${key}"]`)

  async function openSprint() {
    await joinSprint(app, ['PSAPAC-4', 'PSAPAC-13'], 5)
    await open()
    await window
      .getByRole('navigation', { name: 'Main' })
      .getByRole('region', { name: 'Sprints' })
      .getByRole('button', { name: /^Current/ })
      .click()
    await expect(sprintPage()).toBeVisible()
  }

  test('hover makes a row active, o peeks it beside the page and O opens the page', async () => {
    await openSprint()
    await li('PSAPAC-4').hover()
    await expect(li('PSAPAC-4')).toHaveAttribute('data-active', 'true')
    await li('PSAPAC-13').hover()
    await expect(li('PSAPAC-13')).toHaveAttribute('data-active', 'true')
    await expect(li('PSAPAC-4')).toHaveAttribute('data-active', 'false')

    await sprintPage().focus()
    await window.keyboard.press('o')
    await expect(peek()).toBeVisible()
    await expect(sprintPage()).toBeVisible()
    await li('PSAPAC-4').hover()
    // The Peek stays on PSAPAC-13 while the pointer moves, as on the Tree.
    await expect(peeked('Migrate the dashboards')).toHaveCount(0)
    await window.keyboard.press('o')
    await expect(peeked('Migrate the dashboards')).toBeVisible()

    await window.keyboard.press('Shift+O')
    await expect(issuePage().getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
  })

  test('a single click on the summary opens the editor, a click elsewhere does nothing and a double-click opens the issue', async () => {
    await openSprint()
    await li('PSAPAC-4').hover()
    await sprintPage().getByRole('button', { name: 'Edit summary of PSAPAC-4' }).click()
    await expect(dialog()).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(dialog()).toHaveCount(0)

    // A click on the key peeks the issue, and a double-click on it opens the page.
    const key = li('PSAPAC-4').getByText('PSAPAC-4', { exact: true })
    await expect(key).toHaveCSS('cursor', 'pointer')
    await key.click()
    await expect(peeked('Migrate the dashboards')).toBeVisible()
    await key.dblclick()
    await expect(issuePage().getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
  })

  test('hovering a row after focus left for the page body lets o peek it', async () => {
    await openSprint()
    await li('PSAPAC-4').hover()
    await window.evaluate(() => {
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    await expect(sprintPage()).not.toBeFocused()
    await window.mouse.move(2, 2)
    await li('PSAPAC-4').hover()
    await window.keyboard.press('o')
    await expect(peek()).toBeVisible()
  })

  test('Esc closes the Peek beside the page first, and a second Esc closes the page', async () => {
    await openSprint()
    await li('PSAPAC-4').hover()
    await sprintPage().focus()
    await window.keyboard.press('o')
    await expect(peek()).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(peek()).toHaveCount(0)
    await expect(sprintPage()).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(sprintPage()).toHaveCount(0)
  })

  test('Enter on the focused row button still opens the issue, for the keyboard', async () => {
    await openSprint()
    await listed('PSAPAC-4').focus()
    await window.keyboard.press('Enter')
    await expect(issuePage()).toBeVisible()
  })

  test('o does nothing in the summary editor on the page', async () => {
    await openSprint()
    await li('PSAPAC-4').hover()
    await sprintPage().getByRole('button', { name: 'Edit summary of PSAPAC-4' }).click()
    await expect(dialog()).toBeVisible()
    await window.keyboard.type('oO')
    await expect(dialog().getByLabel('Summary of PSAPAC-4')).toHaveValue('oO')
    await expect(peek()).toHaveCount(0)
    await expect(issuePage()).toHaveCount(0)
  })
})
