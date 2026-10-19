import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, peekRow, releaseEdit, SITE } from './harness.js'

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

test('shows the login screen, and keeps it for a token Jira rejects', async () => {
  await expect(window.getByRole('heading', { name: 'Log in to Jira' })).toBeVisible()
  await logIn(window, 'wrong-token')
  await expect(window.getByRole('alert')).toContainText('rejected')
  await expect(window.getByRole('heading', { name: 'Log in to Jira' })).toBeVisible()
})

test('logs in to the layout and logs out again', async () => {
  await logIn(window)

  await expect(window.getByRole('navigation', { name: 'Main' })).toBeVisible()
  const tree = window.getByRole('tree', { name: 'Issues' })
  const row = tree.getByRole('treeitem', { name: /PSAPAC-3,/ })
  await expect(row).toBeVisible()
  await expect(window.getByRole('complementary', { name: 'Peek' })).toHaveCount(0)

  await peekRow(row)
  const detail = window.getByRole('complementary', { name: 'Peek' })
  await expect(detail.getByRole('heading', { name: 'Fix the export timeout' })).toBeVisible()
  await expect(detail.getByText('PSAPAC-3')).toBeVisible()
  await expect(detail.getByText('Bug')).toBeVisible()
  // Status and Assignee are the page's own pickers (D7), whose closed lists also hold their text.
  await expect(detail.getByRole('button', { name: 'Status: To Do' })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Assignee: Unassigned' })).toBeVisible()

  await window.getByRole('button', { name: 'Log out' }).click()
  await expect(window.getByRole('heading', { name: 'Log in to Jira' })).toBeVisible()
  // Settings keep the site and project, so the form starts filled. The token is never kept.
  await expect(window.getByLabel('Site URL')).toHaveValue(SITE)
  await expect(window.getByLabel('API token')).toHaveValue('')
})

test('updates a summary before Jira answers, and restores it when Jira refuses', async () => {
  await logIn(window)
  await peekRow(window.getByRole('treeitem', { name: /Migrate the dashboards/ }))
  const detail = window.getByRole('complementary', { name: 'Peek' })
  // The Peek reads the description once it has held still on the row, before the edit below.
  await expect.poll(async () => (await counts(app)).issueReads).toEqual(['PSAPAC-4'])
  const searched = (await counts(app)).searches.unresolved

  await detail.getByRole('button', { name: 'Migrate the dashboards' }).click()
  await detail.getByLabel('Summary').fill('Migrate the reports')
  await detail.getByLabel('Summary').press('Enter')
  // The fake holds the edit until released, so Jira has not answered while both views show it.
  await expect.poll(async () => (await counts(app)).edits).toBe(1)
  await expect(detail.getByRole('heading', { name: 'Migrate the reports' })).toBeVisible()
  await expect(window.getByRole('treeitem', { name: /Migrate the reports/ })).toBeVisible()
  expect((await counts(app)).applied).toBe(0)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(1)
  // Only the edited issue is read again; no list reloads. The first read is the Peek's description.
  await expect.poll(async () => (await counts(app)).issueReads).toEqual(['PSAPAC-4', 'PSAPAC-4'])
  expect((await counts(app)).searches.unresolved).toBe(searched)

  await detail.getByRole('button', { name: 'Migrate the reports' }).click()
  await detail.getByLabel('Summary').fill('reject me')
  await detail.getByLabel('Summary').press('Enter')
  await expect.poll(async () => (await counts(app)).edits).toBe(2)
  await expect(detail.getByRole('heading', { name: 'reject me' })).toBeVisible()
  await releaseEdit(app)
  await expect(detail.getByRole('alert')).toContainText('shows its old one again')
  await expect(detail.getByRole('heading', { name: 'Migrate the reports' })).toBeVisible()
  await expect(window.getByRole('treeitem', { name: /reject me/ })).toHaveCount(0)
})

test('refetches the issues when the window regains focus', async () => {
  await logIn(window)
  await expect(window.getByRole('tree', { name: 'Issues' })).toBeVisible()
  // The Done query is not stale after one focus, so only the unresolved phase refetches.
  await expect.poll(async () => (await counts(app)).searches.unresolved).toBeGreaterThan(0)
  const before = (await counts(app)).searches.unresolved

  await app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows()
    first?.emit('blur')
    first?.emit('focus')
  })
  await expect.poll(async () => (await counts(app)).searches.unresolved).toBeGreaterThan(before)
})

test('follows the system theme and lets the toggle override it', async () => {
  const background = () =>
    window.evaluate<string>('getComputedStyle(document.body).backgroundColor')
  const attribute = () =>
    window.evaluate<string | null>('document.documentElement.dataset.theme ?? null')

  await window.emulateMedia({ colorScheme: 'light' })
  const light = await background()
  await window.emulateMedia({ colorScheme: 'dark' })
  const dark = await background()
  expect(dark).not.toBe(light)
  expect(await attribute()).toBeNull()

  await logIn(window)
  const theme = window.getByRole('group', { name: 'Theme' })
  await expect(theme.getByRole('button', { name: 'System' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // The choices are icons: no visible words, each named by its tooltip.
  await expect(theme).toHaveText('')
  for (const name of ['System', 'Light', 'Dark']) {
    const button = theme.getByRole('button', { name })
    await expect(button).toHaveAttribute('title', name)
    await expect(button.locator('svg')).toBeVisible()
  }

  // Forcing a theme beats the system setting.
  await theme.getByRole('button', { name: 'Light' }).click()
  expect(await attribute()).toBe('light')
  expect(await background()).toBe(light)
  await window.emulateMedia({ colorScheme: 'light' })
  await theme.getByRole('button', { name: 'Dark' }).click()
  expect(await attribute()).toBe('dark')
  expect(await background()).toBe(dark)

  // The choice survives a reload, and System hands control back to the OS.
  await window.reload()
  expect(await attribute()).toBe('dark')
  await window.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'System' }).click()
  expect(await attribute()).toBeNull()
  expect(await background()).toBe(light)
})

test('refuses every permission request from the page', async () => {
  // Electron grants notifications and the like unless the main process refuses them.
  const answer = await window.evaluate<string>('Notification.requestPermission()')
  expect(answer).toBe('denied')
})

test('opens its window without taking focus from the user', async () => {
  test.skip(process.platform !== 'darwin', 'focus semantics differ under xvfb')
  // The window shows on ready-to-show, so wait for that before reading its focus.
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false),
    )
    .toBe(true)
  const focused = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFocused() ?? null,
  )
  expect(focused).toBe(false)
})

test('opens its window invisible, so it never shows on the user screen', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps a window on a display, so opacity hides it')
  const opacity = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getOpacity() ?? null,
  )
  expect(opacity).toBe(0)
})

test('parks its window in the display corner, away from the real cursor', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps a window on a display, so it is parked')
  // Click-through still lets the real cursor's moves reach the page, so the window sits where the
  // cursor rarely goes: only the 40px macOS keeps on screen (and the title bar's 115) shows.
  const shown = await app.evaluate(({ BrowserWindow, screen }) => {
    const b = BrowserWindow.getAllWindows()[0]?.getBounds()
    const d = screen.getPrimaryDisplay().bounds
    if (b === undefined) return null
    return {
      w: Math.min(b.x + b.width, d.x + d.width) - Math.max(b.x, d.x),
      h: Math.min(b.y + b.height, d.y + d.height) - Math.max(b.y, d.y),
    }
  })
  expect(shown).not.toBeNull()
  expect(shown?.w).toBeLessThanOrEqual(120)
  expect(shown?.h).toBeLessThanOrEqual(120)
})
