import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import {
  counts,
  joinSprint,
  launch,
  logIn,
  moveIssue,
  notices,
  refuseNextEdit,
  releaseEdit,
  setEstimate,
  showEverything,
} from './harness.js'

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
const slot = (key: RegExp, name = 'estimate') => item(key).locator(`[data-prop=${name}]`)
const field = () => window.getByRole('textbox', { name: 'Original estimate' })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const sprintRow = (key: string) => sprintPage().locator(`[data-issue-key=${key}]`)
const sprintSlot = (key: string) => sprintRow(key).locator('[data-prop=estimate]')
const displayButton = () => window.getByRole('button', { name: 'Display', exact: true })
const chip = (name: string) =>
  window
    .getByRole('group', { name: 'Display properties', exact: true })
    .getByRole('button', { name, exact: true })

const writes = async () => (await counts(app)).edits
const lastBody = async () => (await counts(app)).editBodies.at(-1)
const estimateBody = (text: string) => ({
  update: { timetracking: [{ edit: { originalEstimate: text } }] },
})

/** PSAPAC-4 holds a 2h estimate; PSAPAC-3 holds none. Both join the active sprint with PSAPAC-13. */
const MEMBERS = ['PSAPAC-3', 'PSAPAC-4', 'PSAPAC-13']

async function open() {
  await joinSprint(app, MEMBERS, 5)
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
  await displayButton().click()
  await chip('Original estimate').click()
  await chip('Remaining').click()
  await window.keyboard.press('Escape')
  await expect(chip('Remaining')).toBeHidden()
  await expect(slot(/PSAPAC-4,/)).toHaveText('Original estimate 2h')
}

/** The opacity a locator is drawn at: the product of its own and every ancestor's. */
const effective = (locator: Locator) =>
  locator.evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return Math.round(opacity * 100) / 100
  })

/** Clicks a row, then closes the Peek the click opened, which would narrow the Tree under the width the slots need. */
async function pick(row: RegExp) {
  await item(row).click()
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
}

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

test('a click turns the slot into a focused field with its text selected, without opening the Peek', async () => {
  await open()
  await slot(/PSAPAC-4,/).click()

  await expect(field()).toBeFocused()
  await expect(field()).toHaveValue('2h')
  expect(await field().evaluate((input: HTMLInputElement) => input.selectionEnd)).toBe(2)
  await expect(field()).toHaveAttribute('draggable', 'false')
  await expect(peek()).toHaveCount(0)
  await expect(item(/PSAPAC-4,/)).not.toHaveAttribute('aria-selected', 'true')
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')
  await expect(item(/PSAPAC-4,/)).not.toHaveAttribute('aria-checked', 'true')
})

test('an empty slot opens empty', async () => {
  await open()
  await slot(/PSAPAC-3,/).click()
  await expect(field()).toBeFocused()
  await expect(field()).toHaveValue('')
})

test('Enter saves at once, re-reads the issue so Remaining follows, and hands focus back to the Tree', async () => {
  await open()
  await slot(/PSAPAC-4,/).click()
  const before = await writes()
  await field().fill('3h 30m')
  await field().press('Enter')

  await expect(field()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  // Shown before Jira answers.
  await expect(slot(/PSAPAC-4,/)).toHaveText('Original estimate 3h 30m')
  await settle(before + 1)
  expect(await lastBody()).toMatchObject(estimateBody('3h 30m'))
  await expect(slot(/PSAPAC-4,/, 'remaining')).toHaveText('Remaining 3h 30m')
  await expect(item(/PSAPAC-4,/)).toHaveAccessibleName(/original estimate 3h 30m/)
})

test('Escape cancels, and leaving the field saves a valid draft and drops an invalid one', async () => {
  await open()
  const before = await writes()

  await slot(/PSAPAC-4,/).click()
  await field().fill('9h')
  await field().press('Escape')
  await expect(field()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(slot(/PSAPAC-4,/)).toHaveText('Original estimate 2h')
  expect(await writes()).toBe(before)

  await slot(/PSAPAC-4,/).click()
  await field().fill('soon')
  await pick(/PSAPAC-13,/)
  await expect(field()).toHaveCount(0)
  await expect(slot(/PSAPAC-4,/)).toHaveText('Original estimate 2h')
  expect(await writes()).toBe(before)

  await slot(/PSAPAC-4,/).click()
  await field().fill('4h')
  await pick(/PSAPAC-13,/)
  await expect(slot(/PSAPAC-4,/)).toHaveText('Original estimate 4h')
  await settle(before + 1)
  expect(await lastBody()).toMatchObject(estimateBody('4h'))
})

test('an invalid or empty draft shows the hint, keeps the field open and sends nothing', async () => {
  await open()
  const before = await writes()
  await slot(/PSAPAC-4,/).click()

  await field().fill('two hours')
  await field().press('Enter')
  await expect(field()).toBeFocused()
  await expect(field()).toHaveAttribute('aria-invalid', 'true')
  await expect(window.getByText('Use a duration such as 2h 30m.')).toBeVisible()

  // Typing clears the hint; an empty draft on an issue with an estimate is refused the same way.
  await field().fill('')
  await expect(window.getByText('Use a duration such as 2h 30m.')).toHaveCount(0)
  await field().press('Enter')
  await expect(window.getByText('Use a duration such as 2h 30m.')).toBeVisible()
  expect(await writes()).toBe(before)
  await expect(slot(/PSAPAC-4,/).locator('input')).toHaveCount(1)
})

test('letters, Arrow keys, Enter and Space act on the field, not the Tree or the Shell', async () => {
  await open()
  await slot(/PSAPAC-4,/).click()
  await field().fill('')
  await window.keyboard.type('1h 2m jkc')
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowLeft')
  await expect(field()).toBeFocused()
  await expect(field()).toHaveValue('1h 2m jkc')
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')
  await expect(window.getByRole('dialog', { name: 'New issue' })).toHaveCount(0)
  await expect(peek()).toHaveCount(0)
  await field().press('Escape')
})

test('a refused write puts the old value back and offers Retry', async () => {
  await open()
  await slot(/PSAPAC-4,/).click()
  const before = await writes()
  await refuseNextEdit(app)
  await field().fill('5h')
  await field().press('Enter')
  await expect(slot(/PSAPAC-4,/)).toHaveText('Original estimate 5h')

  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)
  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Original estimate not changed. Jira refused it:')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(slot(/PSAPAC-4,/)).toHaveText('Original estimate 2h')

  // The fake counts an edit as applied only when it accepts it, so the refused one leaves it at 0.
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect.poll(writes).toBe(before + 2)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(1)
  expect(await lastBody()).toMatchObject(estimateBody('5h'))
  await expect(slot(/PSAPAC-4,/)).toHaveText('Original estimate 5h')
})

test('Shift+E from the Tree focuses the field in the active row', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()

  await window.keyboard.press('Shift+E')
  await expect(field()).toBeFocused()
  await expect(field()).toHaveValue('2h')
  await expect(item(/PSAPAC-4,/).getByRole('textbox', { name: 'Original estimate' })).toBeVisible()
})

test('an Epic offers no field', async () => {
  await open()
  await expect(item(/PSAPAC-10,/).locator('[data-edit]')).toHaveCount(0)
  await item(/PSAPAC-10,/)
    .locator('[data-prop=estimate]')
    .click({ force: true })
  await expect(field()).toHaveCount(0)
})

test('the row stays mounted while the field is open and the Tree scrolls', async () => {
  await open()
  // A short window, so the rows overflow the Tree and the scroll below is a real one.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    // The window's own minimum height is 520.
    win?.setMinimumSize(1, 1)
    win?.setContentSize(1200, 320)
  })
  await expect
    .poll(() => tree().evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(100)
  await slot(/PSAPAC-4,/).click()
  await field().fill('6h')
  await tree().evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect.poll(() => tree().evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect(field()).toHaveValue('6h')
  await expect(field()).toBeFocused()
})

test('a click inside the open field, or a double-click on the slot, opens neither the Peek nor the page', async () => {
  await open()
  await slot(/PSAPAC-4,/).click()
  await field().click()
  await field().dblclick()
  await expect(peek()).toHaveCount(0)
  await expect(issuePage()).toHaveCount(0)
  await expect(field()).toBeFocused()
  await field().press('Escape')

  await slot(/PSAPAC-4,/).dblclick()
  await expect(peek()).toHaveCount(0)
  await expect(issuePage()).toHaveCount(0)
  await expect(field()).toBeFocused()
  await expect(item(/PSAPAC-4,/)).toHaveAttribute('data-active', 'true')
})

test('the open field and its hint on a Hold row draw at full opacity while the rest of the row stays at 30%', async () => {
  await moveIssue(app, 'PSAPAC-11', 'hold')
  await setEstimate(app, 'PSAPAC-11', 2 * 3600)
  await open()
  const row = item(/PSAPAC-11,/)
  await expect.poll(() => effective(row.locator('[data-prop=estimate]'))).toBe(0.3)

  await slot(/PSAPAC-11,/).click()
  await expect(field()).toHaveValue('2h')
  await expect.poll(() => effective(field())).toBe(1)
  await field().fill('nope')
  await field().press('Enter')
  const hint = window.getByText('Use a duration such as 2h 30m.')
  await expect(hint).toBeVisible()
  await expect.poll(() => effective(hint)).toBe(1)
  await expect.poll(() => effective(row.locator('.tree-key'))).toBe(0.3)
  await expect.poll(() => effective(row.locator('[data-avatar]'))).toBe(0.3)
  await expect.poll(() => effective(row.locator('[data-glyph="status"]'))).toBe(0.3)

  await field().press('Escape')
  await expect.poll(() => effective(row.locator('[data-prop=estimate]'))).toBe(0.3)
  await expect.poll(() => effective(row.locator('.tree-key'))).toBe(0.3)
})

test('edits the estimate on the Sprint page without opening the issue, and Enter on the focused slot opens it', async () => {
  await open()
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintRow('PSAPAC-4')).toBeVisible()
  const before = await writes()

  await sprintSlot('PSAPAC-4').click()
  await expect(field()).toBeFocused()
  await expect(field()).toHaveValue('2h')
  await expect(issuePage()).toHaveCount(0)
  await field().fill('3h 15m')
  await window.keyboard.press('Enter')
  await expect(field()).toHaveCount(0)
  await expect(issuePage()).toHaveCount(0)
  await expect(sprintSlot('PSAPAC-4')).toHaveText('Original estimate 3h 15m')
  await settle(before + 1)
  expect(await lastBody()).toMatchObject(estimateBody('3h 15m'))
  await expect(sprintSlot('PSAPAC-4')).toHaveText('Original estimate 3h 15m')

  // A space typed in the field must not press the row.
  await sprintSlot('PSAPAC-4').focus()
  await window.keyboard.press('Enter')
  await expect(field()).toBeFocused()
  await window.keyboard.type(' ')
  await expect(issuePage()).toHaveCount(0)
  await window.keyboard.press('Escape')
  await expect(field()).toHaveCount(0)
})

test('fits "2h 30m" in the field in a wide font, in the Tree and on the Sprint page', async () => {
  await open()
  const style = await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  /** Whether the text fits the field and the field sits inside its row. */
  const fits = (input: HTMLInputElement) => {
    const row = input.closest('[role=treeitem], [data-row]')
    const box = input.getBoundingClientRect()
    const rowBox = row?.getBoundingClientRect()
    return {
      text: input.scrollWidth <= input.clientWidth,
      inside:
        rowBox !== undefined &&
        box.left >= rowBox.left &&
        box.right <= rowBox.right &&
        box.top >= rowBox.top &&
        box.bottom <= rowBox.bottom,
    }
  }

  await slot(/PSAPAC-4,/).click()
  await field().fill('2h 30m')
  expect(await field().evaluate(fits)).toEqual({ text: true, inside: true })
  await field().press('Escape')
  const overflowing = await tree()
    .getByRole('treeitem')
    .evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth).length)
  expect(overflowing).toBe(0)

  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await sprintSlot('PSAPAC-4').click()
  await field().fill('2h 30m')
  expect(await field().evaluate(fits)).toEqual({ text: true, inside: true })
  await style.evaluate((node) => {
    node.parentNode?.removeChild(node)
  })
})
