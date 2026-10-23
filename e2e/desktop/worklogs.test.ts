import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, logWork, peekRow, releaseEdit } from './harness.js'

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

const MINUTE = 60
const HOUR = 3600
const DAY_MS = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString()

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const list = (key: string) =>
  window.getByRole('dialog', { name: new RegExp(`^Worklogs on ${key}:`) })
const rows = (key: string) => list(key).getByRole('listitem')
const logModal = (key: string) => window.getByRole('dialog', { name: `Log work on ${key}` })
const logForm = (key: string) => logModal(key).getByRole('form', { name: 'Log work' })
const logButton = (key: string) => list(key).getByRole('button', { name: 'Log work', exact: true })

const writes = async () => (await counts(app)).edits

/** Logs in and puts the pointer, focus and Peek on the issue, as a user does before a letter key. */
async function open(row = /PSAPAC-4,/) {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await peekRow(item(row))
  await expect(peek()).toBeVisible()
}

/** PSAPAC-4 holds 2h, 30m and 1h, added out of date order: 3, 1 and 2 days back. */
async function seedOutOfOrder() {
  await logWork(app, 'PSAPAC-4', daysAgo(3), 2 * HOUR)
  await logWork(app, 'PSAPAC-4', daysAgo(1), 30 * MINUTE)
  await logWork(app, 'PSAPAC-4', daysAgo(2), HOUR)
}

test('W opens the Worklogs modal: every worklog, newest start first, with the total', async () => {
  await seedOutOfOrder()
  await open()

  await window.keyboard.press('w')
  await expect(list('PSAPAC-4')).toBeVisible()
  await expect(list('PSAPAC-4').getByRole('heading')).toContainText('Worklogs on PSAPAC-4: ')
  await expect(rows('PSAPAC-4')).toHaveCount(3)
  await expect(rows('PSAPAC-4').nth(0)).toContainText(/logged\s*30m/)
  await expect(rows('PSAPAC-4').nth(1)).toContainText(/logged\s*1h/)
  await expect(rows('PSAPAC-4').nth(2)).toContainText(/logged\s*2h/)
  await expect(list('PSAPAC-4')).toContainText('Logged 3h 30m')
  await expect(logButton('PSAPAC-4')).toBeFocused()

  await window.keyboard.press('Escape')
  await expect(list('PSAPAC-4')).toHaveCount(0)
  await expect(tree()).toBeFocused()

  // Shift+W acts like W.
  await window.keyboard.press('Shift+W')
  await expect(list('PSAPAC-4')).toBeVisible()
})

test('the issue with no worklog says so', async () => {
  await open(/PSAPAC-13,/)
  await window.keyboard.press('w')
  await expect(list('PSAPAC-13')).toContainText('No work logged')
  await expect(logButton('PSAPAC-13')).toBeVisible()
})

test('only the list scrolls: the header, Log work and Close stay in view, in a wide font too', async () => {
  for (let day = 1; day <= 30; day++) await logWork(app, 'PSAPAC-4', daysAgo(day), 15 * MINUTE)
  await open()
  await window.keyboard.press('w')
  await expect(rows('PSAPAC-4')).toHaveCount(30)

  const measure = () =>
    list('PSAPAC-4').evaluate((dialog) => {
      const ul = dialog.querySelector('ul')
      return {
        dialogOverflow: dialog.scrollHeight - dialog.clientHeight,
        listOverflow: (ul?.scrollHeight ?? 0) - (ul?.clientHeight ?? 0),
        sideways: dialog.scrollWidth - dialog.clientWidth,
      }
    })
  const stays = async () => {
    const box = await measure()
    expect(box.dialogOverflow).toBeLessThanOrEqual(0)
    expect(box.listOverflow).toBeGreaterThan(0)
    expect(box.sideways).toBe(0)
    await expect(list('PSAPAC-4').getByRole('heading')).toBeInViewport()
    await expect(logButton('PSAPAC-4')).toBeInViewport()
    await expect(list('PSAPAC-4').getByRole('button', { name: 'Close' })).toBeInViewport()
  }
  await stays()
  await list('PSAPAC-4')
    .locator('ul')
    .evaluate((ul) => {
      ul.scrollTop = ul.scrollHeight
    })
  await stays()

  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  await stays()
})

test('the Log work button and Shift+T open the form over the list, and Esc returns to the list', async () => {
  await seedOutOfOrder()
  await open()
  await window.keyboard.press('w')
  await expect(rows('PSAPAC-4')).toHaveCount(3)

  await logButton('PSAPAC-4').click()
  await expect(logForm('PSAPAC-4').getByLabel('Time spent')).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(logModal('PSAPAC-4')).toHaveCount(0)
  await expect(list('PSAPAC-4')).toBeVisible()
  await expect(logButton('PSAPAC-4')).toBeFocused()

  await window.keyboard.press('Shift+T')
  await expect(logForm('PSAPAC-4').getByLabel('Time spent')).toBeFocused()
  await logForm('PSAPAC-4').getByRole('button', { name: 'Cancel' }).click()
  await expect(logModal('PSAPAC-4')).toHaveCount(0)
  await expect(list('PSAPAC-4')).toBeVisible()
})

test('Shift+T works after a click on blank space in the list', async () => {
  await open()
  await window.keyboard.press('w')
  await list('PSAPAC-4').getByRole('heading').click()
  await window.keyboard.press('Shift+T')
  await expect(logModal('PSAPAC-4')).toBeVisible()
})

test('a worklog logged from the list lands in date order and the total updates', async () => {
  await logWork(app, 'PSAPAC-4', daysAgo(3), 2 * HOUR)
  await logWork(app, 'PSAPAC-4', daysAgo(1), 30 * MINUTE)
  await open()
  await window.keyboard.press('w')
  await expect(list('PSAPAC-4')).toContainText('Logged 2h 30m')

  await window.keyboard.press('Shift+T')
  await logForm('PSAPAC-4').getByLabel('Time spent').fill('1h')
  await logForm('PSAPAC-4').getByLabel('Started').fill(daysAgo(2).slice(0, 10))
  await logForm('PSAPAC-4').getByLabel('Comment').fill('Between the two')
  await logForm('PSAPAC-4').getByLabel('Time spent').press('Enter')
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)

  await expect(logModal('PSAPAC-4')).toHaveCount(0)
  await expect(rows('PSAPAC-4')).toHaveCount(3)
  await expect(rows('PSAPAC-4').nth(0)).toContainText(/logged\s*30m/)
  await expect(rows('PSAPAC-4').nth(1)).toContainText(/logged\s*1h/)
  await expect(rows('PSAPAC-4').nth(1)).toContainText('Between the two')
  await expect(rows('PSAPAC-4').nth(2)).toContainText(/logged\s*2h/)
  await expect(list('PSAPAC-4')).toContainText('Logged 3h 30m')
})

test('Edit and Delete work on your own rows only, as on the issue page', async () => {
  // PSAPAC-2 holds 1h by the signed-in user at 03:00 and 30m by another user at 04:00.
  await open(/PSAPAC-2,/)
  await window.keyboard.press('w')
  await expect(rows('PSAPAC-2')).toHaveCount(2)
  await expect(rows('PSAPAC-2').nth(0)).toContainText(/logged\s*30m/)
  await expect(rows('PSAPAC-2').nth(0).getByRole('button')).toHaveCount(0)
  await expect(rows('PSAPAC-2').nth(1)).toContainText(/logged\s*1h/)
  await expect(list('PSAPAC-2')).toContainText('Logged 1h 30m')

  await rows('PSAPAC-2').nth(1).getByRole('button', { name: 'Edit worklog' }).click()
  const edit = list('PSAPAC-2').getByRole('form', { name: 'Edit worklog' })
  await edit.getByLabel('Time spent').fill('2h')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)
  await expect(rows('PSAPAC-2').nth(1)).toContainText(/logged\s*2h/)
  await expect(list('PSAPAC-2')).toContainText('Logged 2h 30m')

  await rows('PSAPAC-2').nth(1).getByRole('button', { name: 'Delete worklog' }).click()
  await list('PSAPAC-2').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(writes).toBe(2)
  await releaseEdit(app)
  await expect(rows('PSAPAC-2')).toHaveCount(1)
  await expect(list('PSAPAC-2')).toContainText('Logged 30m')
})

test('focus stays in the modal after Keep, an edit Cancel and a Delete, so Shift+T and Esc still work', async () => {
  await open(/PSAPAC-2,/)
  await window.keyboard.press('w')
  const own = () => rows('PSAPAC-2').nth(1)
  const inside = () =>
    list('PSAPAC-2').evaluate((dialog) => dialog.contains(document.activeElement))

  await own().getByRole('button', { name: 'Delete worklog' }).click()
  await list('PSAPAC-2').getByRole('button', { name: 'Keep' }).click()
  await expect.poll(inside).toBe(true)

  await own().getByRole('button', { name: 'Edit worklog' }).click()
  await list('PSAPAC-2').getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(inside).toBe(true)

  await own().getByRole('button', { name: 'Delete worklog' }).click()
  await list('PSAPAC-2').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)
  await expect(rows('PSAPAC-2')).toHaveCount(1)
  await expect.poll(inside).toBe(true)

  await window.keyboard.press('Shift+T')
  await expect(logModal('PSAPAC-2')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(logModal('PSAPAC-2')).toHaveCount(0)
  await expect(list('PSAPAC-2')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(list('PSAPAC-2')).toHaveCount(0)
})

test('Shift+T in an edit row keeps its letter for the field and opens no form', async () => {
  await open(/PSAPAC-2,/)
  await window.keyboard.press('w')
  await rows('PSAPAC-2').nth(1).getByRole('button', { name: 'Edit worklog' }).click()
  const comment = list('PSAPAC-2').getByRole('form', { name: 'Edit worklog' }).getByLabel('Comment')
  await comment.focus()
  await window.keyboard.press('Shift+T')
  await expect(comment).toHaveValue('Set up the modelT')
  await expect(logModal('PSAPAC-2')).toHaveCount(0)
})

test('Shift+T logs work and t still starts the timer', async () => {
  await open()
  await window.keyboard.press('Shift+T')
  await expect(logModal('PSAPAC-4')).toBeVisible()
  await expect(peek().getByRole('button', { name: 'Start timer' })).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(logModal('PSAPAC-4')).toHaveCount(0)
  await expect(peek().getByRole('button', { name: 'Start timer' })).toBeVisible()

  await expect(tree()).toBeFocused()
  await window.keyboard.press('t')
  await expect(peek().getByRole('button', { name: 'Stop timer' })).toBeVisible()
  await expect(logModal('PSAPAC-4')).toHaveCount(0)
})

test('W and Shift+T do nothing on an Epic, and type their letters in a text field', async () => {
  await open(/PSAPAC-10,/)
  await window.keyboard.press('w')
  await window.keyboard.press('Shift+T')
  await expect(window.getByRole('dialog')).toHaveCount(0)

  const filter = window.getByLabel('Filter by key or summary')
  await filter.click()
  await window.keyboard.press('w')
  await window.keyboard.press('Shift+T')
  await expect(filter).toHaveValue('wT')
  await expect(window.getByRole('dialog')).toHaveCount(0)
})

test('the issue menu and the palette offer Worklogs with W and Log work with Shift+T', async () => {
  await logIn(window)
  await expect(item(/PSAPAC-4,/)).toBeVisible()

  await item(/PSAPAC-4,/).click({ button: 'right' })
  const menu = window.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Log work', exact: true })).toHaveAttribute(
    'aria-keyshortcuts',
    'Shift+T',
  )
  const entry = menu.getByRole('menuitem', { name: 'Worklogs', exact: true })
  await expect(entry).toHaveAttribute('aria-keyshortcuts', 'W')
  await entry.click()
  await expect(list('PSAPAC-4')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(list('PSAPAC-4')).toHaveCount(0)

  await item(/PSAPAC-10,/).click({ button: 'right' })
  await expect(window.getByRole('menuitem', { name: 'Comments', exact: true })).toBeVisible()
  await expect(window.getByRole('menuitem', { name: 'Worklogs', exact: true })).toHaveCount(0)
  await window.keyboard.press('Escape')

  await peekRow(item(/PSAPAC-4,/))
  await window.keyboard.press('ControlOrMeta+k')
  const palette = window.getByRole('dialog', { name: 'Search issues' })
  await palette.getByRole('combobox').fill('worklogs')
  await palette.getByRole('option', { name: /^Worklogs/ }).click()
  await expect(list('PSAPAC-4')).toBeVisible()
})
