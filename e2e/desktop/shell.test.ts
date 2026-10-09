import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { SITE, counts, launch, logIn, releaseEdit } from './harness.js'

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

  await row.click()
  const detail = window.getByRole('complementary', { name: 'Peek' })
  await expect(detail.getByRole('heading', { name: 'Fix the export timeout' })).toBeVisible()
  await expect(detail.getByText('PSAPAC-3')).toBeVisible()
  await expect(detail.getByText('Bug')).toBeVisible()
  await expect(detail.getByText('To Do')).toBeVisible()
  await expect(detail.getByText('Unassigned')).toBeVisible()

  await window.getByRole('button', { name: 'Log out' }).click()
  await expect(window.getByRole('heading', { name: 'Log in to Jira' })).toBeVisible()
  // Settings keep the site and project, so the form starts filled. The token is never kept.
  await expect(window.getByLabel('Site URL')).toHaveValue(SITE)
  await expect(window.getByLabel('API token')).toHaveValue('')
})

test('updates a summary before Jira answers, and restores it when Jira refuses', async () => {
  await logIn(window)
  await window.getByRole('treeitem', { name: /Migrate the dashboards/ }).click()
  const detail = window.getByRole('complementary', { name: 'Peek' })

  await detail.getByRole('button', { name: 'Edit summary' }).click()
  await detail.getByLabel('Summary').fill('Migrate the reports')
  await detail.getByRole('button', { name: 'Save' }).click()
  // The fake holds the edit until released, so Jira has not answered while both views show it.
  await expect.poll(async () => (await counts(app)).edits).toBe(1)
  await expect(detail.getByRole('heading', { name: 'Migrate the reports' })).toBeVisible()
  await expect(window.getByRole('treeitem', { name: /Migrate the reports/ })).toBeVisible()
  expect((await counts(app)).applied).toBe(0)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(1)

  await detail.getByRole('button', { name: 'Edit summary' }).click()
  await detail.getByLabel('Summary').fill('reject me')
  await detail.getByRole('button', { name: 'Save' }).click()
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
