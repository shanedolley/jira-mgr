import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  launch,
  logIn,
  moveIssue,
  notices,
  refuseKeys,
  refuseNextBulk,
  releaseEdit,
} from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  // Twelve open Stories, "Bulk story 1" to "Bulk story 12" (PSAPAC-1000 to PSAPAC-1011), under one Epic.
  ;({ app, window } = await launch(stateDir, { JM_E2E_BULK: '12' }))
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: string | RegExp, exact = false) => tree().getByRole('treeitem', { name, exact })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const bar = () => window.getByRole('toolbar', { name: 'Selected issues' })
const barButton = (name: string) => bar().getByRole('button', { name, exact: true })
// A status option's name repeats its label: the dot is an image titled with the status.
const option = (name: string) =>
  window.getByRole('option', { name: new RegExp(`^${name}( ${name})?$`) })
const checkedRows = () => tree().locator('[role="treeitem"][aria-checked="true"]')
const toggle = (name: string) => window.getByRole('button', { name, exact: true })
const notice = (text: string | RegExp) => notices(window).getByText(text)

/** The key of "Bulk story n". */
const keyOf = (n: number) => `PSAPAC-${String(999 + n)}`
/** The row of "Bulk story n", anchored: an Epic's row ends "N of M done". */
const story = (n: number) => item(new RegExp(`^${keyOf(n)}, Story, `))
const status = (n: number, name: string) =>
  new RegExp(`^${keyOf(n)}, Story, ${name}, Bulk story ${String(n)}`)

const bulkCalls = async () => (await counts(app)).bulk
const bulkBody = (call: { body: unknown } | undefined) =>
  call?.body as {
    bulkTransitionInputs?: { selectedIssueIdsOrKeys: string[]; transitionId: string }[]
    selectedIssueIdsOrKeys?: string[]
    editedFieldsInput?: Record<string, unknown>
    sendBulkNotification: boolean
  }

/** Slows the renderer, as a busy CI runner does. */
async function throttle(rate: number) {
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
}

/** Logs in and shows only the Bulk stories, with their Epic as context. Done issues stay visible when asked. */
async function open({ showDone = false } = {}) {
  await logIn(window)
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
  if (showDone) {
    await toggle('Hide done').click()
    await expect(toggle('Hide done')).toHaveAttribute('aria-pressed', 'false')
  }
  await window.getByLabel('Filter by key or summary').fill('Bulk story')
  await expect(story(1)).toBeVisible()
  await expect(story(12)).toBeVisible()
}

/**
 * Checks Bulk stories 1 to 10: story 10 by its checkbox, then Shift+Down nine times. Children sort
 * newest key first, so story 10 sits above story 1.
 */
async function checkTen() {
  await story(10).locator('[data-check]').click()
  await expect(checkedRows()).toHaveCount(1)
  for (let n = 2; n <= 10; n++) await window.keyboard.press('Shift+ArrowDown')
  await expect(checkedRows()).toHaveCount(10)
  await expect(bar()).toContainText('10 selected')
}

async function chooseStatus(name: string) {
  await barButton('Status').click()
  await option(name).click()
}

for (const rate of [1, 20]) {
  test.describe(`at ${String(rate)}x CPU slowdown`, () => {
    test.beforeEach(async () => {
      await open()
      if (rate > 1) await throttle(rate)
    })

    test('ten checked issues move to Done in one bulk request', async () => {
      await checkTen()
      // The Peek never opened: a checkbox and Shift+Down check, they do not open.
      await expect(peek()).toHaveCount(0)
      await expect(story(11)).toHaveAttribute('aria-checked', 'false')

      await chooseStatus('Done')

      // "Hide done" is on, so the ten leave the rows with no chip, and the selection, which
      // only holds rows shown, goes with them.
      await expect(story(1)).toHaveCount(0)
      await expect(item(/^\d+ done$/)).toHaveCount(0)
      await expect(story(11)).toHaveAccessibleName(status(11, 'To Do'))
      const calls = await bulkCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]?.path).toBe('/rest/api/3/bulk/issues/transition')
      const input = bulkBody(calls[0]).bulkTransitionInputs
      expect(input).toHaveLength(1)
      expect(input?.[0]?.selectedIssueIdsOrKeys.sort()).toEqual(
        Array.from({ length: 10 }, (_, n) => keyOf(n + 1)),
      )
      expect(bulkBody(calls[0]).sendBulkNotification).toBe(false)
      // No single write: the ten went in one call.
      expect((await counts(app)).edits).toBe(0)
      await expect(notice('Status changed to Done on 10 issues')).toBeVisible()
      await expect(notices(window).getByRole('button', { name: 'Undo' })).toBeVisible()
    })

    test('the selection stays after an action, so another can follow', async () => {
      await checkTen()
      await chooseStatus('In Progress')

      for (let n = 1; n <= 10; n++) {
        await expect(story(n)).toHaveAccessibleName(status(n, 'In Progress'))
      }
      await expect(bar()).toContainText('10 selected')
      await expect(checkedRows()).toHaveCount(10)
      expect(await bulkCalls()).toHaveLength(1)
      await expect(notice('Status changed to In Progress on 10 issues')).toBeVisible()

      // A second action over the same ten.
      await barButton('Actions').click()
      await window.getByRole('button', { name: 'Priority', exact: true }).click()
      await option('High').click()
      await expect.poll(async () => (await bulkCalls()).length).toBe(2)
      await expect(bar()).toContainText('10 selected')
    })

    test('a refusal names the issues it skipped, five at most, and keeps only those checked', async () => {
      await refuseKeys(
        app,
        Array.from({ length: 7 }, (_, n) => keyOf(n + 1)),
      )
      await checkTen()
      await chooseStatus('Done')

      const alert = notices(window).getByRole('alert')
      await expect(alert.locator('p').first()).toHaveText('Status not changed on 7 issues')
      // In the Tree's order, newest key first.
      await expect(alert).toContainText(
        'Skipped PSAPAC-1006, PSAPAC-1005, PSAPAC-1004, PSAPAC-1003, PSAPAC-1002 and 2 more.',
      )
      await expect(alert).toContainText('PSAPAC-1006: The fake refuses PSAPAC-1006.')
      for (let n = 1; n <= 7; n++) await expect(story(n)).toHaveAccessibleName(status(n, 'To Do'))
      await expect(notice('Status changed to Done on 3 issues')).toBeVisible()
      await expect(item(/^\d+ done$/)).toHaveCount(0)
      // The three that moved left the rows; the seven refused stay checked for another try.
      await expect(bar()).toContainText('7 selected')
    })

    test('Cmd+Z undoes the whole batch in one request, each issue to its own status', async () => {
      // Story 2 starts In Progress, so the undo has two prior statuses to restore.
      await story(2).locator('[data-check]').click()
      await chooseStatus('In Progress')
      await expect(story(2)).toHaveAccessibleName(status(2, 'In Progress'))
      await window.keyboard.press('Escape')
      await expect(bar()).toHaveCount(0)

      await checkTen()
      await chooseStatus('Done')
      // The undo entry is recorded when Jira has answered, so wait for the notice that says so.
      await expect(notice('Status changed to Done on 10 issues')).toBeVisible()
      expect(await bulkCalls()).toHaveLength(2)

      await window.keyboard.press('Meta+z')

      await expect(notice('Undid the status of 10 issues')).toBeVisible()
      await expect(story(2)).toHaveAccessibleName(status(2, 'In Progress'))
      for (const n of [1, 3, 4, 5, 6, 7, 8, 9, 10]) {
        await expect(story(n)).toHaveAccessibleName(status(n, 'To Do'))
      }
      // Two groups of prior statuses, so two grouped calls, and none one at a time.
      const calls = await bulkCalls()
      expect(calls).toHaveLength(4)
      const back = calls
        .slice(2)
        .flatMap((call) => bulkBody(call).bulkTransitionInputs ?? [])
        .map((input) => [input.transitionId, input.selectedIssueIdsOrKeys.length])
      expect(back.sort()).toEqual([
        ['101', 9],
        ['102', 1],
      ])
      expect((await counts(app)).edits).toBe(0)
    })

    test('Cmd+Z skips an issue that changed since, and names it', async () => {
      await checkTen()
      await chooseStatus('Done')
      await expect(notice('Status changed to Done on 10 issues')).toBeVisible()

      // Someone moves Bulk story 2 on; the next window focus reads it.
      await moveIssue(app, keyOf(2), 'doing')
      await app.evaluate(({ BrowserWindow }) => {
        const [first] = BrowserWindow.getAllWindows()
        first?.emit('blur')
        first?.emit('focus')
      })
      await expect(story(2)).toHaveAccessibleName(status(2, 'In Progress'))

      await window.keyboard.press('Meta+z')

      await expect(notice('Undid the status of 9 issues')).toBeVisible()
      await expect(notice(/Did not undo PSAPAC-1001: changed since/)).toBeVisible()
      await expect(story(2)).toHaveAccessibleName(status(2, 'In Progress'))
      await expect(story(1)).toHaveAccessibleName(status(1, 'To Do'))
      const calls = await bulkCalls()
      const sent = bulkBody(calls.at(-1)).bulkTransitionInputs?.[0]?.selectedIssueIdsOrKeys ?? []
      expect(sent).toHaveLength(9)
      expect(sent).not.toContain(keyOf(2))
    })

    test('a 400 from the bulk call falls back to one call per issue, with progress and a named refusal', async () => {
      await refuseKeys(app, [keyOf(3)])
      await refuseNextBulk(app)
      await checkTen()
      await chooseStatus('Done')

      // The five at once the fallback allows arrive and wait; each answer moves the count on by one.
      await expect(bar()).toContainText('Updating 0 of 10')
      for (let settled = 1; settled <= 10; settled++) {
        await expect.poll(async () => (await counts(app)).edits).toBeGreaterThanOrEqual(settled)
        await releaseEdit(app)
        if (settled < 10) await expect(bar()).toContainText(`Updating ${String(settled)} of 10`)
      }

      // Nine moved out of the rows; the refused one stays checked.
      await expect(bar()).toContainText('1 selected')
      // The refused bulk POST was not counted, and nothing else went in bulk.
      expect(await bulkCalls()).toHaveLength(0)
      expect((await counts(app)).editBodies).toHaveLength(10)
      const alert = notices(window).getByRole('alert')
      await expect(alert.locator('p').first()).toHaveText('Status not changed on 1 issue')
      await expect(alert).toContainText('Skipped PSAPAC-1002.')
      await expect(story(3)).toHaveAccessibleName(status(3, 'To Do'))
      await expect(notice('Status changed to Done on 9 issues')).toBeVisible()
      await expect(item(/^\d+ done$/)).toHaveCount(0)
    })
  })
}

test('Esc clears the selection first, and a second Esc closes the Peek', async () => {
  await open()
  await story(2).click()
  await expect(peek()).toBeVisible()
  await window.keyboard.press('x')
  await expect(checkedRows()).toHaveCount(1)
  await expect(bar()).toContainText('1 selected')
  // The open row keeps aria-selected beside its check.
  await expect(story(2)).toHaveAttribute('aria-selected', 'true')
  await expect(story(2)).toHaveAttribute('aria-checked', 'true')

  await window.keyboard.press('Escape')
  await expect(checkedRows()).toHaveCount(0)
  await expect(bar()).toHaveCount(0)
  await expect(peek()).toBeVisible()

  await window.keyboard.press('Escape')
  await expect(peek()).toHaveCount(0)
})

test('Esc clears the selection when focus is on the bar, and the clear button does too', async () => {
  await open()
  await story(1).locator('[data-check]').click()
  await barButton('Status').focus()
  await window.keyboard.press('Escape')
  await expect(bar()).toHaveCount(0)

  await story(1).locator('[data-check]').click()
  await bar().getByRole('button', { name: 'Clear selection' }).click()
  await expect(bar()).toHaveCount(0)
  await expect(tree()).toBeFocused()
})

test('Shift+click checks a range from the anchor, and Cmd+A every issue but the Epic', async () => {
  await open()
  await story(2).locator('[data-check]').click()
  // A Shift+click holds back the browser's own focus, so the Tree has to take it.
  await window.getByLabel('Filter by key or summary').focus()
  await story(6).click({ modifiers: ['Shift'] })
  await expect(tree()).toBeFocused()
  await expect(checkedRows()).toHaveCount(5)
  for (let n = 2; n <= 6; n++) await expect(story(n)).toHaveAttribute('aria-checked', 'true')
  await expect(story(1)).toHaveAttribute('aria-checked', 'false')
  await expect(story(7)).toHaveAttribute('aria-checked', 'false')
  await expect(bar()).toContainText('5 selected')
  // Checking opened nothing.
  await expect(peek()).toHaveCount(0)

  // Another range from the same anchor adds to the set.
  await story(1).click({ modifiers: ['Shift'] })
  await expect(checkedRows()).toHaveCount(6)

  await window.keyboard.press('Meta+a')
  await expect(checkedRows()).toHaveCount(12)
  await expect(bar()).toContainText('12 selected')
  // The Epic shows only as context to the filter, so it cannot be checked.
  await expect(item(/^PSAPAC-900, Epic, /)).not.toHaveAttribute('aria-checked', /.*/)
})

test('a checked row takes the selected fill and the open row keeps its own mark', async () => {
  await open()
  const fill = (n: number) => story(n).evaluate((row) => getComputedStyle(row).backgroundColor)
  await story(3).locator('[data-check]').click()
  const checked = await fill(3)
  expect(checked).not.toBe(await fill(5))
  // Fill only: no border, outline or shadow marks the row.
  const edge = await story(3).evaluate((row) => {
    const style = getComputedStyle(row)
    return [style.borderTopWidth, style.outlineStyle, style.boxShadow]
  })
  expect(edge).toEqual(['0px', 'none', 'none'])
})

test('the Actions menu holds every property, and Priority and Labels go as bulk field edits', async () => {
  await open()
  await story(1).locator('[data-check]').click()
  await story(3).click({ modifiers: ['Shift'] })
  await expect(bar()).toContainText('3 selected')

  await barButton('Actions').click()
  const menu = window.locator('.menu', { has: window.getByRole('button', { name: 'Customer' }) })
  for (const name of ['Status', 'Assignee', 'Labels', 'Priority', 'Sprint', 'Customer']) {
    await expect(menu.getByRole('button', { name, exact: true })).toBeVisible()
  }

  await menu.getByRole('button', { name: 'Priority', exact: true }).click()
  await option('High').click()
  await expect.poll(async () => (await bulkCalls()).length).toBe(1)
  const priority = (await bulkCalls())[0]
  expect(priority?.path).toBe('/rest/api/3/bulk/issues/fields')
  expect(bulkBody(priority).selectedIssueIdsOrKeys?.sort()).toEqual([keyOf(1), keyOf(2), keyOf(3)])
  expect(bulkBody(priority).editedFieldsInput).toEqual({ priority: { priorityId: '2' } })
  await expect(notice('Priority changed to High on 3 issues')).toBeVisible()
  // The menu closed after a single choice, and the selection stayed.
  await expect(menu).toBeHidden()
  await expect(bar()).toContainText('3 selected')

  await barButton('Actions').click()
  await menu.getByRole('button', { name: 'Labels', exact: true }).click()
  await window.getByRole('combobox', { name: 'Search Labels' }).fill('urgent')
  await window.getByRole('option', { name: 'Create "urgent"' }).click()
  await expect.poll(async () => (await bulkCalls()).length).toBe(2)
  expect(bulkBody((await bulkCalls())[1]).editedFieldsInput).toEqual({
    labelsFields: [
      { bulkEditMultiSelectFieldOption: 'ADD', fieldId: 'labels', labels: [{ name: 'urgent' }] },
    ],
  })
})

test('choosing a status every checked issue already has changes nothing', async () => {
  await open()
  await story(1).locator('[data-check]').click()
  await chooseStatus('To Do')
  await expect(notice('Nothing to change')).toBeVisible()
  expect(await bulkCalls()).toHaveLength(0)
  expect((await counts(app)).edits).toBe(0)
})

test('the bar fits the Tree in a wide font, on one line, clear of the toast and the last row', async () => {
  await open()
  await window.addStyleTag({
    content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
  })
  await checkTen()

  const measure = () =>
    window.evaluate(() => {
      const bar = document.querySelector('[role="toolbar"][aria-label="Selected issues"]')
      const list = document.getElementById('issue-list')
      if (bar === null || list === null) throw new Error('No bar or list.')
      const box = bar.getBoundingClientRect()
      const frame = list.getBoundingClientRect()
      // The Actions menu's buttons are hidden, with no box, until it opens.
      const buttons = [...bar.querySelectorAll('button')]
        .map((b) => b.getBoundingClientRect())
        .filter((box) => box.height > 0)
      return {
        inside: box.left >= frame.left && box.right <= frame.right && box.bottom <= frame.bottom,
        centred: Math.abs(box.left + box.width / 2 - (frame.left + frame.width / 2)),
        height: box.height,
        width: box.width,
        overflow: bar.scrollWidth - bar.clientWidth,
        rowTops: new Set(buttons.map((b) => Math.round(b.top + b.height / 2))).size,
      }
    })
  const idle = await measure()
  expect(idle.inside).toBe(true)
  expect(idle.centred).toBeLessThan(2)
  expect(idle.overflow).toBe(0)
  expect(idle.height).toBeLessThanOrEqual(48)
  // Every button sits on one line.
  expect(idle.rowTops).toBe(1)

  // The label changes length while a batch runs, but the bar does not wrap or jump.
  await refuseNextBulk(app)
  await chooseStatus('In Progress')
  await expect(bar()).toContainText('Updating 0 of 10')
  const busy = await measure()
  expect(busy.inside).toBe(true)
  expect(busy.overflow).toBe(0)
  expect(busy.rowTops).toBe(1)
  expect(Math.abs(busy.width - idle.width)).toBeLessThan(40)
  for (let settled = 1; settled <= 10; settled++) {
    await expect.poll(async () => (await counts(app)).edits).toBeGreaterThanOrEqual(settled)
    await releaseEdit(app)
  }
  await expect(bar()).toContainText('10 selected')

  // The notice stack rises above the bar instead of sitting on it.
  const toast = notices(window)
  await expect(toast).toBeVisible()
  const gap = await window.evaluate(() => {
    const bar = document.querySelector('[role="toolbar"][aria-label="Selected issues"]')
    const stack = document.querySelector('[aria-label="Notices"]')
    if (bar === null || stack === null) throw new Error('No bar or notices.')
    return bar.getBoundingClientRect().top - stack.getBoundingClientRect().bottom
  })
  expect(gap).toBeGreaterThanOrEqual(0)

  // The last row scrolls clear of the bar.
  await window.getByLabel('Filter by key or summary').fill('')
  // End moves to the last row the Tree holds, so wait for the unfiltered Tree before pressing it.
  await expect(item(/Customer onboarding/)).toBeVisible()
  await tree().focus()
  await window.keyboard.press('End')
  const last = await window.evaluate(() => {
    const bar = document.querySelector('[role="toolbar"][aria-label="Selected issues"]')
    const rows = [...document.querySelectorAll('[role="tree"] [role="treeitem"]')]
    const bottom = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom))
    return { bar: bar?.getBoundingClientRect().top ?? 0, bottom }
  })
  expect(last.bottom).toBeLessThanOrEqual(last.bar + 1)
})
