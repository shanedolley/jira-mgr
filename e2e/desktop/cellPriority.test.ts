/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  expectBeside,
  joinSprint,
  launch,
  logIn,
  moveIssue,
  notices,
  openSprintRow,
  peekRow,
  releaseEdit,
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
/** The priority slot's click target on a row: drawn or empty, it is always there. */
const slot = (row: RegExp) => item(row).locator('[data-pick=priority]')
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const sprintPage = () => window.getByRole('region', { name: 'Sprint page' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
/** A Sprint page row's priority control, a button named with the priority it holds. */
const sprintSlot = (key: string) =>
  sprintPage().getByRole('button', { name: new RegExp(`^Priority of ${key}:`) })
const sidebar = () => window.getByRole('navigation', { name: 'Main' })
const listbox = () => window.getByRole('listbox', { name: 'Priority' })
/** `High` and not `Highest`. */
const high = () => window.getByRole('option', { name: /^High(?!est)/ })
const highest = () => window.getByRole('option', { name: /^Highest/ })
/** The open list, drawn by the cell editor against the clicked cell. */
const popover = () => window.locator('.menu:popover-open')

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  // The fake holds the first Done page, so the toolbar stops reflowing under a click.
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

const writes = async () => (await counts(app)).edits

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

/** The bars a row draws, by their level, or null when its slot is empty. */
const level = (row: RegExp) =>
  item(row)
    .locator('[data-glyph=priority]')
    .evaluateAll((all) => all[0]?.getAttribute('data-level') ?? null)

test('a click on the empty slot of a Medium issue opens the Priority list beside it and not the Peek', async () => {
  await open()
  // PSAPAC-3 is Medium, so its slot draws nothing.
  expect(await level(/PSAPAC-3,/)).toBeNull()
  await slot(/PSAPAC-3,/).click()

  await expect(listbox()).toBeFocused()
  await expect(peek()).toHaveCount(0)
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')
  // Below the slot, at its left edge or, near the window's right edge, at its right.
  await expectBeside(window, slot(/PSAPAC-3,/), popover())
})

test('choosing a priority draws the bars at once, writes once and returns focus to the Tree', async () => {
  await open()
  const before = await writes()

  await slot(/PSAPAC-3,/).click()
  await high().click()

  // The row shows the new priority before Jira answers.
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/priority High/)
  expect(await level(/PSAPAC-3,/)).toBe('3')
  await expect(listbox()).toHaveCount(0)
  await settle(before + 1)
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')

  // A slot that now draws bars is the same target, and Medium puts it back to empty.
  await slot(/PSAPAC-3,/).click()
  await expect(listbox()).toBeFocused()
  await window.getByRole('option', { name: /^Medium/ }).click()
  await settle(before + 2)
  // The write reaches Jira a few frames before the Tree repaints without the bars.
  await expect.poll(() => level(/PSAPAC-3,/)).toBeNull()
  await expect(item(/PSAPAC-3,/)).not.toHaveAccessibleName(/priority/)
})

test('Esc closes the list with no write, and a click outside closes it, and a second click on the slot too', async () => {
  await open()
  const before = await writes()

  await slot(/PSAPAC-3,/).click()
  await expect(listbox()).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(listbox()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')

  await slot(/PSAPAC-3,/).click()
  await expect(listbox()).toBeVisible()
  await sidebar()
    .getByRole('link', { name: /^Issues/ })
    .click()
  await expect(listbox()).toHaveCount(0)

  await slot(/PSAPAC-3,/).click()
  await expect(listbox()).toBeVisible()
  await slot(/PSAPAC-3,/).click()
  await expect(listbox()).toHaveCount(0)
  // The click that closed it did not open it again.
  await window.waitForTimeout(300)
  await expect(listbox()).toHaveCount(0)
  expect(await writes()).toBe(before)
})

test('a click on the slot selects no text and arms no double-click', async () => {
  await open()
  await slot(/PSAPAC-3,/).dblclick()
  await expect(window.getByRole('region', { name: 'Issue page' })).toHaveCount(0)
  await expect(peek()).toHaveCount(0)
  expect(await window.evaluate(() => document.getSelection()?.toString())).toBe('')
  await expect(slot(/PSAPAC-3,/)).toHaveCSS('user-select', 'none')
})

test('P opens the same list on the active row, and arrows and Enter choose', async () => {
  await open()
  await peekRow(item(/PSAPAC-3,/))
  await expect(peek()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
  await expect(tree()).toBeFocused()
  const before = await writes()

  await window.keyboard.press('p')
  await expect(listbox()).toBeFocused()
  await expect(peek()).toHaveCount(0)
  await expect(listbox()).toHaveAccessibleName('Priority')
  // Beside the active row's slot, not at the Peek.
  await expectBeside(window, slot(/PSAPAC-3,/), popover())

  // The priorities load when the list opens.
  await expect(high()).toBeVisible()
  // Medium is selected, so one step up is High.
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('Enter')
  await expect(listbox()).toHaveCount(0)
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/priority High/)
  await settle(before + 1)
  await expect(tree()).toBeFocused()
  await expect(item(/PSAPAC-3,/)).toHaveAttribute('data-active', 'true')
})

test('the list answers to the keys 1 to 9', async () => {
  await open()
  await slot(/PSAPAC-3,/).click()
  await expect(high()).toBeVisible()
  const before = await writes()
  await window.keyboard.press('4')
  await settle(before + 1)
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/priority Low/)
})

test('a refused priority puts the bars back and the toast offers Retry', async () => {
  await open()
  const before = await writes()

  await slot(/PSAPAC-3,/).click()
  // The fake refuses Highest.
  await highest().click()
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/priority Highest/)
  expect(await level(/PSAPAC-3,/)).toBe('4')
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Priority not changed')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(item(/PSAPAC-3,/)).not.toHaveAccessibleName(/priority/)
  expect(await level(/PSAPAC-3,/)).toBeNull()
})

test('a Hold row stays editable, and its list is not faded with it', async () => {
  await moveIssue(app, 'PSAPAC-3', 'hold')
  await open()
  const before = await writes()

  await slot(/PSAPAC-3,/).click()
  await expect(listbox()).toBeFocused()
  const drawn = await popover().evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return opacity
  })
  expect(drawn).toBe(1)
  await high().click()
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/priority High/)
  await settle(before + 1)
  // The slot keeps the row's fade.
  const faded = await slot(/PSAPAC-3,/).evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return opacity
  })
  expect(faded).toBeCloseTo(0.3, 2)
})

test('holds its layout with a wide font: the slot keeps 16px, bars or none, and the list fits the window', async () => {
  await open()
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })

  // The inner slot is 16px wide in every row, so the columns line up whether bars show or not.
  const widths = await tree().evaluate((el) =>
    [...el.querySelectorAll('[data-slot=priority]')].map((s) => s.getBoundingClientRect().width),
  )
  expect(widths.length).toBeGreaterThan(0)
  expect(new Set(widths)).toEqual(new Set([16]))

  // Setting a priority moves nothing: the slot and the avatar after it keep their places.
  const avatarLeft = () =>
    item(/PSAPAC-3,/)
      .locator('[data-pick=assignee]')
      .evaluate((el) => el.getBoundingClientRect().left)
  const slotLeft = () =>
    item(/PSAPAC-3,/)
      .locator('[data-slot=priority]')
      .evaluate((el) => el.getBoundingClientRect().left)
  const [avatarBefore, slotBefore] = [await avatarLeft(), await slotLeft()]
  const before = await writes()
  await slot(/PSAPAC-3,/).click()
  await high().click()
  await expect(item(/PSAPAC-3,/)).toHaveAccessibleName(/priority High/)
  expect(await avatarLeft()).toBe(avatarBefore)
  expect(await slotLeft()).toBe(slotBefore)
  await settle(before + 1)

  await slot(/PSAPAC-3,/).click()
  await expect(highest()).toBeVisible()
  const fits = await popover().evaluate((list) => {
    const box = list.getBoundingClientRect()
    const clipped = [...list.querySelectorAll('[role=option]')].filter(
      (o) => o.scrollWidth > o.clientWidth + 0.5,
    ).length
    return {
      inside:
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= globalThis.innerWidth &&
        box.bottom <= globalThis.innerHeight,
      clipped,
    }
  })
  expect(fits).toEqual({ inside: true, clipped: 0 })
})

/** PSAPAC-4 and PSAPAC-13 start in the active sprint; these join them, as in the Sprint page tests. */
const MEMBERS = [
  'PSAPAC-1',
  'PSAPAC-2',
  'PSAPAC-4',
  'PSAPAC-11',
  'PSAPAC-13',
  'PSAPAC-14',
  'PSAPAC-22',
]

const DISPLAY_PROPERTIES = [
  'Labels',
  'Sprint',
  'Original estimate',
  'Logged',
  'Remaining',
  'Remaining %',
  'Due date',
  'Created',
  'Updated',
]

/** Turns each Display property on or off so that exactly `shown` are on. */
async function showProperties(shown: readonly string[]) {
  await window.getByRole('button', { name: 'Display', exact: true }).click()
  const chips = window.getByRole('group', { name: 'Display properties', exact: true })
  for (const name of DISPLAY_PROPERTIES) {
    const chip = chips.getByRole('button', { name, exact: true })
    if ((await chip.getAttribute('aria-pressed')) !== String(shown.includes(name))) {
      await chip.click()
    }
  }
  await window.keyboard.press('Escape')
}

async function openSprint(shown?: readonly string[]) {
  await joinSprint(app, MEMBERS, 5)
  await open()
  if (shown !== undefined) {
    await showEverything(window)
    await showProperties(shown)
  }
  await sidebar()
    .getByRole('region', { name: 'Sprints' })
    .getByRole('button', { name: /^Current/ })
    .click()
  await expect(sprintPage()).toBeVisible()
  await expect(sprintPage().getByRole('status')).toHaveText('7 issues')
}

test('a Sprint page row draws a priority slot, empty for Medium, that opens the list and not the issue', async () => {
  await openSprint()
  const before = await writes()
  // PSAPAC-4 is Medium, so the slot is there with no bars.
  await expect(sprintSlot('PSAPAC-4')).toHaveAccessibleName('Priority of PSAPAC-4: Medium')
  await expect(sprintSlot('PSAPAC-4').locator('[data-glyph=priority]')).toHaveCount(0)

  await sprintSlot('PSAPAC-4').click()
  await expect(listbox()).toBeFocused()
  await expect(issuePage()).toHaveCount(0)
  // Below the slot, starting at its left edge.
  const cell = await sprintSlot('PSAPAC-4').boundingBox()
  const list = await popover().boundingBox()
  if (cell === null || list === null) throw new Error('the slot or the list is not drawn')
  expect(list.y).toBeGreaterThanOrEqual(cell.y + cell.height - 1)
  expect(Math.abs(list.x - cell.x)).toBeLessThanOrEqual(4)

  await high().click()
  // The slot shows the new priority before Jira answers.
  await expect(sprintSlot('PSAPAC-4')).toHaveAccessibleName('Priority of PSAPAC-4: High')
  await expect(sprintSlot('PSAPAC-4').locator('[data-glyph=priority]')).toHaveAttribute(
    'data-level',
    '3',
  )
  await settle(before + 1)
  await expect(issuePage()).toHaveCount(0)

  // The row button still opens the issue.
  await openSprintRow(sprintPage().getByRole('button', { name: /^PSAPAC-13 / }))
  await expect(issuePage()).toBeVisible()
})

test('a Sprint page priority slot works by keyboard alone: Enter opens, arrows and Enter choose, Esc leaves', async () => {
  await openSprint()
  const before = await writes()

  await sprintSlot('PSAPAC-4').focus()
  await window.keyboard.press('Enter')
  await expect(listbox()).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(listbox()).toHaveCount(0)
  await expect(sprintSlot('PSAPAC-4')).toBeFocused()
  expect(await writes()).toBe(before)

  await window.keyboard.press('Enter')
  // A precondition: the arrows need the list to hold focus.
  await expect(listbox()).toBeFocused()
  await expect(high()).toBeVisible()
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('Enter')
  await settle(before + 1)
  await expect(sprintSlot('PSAPAC-4')).toHaveAccessibleName('Priority of PSAPAC-4: High')
})

test('keys pressed in the same task as the open reach the Priority list', async () => {
  await openSprint()
  const before = await writes()

  // The first open loads the priorities, so the second finds them cached and the keys need no wait.
  await sprintSlot('PSAPAC-4').focus()
  await window.keyboard.press('Enter')
  await expect(high()).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(listbox()).toHaveCount(0)
  await expect(sprintSlot('PSAPAC-4')).toBeFocused()

  // Back to back, with no wait for focus: Medium is selected, so one step down is Low.
  await window.keyboard.press('Enter')
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await settle(before + 1)
  await expect(sprintSlot('PSAPAC-4')).toHaveAccessibleName('Priority of PSAPAC-4: Low')
})

test('a refused priority on the Sprint page takes the bars back and the toast offers Retry', async () => {
  await openSprint()
  const before = await writes()

  await sprintSlot('PSAPAC-4').click()
  // The fake refuses Highest.
  await highest().click()
  await expect(sprintSlot('PSAPAC-4')).toHaveAccessibleName('Priority of PSAPAC-4: Highest')
  await expect.poll(writes).toBe(before + 1)
  await releaseEdit(app)

  const alert = notices(window).getByRole('alert')
  await expect(alert).toContainText('Priority not changed')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(sprintSlot('PSAPAC-4')).toHaveAccessibleName('Priority of PSAPAC-4: Medium')
})

test('holds its layout with a wide font: the Sprint page slot keeps 16px, clears the key and the list fits', async () => {
  await openSprint()
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })

  const rows = await sprintPage().evaluate((page) =>
    [...page.querySelectorAll('li[data-issue-key]')].map((row) => {
      const slot = row.querySelector('[data-slot=priority]')?.getBoundingClientRect()
      const button = row.querySelector('[data-pick=priority]')?.getBoundingClientRect()
      const key = row.querySelector('span.font-mono')?.getBoundingClientRect()
      return {
        key: row.getAttribute('data-issue-key'),
        width: slot?.width,
        // The slot is a control of its own, clear of the key before it.
        clear: button !== undefined && key !== undefined && button.left >= key.right - 0.5,
      }
    }),
  )
  expect(rows.length).toBe(7)
  expect(rows.filter((r) => r.width !== 16 || !r.clear)).toEqual([])

  await sprintSlot('PSAPAC-4').click()
  await expect(highest()).toBeVisible()
  const fits = await popover().evaluate((list) => {
    const box = list.getBoundingClientRect()
    const clipped = [...list.querySelectorAll('[role=option]')].filter(
      (o) => o.scrollWidth > o.clientWidth + 0.5,
    ).length
    return {
      inside:
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= globalThis.innerWidth &&
        box.bottom <= globalThis.innerHeight,
      clipped,
    }
  })
  expect(fits).toEqual({ inside: true, clipped: 0 })
})

/** Each Sprint page row's summary width, and whether its avatar sits on the row's first line. */
const rowFit = () =>
  sprintPage().evaluate((page) =>
    [...page.querySelectorAll('li[data-issue-key]')].map((row) => {
      const summary = row.querySelector('[data-summary]')?.getBoundingClientRect()
      const key = row.querySelector('span.font-mono')?.getBoundingClientRect()
      // The assignee slot, which holds an unassigned row's dotted circle too: only a person's avatar carries `data-avatar`.
      const avatar = row.querySelector('[data-pick=assignee]')?.getBoundingClientRect()
      const slots = [...row.querySelectorAll('[data-props] > [data-prop]')]
      const lastSlot = slots.at(-1)?.getBoundingClientRect()
      const edge = row.getBoundingClientRect()
      return {
        key: row.getAttribute('data-issue-key'),
        summary: summary?.width ?? 0,
        slot: row.querySelector('[data-pick=priority]') !== null,
        // The avatar starts above the key's bottom edge, so it shares the key's line.
        firstLine: avatar !== undefined && key !== undefined && avatar.top < key.bottom,
        // The avatar sits right of the last property slot, whichever line that slot is on, and inside the row.
        clear:
          avatar !== undefined &&
          (lastSlot === undefined || avatar.left >= lastSlot.right) &&
          avatar.right <= edge.right,
      }
    }),
  )

test('with every Display property on and a wide font, the Sprint page summary keeps 160px and the avatar its line', async () => {
  await openSprint(DISPLAY_PROPERTIES)
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })
  await expect(sprintSlot('PSAPAC-4')).toBeVisible()

  const rows = await rowFit()
  expect(rows.length).toBe(7)
  expect(rows.filter((r) => !r.slot || r.summary < 160 || !r.firstLine || !r.clear)).toEqual([])
})

test('with every Display property off and a wide font, the Sprint page rows keep the priority slot and a summary', async () => {
  await openSprint([])
  await window.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important }' })
  await expect(sprintSlot('PSAPAC-4')).toBeVisible()

  const rows = await rowFit()
  expect(rows.length).toBe(7)
  expect(rows.filter((r) => !r.slot || r.summary <= 0 || !r.firstLine)).toEqual([])
})
