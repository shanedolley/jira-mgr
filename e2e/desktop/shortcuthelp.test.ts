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
const help = () => window.getByRole('dialog', { name: 'Keyboard shortcuts' })
const field = () => help().getByRole('searchbox', { name: 'Search shortcuts' })
const status = () => help().getByRole('status')
const rows = () => help().locator('tbody tr')
const headings = () => help().getByRole('heading', { level: 3 })

const TITLES = [
  'Move around the Tree',
  'Select and reorder',
  'Edit an issue',
  'Create and track time',
  'Click on a row',
  'Find, filter and views',
  'Menus and pickers',
  'Dialogs and fields',
  'App and pages',
]

/** Opens the list with `?` from the Tree, the way a user does. */
async function openHelp() {
  await logIn(window)
  await tree()
    .getByRole('treeitem', { name: /PSAPAC-2,/ })
    .click()
  await window.keyboard.press('Escape')
  await expect(tree()).toBeFocused()
  await window.keyboard.press('?')
  await expect(help()).toBeVisible()
}

const rowTexts = async () => (await rows().allTextContents()).map((text) => text.toLowerCase())

test('? opens the list on the nine sections with focus in the search field', async () => {
  await openHelp()
  await expect(field()).toBeFocused()
  await expect(headings()).toHaveCount(9)
  for (const [at, title] of TITLES.entries()) {
    await expect(headings().nth(at)).toContainText(title)
    await expect(help().getByRole('table', { name: title })).toBeVisible()
  }
  await expect(rows()).toHaveCount(85)
  await expect(status()).toHaveText('85 shortcuts in 9 sections')
})

test('shift keeps only the rows that hold it, with each heading counting N of M', async () => {
  await openHelp()
  await field().fill('shift')
  const texts = await rowTexts()
  expect(texts.length).toBeGreaterThan(0)
  expect(texts.length).toBeLessThan(85)
  // A Shift key in the action text draws as the ⇧ keycap.
  for (const text of texts) expect(text).toMatch(/shift|⇧/)

  const count = await headings().count()
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThan(9)
  for (let at = 0; at < count; at += 1)
    await expect(headings().nth(at)).toContainText(/\d+ of \d+$/)
  await expect(status()).toHaveText(
    `${String(texts.length)} shortcuts in ${String(count)} sections`,
  )
})

test('cmd, ⌘ and ctrl give the same rows, and a section title shows the whole section', async () => {
  await openHelp()
  await field().fill('cmd')
  const cmd = await rowTexts()
  expect(cmd.length).toBeGreaterThan(0)
  for (const word of ['⌘', 'ctrl', 'CTRL']) {
    await field().fill(word)
    expect(await rowTexts(), word).toEqual(cmd)
  }

  await field().fill('pickers')
  const menus = help().getByRole('table', { name: 'Menus and pickers' })
  await expect(menus.locator('tbody tr')).toHaveCount(10)
  await expect(headings().filter({ hasText: 'Menus and pickers' })).toContainText('10 of 10')
})

test('matches in the action text are marked, and keycaps are not', async () => {
  await openHelp()
  await field().fill('shift')
  await expect(help().locator('mark').first()).toBeVisible()
  await expect(help().locator('kbd mark')).toHaveCount(0)
  for (const mark of await help().locator('mark').allTextContents()) {
    expect(mark.toLowerCase()).toBe('shift')
  }
  // A key match alone marks nothing in the keycap.
  await expect(help().locator('kbd', { hasText: '⇧' }).first()).toBeVisible()
})

test('a mouse gesture draws a pointer pill, not a keycap', async () => {
  await openHelp()
  const clicks = help().getByRole('table', { name: 'Click on a row' })
  await expect(clicks.locator('tbody tr')).toHaveCount(10)
  // The status dot row holds a pill with a pointer and no keycap of its own.
  const dot = clicks.locator('tbody tr', { hasText: 'status dot' }).first()
  await expect(dot.locator('svg')).toHaveCount(1)
  await expect(dot.locator('td').first().locator('kbd')).toHaveCount(0)
  // Shift+click is a pill that holds the Shift keycap.
  const shiftClick = help()
    .getByRole('table', { name: 'Select and reorder' })
    .locator('tbody tr', { hasText: 'Shift click' })
  await expect(shiftClick.locator('td').first().locator('svg')).toHaveCount(1)
  await expect(shiftClick.locator('td').first().locator('kbd')).toHaveText('⇧')
})

test('no match says so, offers Clear search and the live region reads the count', async () => {
  await openHelp()
  await field().fill('zzzz')
  await expect(help().getByText("No shortcut matches 'zzzz'")).toBeVisible()
  await expect(rows()).toHaveCount(0)
  await expect(status()).toHaveText('0 shortcuts in 0 sections')

  await help().getByRole('button', { name: 'Clear search' }).click()
  await expect(field()).toHaveValue('')
  await expect(field()).toBeFocused()
  await expect(rows()).toHaveCount(85)
  await expect(status()).toHaveText('85 shortcuts in 9 sections')
})

test('Esc clears the field and keeps the dialog, then closes it and returns focus', async () => {
  await openHelp()
  await window.keyboard.type('?')
  await expect(field()).toHaveValue('?')
  await expect(help()).toBeVisible()

  await field().fill('shift')
  await window.keyboard.press('Escape')
  await expect(field()).toHaveValue('')
  await expect(help()).toBeVisible()
  await expect(rows()).toHaveCount(85)

  await window.keyboard.press('Escape')
  await expect(help()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('Esc clears the field from the Clear search and Close buttons, and closes only when it is empty', async () => {
  await openHelp()
  await field().fill('zzzz')
  await help().getByRole('button', { name: 'Clear search' }).focus()
  await window.keyboard.press('Escape')
  await expect(help()).toBeVisible()
  await expect(field()).toHaveValue('')
  await expect(rows()).toHaveCount(85)

  await field().fill('shift')
  await help().getByRole('button', { name: 'Close' }).focus()
  await window.keyboard.press('Escape')
  await expect(help()).toBeVisible()
  await expect(field()).toHaveValue('')

  await help().getByRole('button', { name: 'Close' }).focus()
  await window.keyboard.press('Escape')
  await expect(help()).toHaveCount(0)
})

test('Esc during an IME composition leaves the field alone', async () => {
  await openHelp()
  await field().fill('shift')
  await field().evaluate((input) => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
    )
  })
  await expect(field()).toHaveValue('shift')
  await expect(help()).toBeVisible()
})

test('what a keycap shows finds its row', async () => {
  await openHelp()
  await field().fill('⌘k')
  const cmdK = await rowTexts()
  expect(cmdK.length).toBeGreaterThan(0)
  await field().fill('cmd+k')
  expect(await rowTexts()).toEqual(cmdK)
  await field().fill('escape')
  const escape = await rowTexts()
  await field().fill('esc')
  expect(await rowTexts()).toEqual(escape)
})

/** The page and the dialog never scroll sideways, and the sections flow in `columns` columns. */
async function expectLayout(columns: number, where: string) {
  const layout = await help().evaluate((dialog) => {
    const lefts = new Set(
      [...dialog.querySelectorAll('h3')].map((h3) => Math.round(h3.getBoundingClientRect().left)),
    )
    return {
      columns: lefts.size,
      dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(layout, where).toEqual({ columns, dialogOverflow: 0, pageOverflow: 0 })
}

/** Sets the window's content width, below the app's own minimum as a zoom would. */
async function resize(width: number, height = 800) {
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

for (const scheme of ['light', 'dark'] as const) {
  test(`the sections flow in two columns at 1440px and one at 640px in ${scheme}`, async () => {
    await window.emulateMedia({ colorScheme: scheme })
    await resize(1440)
    await openHelp()
    await expectLayout(2, `1440px ${scheme}`)

    // Wide fonts wrap more, but never push a column off the dialog.
    const wide = await window.addStyleTag({
      content: '* { font-family: Verdana, sans-serif !important }',
    })
    await expectLayout(2, `1440px ${scheme} in Verdana`)
    await wide.evaluate((node) => {
      node.parentNode?.removeChild(node)
    })

    await resize(640)
    await expectLayout(1, `640px ${scheme}`)
    const narrow = await window.addStyleTag({
      content: '* { font-family: Verdana, sans-serif !important }',
    })
    await expectLayout(1, `640px ${scheme} in Verdana`)
    await narrow.evaluate((node) => {
      node.parentNode?.removeChild(node)
    })
  })
}
