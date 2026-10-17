/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { joinSprint, launch, logIn, logWork, showEverything } from './harness.js'

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
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const sprintRow = (key: string) => sprintPage().locator(`li[data-issue-key=${key}]`)
/** The button under a row's content, which opens the issue. */
const overlay = (key: string) => sprintPage().getByRole('button', { name: new RegExp(`^${key} `) })

/** Every control a Sprint page row can hold, as the nested-interactive rule counts them. */
const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=tab], [contenteditable=true], [tabindex]:not([tabindex="-1"])'

/** The controls on the Sprint page that sit inside another control. */
const nested = () =>
  sprintPage().evaluate((page, selector) => {
    const inside: string[] = []
    for (const control of page.querySelectorAll(selector)) {
      const parent = control.parentElement?.closest(selector)
      if (parent !== null && parent !== undefined) {
        const name = (el: Element) => el.getAttribute('aria-label') ?? el.tagName.toLowerCase()
        inside.push(`${name(control)} in ${name(parent)}`)
      }
    }
    return inside
  }, INTERACTIVE)

async function openSprint() {
  await joinSprint(app, ['PSAPAC-4', 'PSAPAC-13'], 5)
  await logIn(window)
  await expect(tree().getByRole('treeitem', { name: /PSAPAC-10,/ })).toBeVisible()
  await showEverything(window)
  await window.getByRole('button', { name: 'Display', exact: true }).click()
  const chips = window.getByRole('group', { name: 'Display properties', exact: true })
  for (const name of ['Original estimate', 'Logged']) {
    await chips.getByRole('button', { name, exact: true }).click()
  }
  await window.keyboard.press('Escape')
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
  await expect(sprintRow('PSAPAC-4')).toBeVisible()
}

// @axe-core/playwright is not a dependency, so this checks what its nested-interactive rule does.
test('no control on the Sprint page sits inside another, with a slot closed or open', async () => {
  await openSprint()
  const row = sprintRow('PSAPAC-4')
  await expect(row.locator('[data-prop=estimate]')).toBeVisible()
  await expect(row.locator('[data-prop=logged]')).toBeVisible()
  expect(await nested()).toEqual([])

  await row.locator('[data-prop=estimate]').click()
  await expect(window.getByRole('textbox', { name: 'Original estimate' })).toBeFocused()
  expect(await nested()).toEqual([])
})

test('a row button is described by the property values its name leaves out', async () => {
  // PSAPAC-13 has an hour logged; PSAPAC-4 has nothing.
  await logWork(app, 'PSAPAC-13', new Date(Date.now() - 86_400_000).toISOString(), 3600)
  await openSprint()
  await expect(overlay('PSAPAC-13')).toHaveAccessibleDescription(/Logged 1h/)
  const row = overlay('PSAPAC-4')
  await expect(row).toHaveAccessibleName(/^PSAPAC-4 \S/)
  await expect(row).toHaveAccessibleDescription(/Original estimate 2h/)
  // PSAPAC-4 has no work logged, and the Logged slot's name says so.
  await expect(row).toHaveAccessibleDescription(/nothing logged/)
})

test('a row tabs through its controls in order, each with a name', async () => {
  await openSprint()
  await overlay('PSAPAC-4').focus()
  const names = [
    /^Status of PSAPAC-4:/,
    /^Priority of PSAPAC-4:/,
    'Original estimate 2h',
    /^Log work on PSAPAC-4,/,
    /^Assignee of PSAPAC-4:/,
    'Edit summary of PSAPAC-4',
  ]
  for (const name of names) {
    await window.keyboard.press('Tab')
    await expect(sprintRow('PSAPAC-4').getByRole('button', { name })).toBeFocused()
  }
})

test('a click outside a slot opens the issue and a click on a slot runs only its action', async () => {
  await openSprint()
  const row = sprintRow('PSAPAC-4')

  await row.getByRole('button', { name: /^Status of PSAPAC-4:/ }).click()
  // The list takes focus a task after it shows; an Esc before that reaches the page and leaves it.
  await expect(window.getByRole('listbox', { name: 'Status' })).toBeFocused()
  await expect(issuePage()).toHaveCount(0)
  await window.keyboard.press('Escape')
  await expect(window.getByRole('listbox', { name: 'Status' })).toHaveCount(0)

  await row.locator('[data-prop=estimate]').click()
  await expect(window.getByRole('textbox', { name: 'Original estimate' })).toBeFocused()
  await expect(issuePage()).toHaveCount(0)
  await window.keyboard.press('Escape')
  await expect(window.getByRole('textbox', { name: 'Original estimate' })).toHaveCount(0)
  await expect(row.locator('[data-prop=estimate]')).toBeFocused()

  // Near the row's corner, clear of every slot: the content ignores the pointer, so the button under it gets the click.
  await overlay('PSAPAC-4').click({ position: { x: 3, y: 3 } })
  await expect(issuePage()).toBeVisible()
})
