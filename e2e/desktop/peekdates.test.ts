/// <reference lib="dom" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import {
  counts,
  fieldsOf,
  launch,
  logIn,
  notices,
  peekRow,
  refuseKeys,
  releaseEdit,
  showEverything,
} from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  ;({ app, window } = await launch(stateDir, { TZ: 'Etc/UTC' }))
  // Monday 2 November 2026, in the app's local time (TZ is UTC).
  await window.clock.setFixedTime(new Date('2026-11-02T09:30:00Z'))
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const peek = () => window.getByRole('complementary', { name: 'Peek' })

/** PSAPAC-11 has no dates; PSAPAC-40 is due 2 Jan 2020. The fake seeds no start date. */
const EMPTY = /PSAPAC-11,/
const FILLED = /PSAPAC-40,/
const START = 'customfield_4'

const FIELDS = {
  'Start date': { jira: START, key: 'startDate' },
  'Due date': { jira: 'duedate', key: 'dueDate' },
} as const
type Name = keyof typeof FIELDS

const field = (name: Name) => peek().getByRole('combobox', { name })
const suggestion = () => peek().getByRole('option')
const row = (name: Name) => peek().locator(`[data-field=${FIELDS[name].key}]`)
const writes = async () => (await counts(app)).edits
const bodies = async () => (await counts(app)).editBodies

async function open(issue: RegExp) {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await showEverything(window)
  await peekRow(item(issue))
  await expect(peek()).toBeVisible()
}

/** Waits for the write to arrive, then lets the fake Jira answer it. */
async function settle(expected: number) {
  await expect.poll(writes).toBe(expected)
  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(expected)
}

/** The fake seeds no start date, so a test of a filled Start date gives PSAPAC-40 one through the Peek. */
async function seedStart() {
  const first = await writes()
  await field('Start date').click()
  await window.keyboard.type('1 Dec 2026')
  await window.keyboard.press('Enter')
  await settle(first + 1)
  // Jira's answer and the reads after it can each redraw the field, so let them land first.
  await window.waitForTimeout(500)
}

const pending = (name: Name) => row(name).locator('dd')

for (const name of Object.keys(FIELDS) as Name[]) {
  const { jira } = FIELDS[name]

  for (const key of ['Tab', 'Enter'] as const) {
    test(`${name}: a phrase typed key by key into an empty field saves once on ${key}`, async () => {
      await open(EMPTY)
      const before = await writes()

      await field(name).click()
      await window.keyboard.type('next tuesday')
      await expect(field(name)).toHaveValue('next tuesday')
      await expect(suggestion()).toHaveText('Tue 10 Nov 2026')
      expect(await writes()).toBe(before)
      await window.keyboard.press(key)

      await expect(pending(name)).toHaveAttribute('data-pending', 'true')
      await expect(field(name)).toHaveValue('10 Nov')
      await settle(before + 1)
      await window.waitForTimeout(300)
      expect((await bodies()).slice(before)).toEqual([{ fields: { [jira]: '2026-11-10' } }])
      expect((await fieldsOf(app, 'PSAPAC-11'))?.[jira]).toBe('2026-11-10')
      await expect(pending(name)).not.toHaveAttribute('data-pending', 'true')
      await expect(field(name)).toHaveValue('10 Nov')
      if (key === 'Tab') await expect(field(name)).not.toBeFocused()
      else await expect(field(name)).toBeFocused()
    })

    test(`${name}: a phrase typed over a date selects it and saves once on ${key}`, async () => {
      await open(FILLED)
      if (name === 'Start date') {
        // The fake seeds no start date, so the first edit gives this row one.
        await seedStart()
      }
      const before = await writes()

      await field(name).focus()
      // Focus selects the text, so typing goes over it.
      await expect(field(name)).toHaveValue(name === 'Due date' ? '2 Jan 2020' : '1 Dec')
      await window.keyboard.type('next tuesday')
      await expect(field(name)).toHaveValue('next tuesday')
      await expect(suggestion()).toHaveText('Tue 10 Nov 2026')
      await window.keyboard.press(key)

      await expect(field(name)).toHaveValue('10 Nov')
      await settle(before + 1)
      await window.waitForTimeout(300)
      expect((await bodies()).slice(before)).toEqual([{ fields: { [jira]: '2026-11-10' } }])
      expect((await fieldsOf(app, 'PSAPAC-40'))?.[jira]).toBe('2026-11-10')
    })
  }

  test(`${name}: a click on the suggestion saves once and keeps focus in the field`, async () => {
    await open(EMPTY)
    const before = await writes()

    await field(name).click()
    await window.keyboard.type('tomorrow')
    await suggestion().click()

    await expect(field(name)).toHaveValue('3 Nov')
    await expect(field(name)).toBeFocused()
    await settle(before + 1)
    await window.waitForTimeout(300)
    expect((await bodies()).slice(before)).toEqual([{ fields: { [jira]: '2026-11-03' } }])
  })

  test(`${name}: Esc closes the suggestion first, and unreadable text saves nothing`, async () => {
    await open(EMPTY)
    const before = await writes()

    await field(name).click()
    await window.keyboard.type('next tuesday')
    await expect(suggestion()).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(suggestion()).toHaveCount(0)
    await expect(peek()).toBeVisible()
    await expect(field(name)).toHaveValue('next tuesday')

    await field(name).fill('not a date')
    await window.keyboard.press('Enter')
    await expect(row(name)).toContainText('Could not read the date')
    expect(await writes()).toBe(before)
    // The message is drawn whole in the row, not clipped by it.
    const fits = await row(name).evaluate((el) => {
      const note = el.querySelector('[aria-live]')?.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      return note !== undefined && note.bottom <= box.bottom + 0.5 && note.height > 0
    })
    expect(fits).toBe(true)
  })

  test(`${name}: letters typed in the field reach no shortcut, and Esc leaves the Peek open`, async () => {
    await open(EMPTY)

    await field(name).click()
    // `j`, `k`, `o`, `s`, `d`, `y` and `u` are Tree and Peek keys outside a field.
    await window.keyboard.type('jkosdyu')
    await expect(field(name)).toHaveValue('jkosdyu')
    await expect(field(name)).toBeFocused()
    await expect(peek()).toContainText('PSAPAC-11')
    await window.keyboard.press('Escape')
    await expect(field(name)).toHaveValue('')
    await expect(peek()).toBeVisible()
  })

  test(`${name}: an emptied field clears the date`, async () => {
    await open(FILLED)
    if (name === 'Start date') {
      await seedStart()
    }
    const before = await writes()

    await expect(async () => {
      await field(name).focus()
      await window.keyboard.press('ControlOrMeta+a')
      await window.keyboard.press('Backspace')
      await expect(field(name)).toHaveValue('', { timeout: 1000 })
    }).toPass()
    await window.keyboard.press('Enter')

    await settle(before + 1)
    expect((await bodies()).slice(before)).toEqual([{ fields: { [jira]: null } }])
    expect((await fieldsOf(app, 'PSAPAC-40'))?.[jira]).toBeNull()
  })

  test(`${name}: a refused write puts the date back and the toast offers Retry`, async () => {
    await open(EMPTY)
    await refuseKeys(app, ['PSAPAC-11'])
    const before = await writes()

    await field(name).click()
    await window.keyboard.type('next tuesday')
    await window.keyboard.press('Enter')
    await expect.poll(writes).toBe(before + 1)
    await releaseEdit(app)

    const alert = notices(window).getByRole('alert')
    await expect(alert).toContainText(`${name} not changed`)
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  })
}

const resize = async (width: number) => {
  await app.evaluate(({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.setMinimumSize(1, 1)
    win?.setContentSize(w, 700)
  }, width)
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width)
}

for (const wide of [false, true]) {
  test(`at 720px the Peek's date rows and their suggestion fit the card${wide ? ' in a wide font' : ''}`, async () => {
    await logIn(window)
    await expect(item(/PSAPAC-10,/)).toBeVisible()
    await showEverything(window)
    if (wide) {
      await window.addStyleTag({
        content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }',
      })
    }
    await resize(720)
    await window.mouse.move(2, 2)
    await item(EMPTY).hover({ position: { x: 100, y: 10 } })
    await tree().focus()
    await window.keyboard.press('o')
    await expect(peek()).toBeVisible()

    const card = await peek().boundingBox()
    if (card === null) throw new Error('the Peek is not drawn')
    for (const name of Object.keys(FIELDS) as Name[]) {
      await field(name).click()
      await window.keyboard.type('next wednesday')
      await expect(suggestion()).toBeVisible()
      const found = await window.evaluate(
        ([label]) => {
          const input = document.querySelector(`input[aria-label="${label ?? ''}"]`)
          const option = input?.parentElement?.querySelector('[role=option]')
          if (!input || !option) return null
          const a = input.getBoundingClientRect()
          const o = option.getBoundingClientRect()
          const popup = option.parentElement
          return {
            input: { left: a.left, right: a.right, bottom: a.bottom },
            option: { left: o.left, right: o.right, top: o.top, height: o.height },
            clipped: input.scrollWidth > input.clientWidth + 0.5,
            scrolls: popup ? popup.scrollWidth > popup.clientWidth : true,
            windowWidth: globalThis.innerWidth,
          }
        },
        [name],
      )
      expect(found).not.toBeNull()
      if (found === null) continue
      expect(found.input.left).toBeGreaterThanOrEqual(card.x)
      expect(found.input.right).toBeLessThanOrEqual(card.x + card.width)
      expect(found.option.left).toBeGreaterThanOrEqual(0)
      expect(found.option.right).toBeLessThanOrEqual(found.windowWidth)
      expect(found.option.top).toBeGreaterThanOrEqual(found.input.bottom)
      expect(found.option.height).toBeLessThanOrEqual(40)
      expect(found.scrolls).toBe(false)
      await window.keyboard.press('Escape')
      await window.keyboard.press('Escape')
      await expect(peek()).toBeVisible()
    }
    // The dates add two rows and the card still holds every property inside its width.
    const inside = await peek().evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    expect(inside).toBe(true)
  })
}
