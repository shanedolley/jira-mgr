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
  await logIn(window)
  await expect(window.getByRole('tree', { name: 'Issues' })).toBeVisible()
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const avatar = () => window.getByRole('button', { name: 'User menu' })
const menu = () => window.getByRole('menu', { name: 'User menu' })
const themeRow = () => menu().getByRole('menuitem', { name: 'Theme' })
const themeMenu = () => window.getByRole('menu', { name: 'Theme' })
const theme = () => window.evaluate<string | null>('document.documentElement.dataset.theme ?? null')

test('the footer avatar opens a menu with the site, the email and three items', async () => {
  await expect(avatar()).toContainText('me@example.com')
  await avatar().click()
  await expect(menu()).toContainText('fake.atlassian.net')
  await expect(menu()).toContainText('me@example.com')
  await expect(menu().getByRole('menuitem')).toHaveText(['Theme', 'Keyboard shortcuts', 'Log out'])
  await expect(themeRow()).toBeFocused()
})

test('Enter and Space on the focused avatar open the menu', async () => {
  for (const key of ['Enter', ' ']) {
    await avatar().focus()
    await window.keyboard.press(key)
    await expect(menu()).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(menu()).toBeHidden()
  }
})

test('arrows move, Right opens the submenu, Left closes it, Esc closes the menu and returns focus', async () => {
  await avatar().focus()
  await window.keyboard.press('Enter')
  await expect(themeRow()).toBeFocused()

  await window.keyboard.press('ArrowDown')
  await expect(menu().getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(menu().getByRole('menuitem', { name: 'Log out' })).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(themeRow()).toBeFocused()
  await window.keyboard.press('ArrowUp')
  await expect(menu().getByRole('menuitem', { name: 'Log out' })).toBeFocused()
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('ArrowUp')
  await expect(themeRow()).toBeFocused()

  await window.keyboard.press('ArrowRight')
  await expect(themeMenu()).toBeVisible()
  await expect(themeMenu().getByRole('menuitemradio', { name: 'System' })).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(themeMenu().getByRole('menuitemradio', { name: 'Light' })).toBeFocused()
  await window.keyboard.press('ArrowLeft')
  await expect(themeMenu()).toBeHidden()
  await expect(menu()).toBeVisible()
  await expect(themeRow()).toBeFocused()

  // Enter opens the submenu as Right does, and Esc closes only the submenu.
  await window.keyboard.press('Enter')
  await expect(themeMenu()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(themeMenu()).toBeHidden()
  await expect(menu()).toBeVisible()
  await expect(themeRow()).toBeFocused()

  await window.keyboard.press('Escape')
  await expect(menu()).toBeHidden()
  await expect(avatar()).toBeFocused()
})

test('Enter on a theme choice sets it and closes the menu', async () => {
  await avatar().focus()
  await window.keyboard.press('Enter')
  await expect(themeRow()).toBeFocused()
  await window.keyboard.press('ArrowRight')
  await expect(themeMenu().getByRole('menuitemradio', { name: 'System' })).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowDown')
  await expect(themeMenu().getByRole('menuitemradio', { name: 'Dark' })).toBeFocused()
  await window.keyboard.press('Enter')
  await expect(menu()).toBeHidden()
  expect(await theme()).toBe('dark')
  await expect(avatar()).toBeFocused()
})

test('Keyboard shortcuts opens the shortcuts dialog', async () => {
  await avatar().click()
  await menu().getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
  await expect(window.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
})

test('the palette runs each theme choice and Log out', async () => {
  const palette = () => window.getByRole('dialog', { name: 'Search issues' })
  const run = async (query: string, name: string) => {
    await window.keyboard.press('Meta+k')
    await palette().getByRole('combobox').fill(query)
    await palette().getByRole('option', { name, exact: true }).click()
    await expect(palette()).toHaveCount(0)
  }

  await run('theme', 'Theme: Dark')
  expect(await theme()).toBe('dark')
  await run('theme', 'Theme: Light')
  expect(await theme()).toBe('light')
  await run('theme', 'Theme: System')
  expect(await theme()).toBeNull()

  await run('log out', 'Log out')
  await expect(window.getByRole('heading', { name: 'Log in to Jira' })).toBeVisible()
})

test('under 960px the rail avatar opens the same menu', async () => {
  // The app's own minimum is 900px; zoom reaches 720 CSS px, so the test lifts the minimum.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.setMinimumSize(1, 1)
    win?.setContentSize(720, 700)
  })
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(720)
  await expect(window.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
  await expect(avatar()).toBeVisible()
  await avatar().click()
  await expect(menu()).toContainText('me@example.com')
  await expect(menu().getByRole('menuitem')).toHaveText(['Theme', 'Keyboard shortcuts', 'Log out'])
  await window.keyboard.press('Escape')
  await expect(menu()).toBeHidden()
  await expect(avatar()).toBeFocused()
})
