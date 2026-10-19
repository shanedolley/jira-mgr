import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { joinSprint, launch, logIn, peekRow } from './harness.js'

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

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const sidebar = () => window.getByRole('navigation', { name: 'Main' })

async function open() {
  await joinSprint(app, ['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-13'], 5)
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
}

const regionOf = (el: Locator) =>
  el.evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'))

/**
 * Reads the header's drag state: its own `-webkit-app-region`, that of every control in it, and
 * whether some point along its middle line lands on the header itself (its blank space).
 */
function audit(scope: Locator) {
  return scope
    .locator('header')
    .first()
    .evaluate((header) => {
      const region = (el: Element) => getComputedStyle(el).getPropertyValue('-webkit-app-region')
      const controls = [
        ...header.querySelectorAll('button, a, input, select, textarea, [role=button], [tabindex]'),
      ]
      const box = header.getBoundingClientRect()
      const y = box.top + box.height / 2
      let blank = false
      for (let x = box.left + 4; x < box.right && !blank; x += 4) {
        blank = document.elementFromPoint(x, y) === header
      }
      return {
        header: region(header),
        controls: controls.map((el) => ({
          name:
            el.textContent.trim() === ''
              ? (el.getAttribute('aria-label') ?? el.tagName)
              : el.textContent.trim(),
          region: region(el),
        })),
        blank,
      }
    })
}

async function expectDragHeader(scope: Locator) {
  await expect(scope.locator('header').first()).toBeVisible()
  const got = await audit(scope)
  expect(got.header).toBe('drag')
  expect(got.controls.length).toBeGreaterThan(0)
  for (const control of got.controls)
    expect(control, control.name).toMatchObject({ region: 'no-drag' })
  expect(got.blank).toBe(true)
}

test('the Issues header moves the window by its blank space and keeps its buttons clickable', async () => {
  await open()
  const list = window.getByRole('region', { name: 'Issue list' })
  await expectDragHeader(list)
  await list.getByRole('button', { name: /^Shortcuts/ }).click()
  const dialog = window.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // The dialog reaches into the header's strip, so it and its Close button must take clicks.
  expect(await regionOf(dialog)).toBe('no-drag')
  expect(await regionOf(dialog.getByRole('button', { name: 'Close' }))).toBe('no-drag')
})

test('the Issues header stays a drag region under 960px', async () => {
  await open()
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.setMinimumSize(1, 1)
    win?.setContentSize(720, 700)
  })
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(720)
  await expectDragHeader(window.getByRole('region', { name: 'Issue list' }))
})

test('the Inbox, Epics and Customers headers are drag regions', async () => {
  await open()
  await sidebar()
    .getByRole('link', { name: /^Inbox/ })
    .click()
  await expectDragHeader(window.getByRole('region', { name: 'Inbox' }))
  for (const name of ['Epics', 'Customers']) {
    await sidebar().getByRole('link', { name, exact: true }).click()
    await expectDragHeader(window.getByRole('region', { name }))
  }
})

test('the Sprint page and Issue page headers are drag regions', async () => {
  await open()
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expectDragHeader(window.getByRole('region', { name: 'Sprint page' }))
  await sidebar()
    .getByRole('link', { name: /^Issues/ })
    .click()
  await peekRow(item(/PSAPAC-10,/))
  await window.keyboard.press('Enter')
  await expectDragHeader(window.getByRole('region', { name: 'Issue page' }))
})

test('the overlay sidebar scrim takes the click in the header strip', async () => {
  await open()
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.setMinimumSize(1, 1)
    win?.setContentSize(720, 700)
  })
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(720)
  const header = window.getByRole('region', { name: 'Issue list' }).locator('header')
  expect(await regionOf(header)).toBe('drag')
  await window.getByRole('button', { name: 'Show sidebar' }).click()
  const scrim = window.locator('[data-scrim]')
  await expect(scrim).toBeAttached()
  expect(await regionOf(header)).toBe('no-drag')
  // The sidebar's own strip, beside the traffic lights, still moves the window.
  expect(await regionOf(sidebar().locator('.app-drag').first())).toBe('drag')
  await window.mouse.click(600, 10)
  await expect(scrim).toHaveCount(0)
  expect(await regionOf(header)).toBe('drag')
})
