import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  joinSprint,
  launch,
  logIn,
  notices,
  refuseNextEdit,
  releaseEdit,
} from './harness.js'

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
const field = () => dialog().getByLabel('Summary of PSAPAC-4')
const row = () => item(/PSAPAC-4,/)
const text = () => row().getByText('Migrate the dashboards')

/** Where on a summary the pointer lands: on its text, which the Peek's narrowing leaves in the Tree. */
const ON_TEXT = { x: 20, y: 8 }

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1)

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under the pointer.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Makes PSAPAC-4 the active row by hovering it, and leaves focus in the Tree. */
async function select() {
  await open()
  await row().hover()
  await expect(row()).toHaveAttribute('data-active', 'true')
}

test("a single click on a row's summary opens the editor with the summary selected", async () => {
  await select()
  await expect(dialog()).toHaveCount(0)

  await text().click({ position: ON_TEXT })
  // The click neither peeks nor opens the page.
  await expect(peek()).toHaveCount(0)
  await expect(issuePage()).toHaveCount(0)
  await expect(dialog()).toBeVisible()
  await expect(dialog().getByRole('heading', { name: 'Edit summary' })).toBeVisible()
  await expect(field()).toBeFocused()
  await expect(field()).toHaveValue('Migrate the dashboards')
  const selection = await field().evaluate((el: HTMLInputElement) => [
    el.selectionStart,
    el.selectionEnd,
    el.value.length,
  ])
  expect(selection).toEqual([0, 22, 22])
})

test('Enter saves at once, records an undo and returns focus to the Tree', async () => {
  await select()
  await text().click({ position: ON_TEXT })
  await field().fill('Migrate the dashboards again')
  await window.keyboard.press('Enter')

  await expect(dialog()).toHaveCount(0)
  await expect(row()).toHaveAccessibleName(/Migrate the dashboards again/)
  await expect(tree()).toBeFocused()
  await settle(1)
  expect(await lastBody()).toMatchObject({ fields: { summary: 'Migrate the dashboards again' } })

  await window.keyboard.press('Meta+z')
  await expect(row()).toHaveAccessibleName(/Migrate the dashboards,/)
  await settle(2)
})

test('a double-click on blank row space opens the page and no editor', async () => {
  await select()
  await row().locator('.tree-key').dblclick()
  await expect(issuePage().getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
  await window.waitForTimeout(900)
  await expect(dialog()).toHaveCount(0)
})

test('a click on blank row space opens no editor and no Peek, and activates nothing', async () => {
  await select()
  await item(/PSAPAC-3,/).hover()
  await item(/PSAPAC-3,/)
    .getByRole('img')
    .first()
    .click()
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')
  await window.waitForTimeout(900)
  await expect(dialog()).toHaveCount(0)
  await expect(peek()).toHaveCount(0)
})

test('a hovered row has no pencil, and Cancel closes the editor with no write', async () => {
  await open()
  await row().hover()
  await expect(row().locator('[data-edit="summary"]')).toHaveCount(0)
  await text().click({ position: ON_TEXT })
  await expect(dialog()).toBeVisible()
  await expect(field()).toHaveValue('Migrate the dashboards')

  await dialog().getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  expect(await writes()).toBe(0)
})

test('E opens the editor on the active row, and Esc closes it with no write', async () => {
  await select()
  await window.keyboard.press('e')
  await expect(dialog()).toBeVisible()
  await expect(field()).toBeFocused()

  await field().fill('Never saved')
  await window.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(row()).toHaveAccessibleName(/Migrate the dashboards,/)
  expect(await writes()).toBe(0)
})

test('an empty summary is refused, and a click outside closes the editor with no write', async () => {
  await select()
  await window.keyboard.press('e')
  await field().fill('   ')
  await window.keyboard.press('Enter')
  await expect(dialog().getByRole('alert')).toHaveText('A summary cannot be empty.')
  await expect(dialog()).toBeVisible()

  await field().fill('Typed again')
  await expect(dialog().getByRole('alert')).toHaveCount(0)

  await window.mouse.click(2, 2)
  await expect(dialog()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  expect(await writes()).toBe(0)
})

test('a refused write shows the old summary again and Retry sends it once more', async () => {
  await select()
  await refuseNextEdit(app)
  await window.keyboard.press('e')
  await field().fill('Refused summary')
  await window.keyboard.press('Enter')
  await expect(row()).toHaveAccessibleName(/Refused summary/)
  await expect.poll(writes).toBe(1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Summary not changed.')
  await expect(row()).toHaveAccessibleName(/Migrate the dashboards,/)

  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(row()).toHaveAccessibleName(/Refused summary/)
  // Two writes arrived, and the fake counts only the Retry as applied: it never applied the refusal.
  await expect.poll(writes).toBe(2)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(1)
  await expect(row()).toHaveAccessibleName(/Refused summary/)
})

test('a Customer header offers no target, and E on it opens nothing', async () => {
  await open()
  const header = item('Acme, 8 issues', true)
  await expect(header.locator('[data-edit="summary"], [data-summary]')).toHaveCount(0)
  await header.hover()
  await expect(header).toHaveAttribute('data-active', 'true')
  await window.keyboard.press('e')
  await window.waitForTimeout(900)
  await expect(dialog()).toHaveCount(0)
})

test('the Sprint page edits a summary from a click on it, and opens an issue from a double-click on its row', async () => {
  await joinSprint(app, ['PSAPAC-4', 'PSAPAC-13'], 5)
  await open()
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()

  const summary = sprintPage().getByRole('button', { name: 'Edit summary of PSAPAC-4' })
  const listed = sprintPage().getByRole('button', { name: /^PSAPAC-4/ })
  await expect(sprintPage().locator('[data-issue-key="PSAPAC-4"] [data-edit]')).toHaveCount(0)
  await summary.click()
  await expect(field()).toBeFocused()
  await field().fill('Migrate the dashboards in the sprint')
  await window.keyboard.press('Enter')
  await expect(dialog()).toHaveCount(0)
  await expect(listed).toHaveAccessibleName('PSAPAC-4 Migrate the dashboards in the sprint')
  await expect(summary).toBeFocused()
  await settle(1)

  // A double-click on the key peeks the issue with its first click and opens the page.
  await sprintPage().getByRole('button', { name: 'Peek PSAPAC-4' }).dblclick()
  await expect(issuePage()).toBeVisible()
  await expect(dialog()).toHaveCount(0)
})

test('in a wide font the summary stays a click target in its row and the editor fits', async () => {
  await open()
  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  await row().hover()
  const inside = await row().evaluate((el) => {
    const summary = el.querySelector('[data-summary]')?.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    return summary !== undefined && summary.width > 0 && summary.right <= box.right
  })
  expect(inside).toBe(true)

  await text().click({ position: ON_TEXT })
  await field().fill('w'.repeat(255))
  const fits = await dialog().evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(fits).toBe(0)
})
