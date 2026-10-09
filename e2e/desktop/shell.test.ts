import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

// The e2e entry runs the real app on a fake Jira and a fake Keychain, and needs JM_STATE_DIR.
const entry = fileURLToPath(new URL('../../apps/desktop/out/main/e2e.js', import.meta.url))

const SITE = 'https://fake.atlassian.net'
const TOKEN = 'good-token'
/** Counters the fake Jira in the app's main process keeps. */
interface Counts {
  searches: number
  edits: number
  applied: number
}

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  app = await electron.launch({
    // GitHub's Linux runners lack the setuid sandbox helper, so CI runs without it.
    args: process.env.CI ? ['--no-sandbox', entry] : [entry],
    env: { ...process.env, JM_STATE_DIR: stateDir },
  })
  window = await app.firstWindow()
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const counts = () =>
  app.evaluate(() => (globalThis as unknown as { __fakeJira: Counts }).__fakeJira)

async function logIn(token = TOKEN) {
  await window.getByLabel('Site URL').fill(SITE)
  await window.getByLabel('Project key').fill('PSAPAC')
  await window.getByLabel('Email').fill('me@example.com')
  await window.getByLabel('API token').fill(token)
  await window.getByRole('button', { name: 'Log in' }).click()
}

test('shows the login screen, and keeps it for a token Jira rejects', async () => {
  await expect(window.getByRole('heading', { name: 'Log in to Jira' })).toBeVisible()
  await logIn('wrong-token')
  await expect(window.getByRole('alert')).toContainText('rejected')
  await expect(window.getByRole('heading', { name: 'Log in to Jira' })).toBeVisible()
})

test('logs in to the layout and logs out again', async () => {
  await logIn()

  await expect(window.getByRole('navigation', { name: 'Main' })).toBeVisible()
  const rows = window.getByRole('list', { name: 'Issues' }).getByRole('button')
  await expect(rows).toHaveCount(4)
  await expect(window.getByText('Select an issue to see it here.')).toBeVisible()

  await rows.filter({ hasText: 'Fix the export timeout' }).click()
  const detail = window.getByRole('complementary', { name: 'Issue detail' })
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
  await logIn()
  await window.getByRole('button', { name: /Migrate the dashboards/ }).click()
  const detail = window.getByRole('complementary', { name: 'Issue detail' })

  await detail.getByRole('button', { name: 'Edit summary' }).click()
  await detail.getByLabel('Summary').fill('Migrate the reports')
  await detail.getByRole('button', { name: 'Save' }).click()
  // Both the detail and the list show it while the fake still holds the request.
  await expect(detail.getByRole('heading', { name: 'Migrate the reports' })).toBeVisible()
  await expect(window.getByRole('button', { name: /Migrate the reports/ })).toBeVisible()
  expect((await counts()).applied).toBe(0)
  await expect.poll(async () => (await counts()).applied).toBe(1)

  await detail.getByRole('button', { name: 'Edit summary' }).click()
  await detail.getByLabel('Summary').fill('reject me')
  await detail.getByRole('button', { name: 'Save' }).click()
  await expect(detail.getByRole('heading', { name: 'reject me' })).toBeVisible()
  await expect(detail.getByRole('alert')).toContainText('shows its old one again')
  await expect(detail.getByRole('heading', { name: 'Migrate the reports' })).toBeVisible()
  await expect(window.getByRole('button', { name: /reject me/ })).toHaveCount(0)
})

test('refetches the issues when the window regains focus', async () => {
  await logIn()
  await expect(window.getByRole('list', { name: 'Issues' })).toBeVisible()
  await expect.poll(async () => (await counts()).searches).toBeGreaterThan(0)
  const before = (await counts()).searches

  await app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows()
    first?.emit('blur')
    first?.emit('focus')
  })
  await expect.poll(async () => (await counts()).searches).toBeGreaterThan(before)
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

  await logIn()
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
