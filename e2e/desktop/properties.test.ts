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
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: RegExp) => tree().getByRole('treeitem', { name })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const props = () => issuePage().getByRole('complementary', { name: 'Properties' })

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** The vertical centre of each of the Peek's property rows, top to bottom. */
const rowCentres = () =>
  peek()
    .locator('dl > div')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const box = row.getBoundingClientRect()
        return { name: row.querySelector('dt')?.textContent ?? '', y: box.top + box.height / 2 }
      }),
    )

test('the Peek spaces its property rows 32px apart, with an 8px gap before the read-only ones', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await expect(peek().getByRole('button', { name: 'Priority: Medium' })).toBeVisible()

  const rows = await rowCentres()
  expect(rows.map((r) => r.name)).toEqual([
    'Status',
    'Assignee',
    'Priority',
    'Labels',
    'Type',
    'Customer',
    'Engagement',
    'Updated',
  ])
  const steps = rows.slice(1).map((row, i) => row.y - (rows[i]?.y ?? 0))
  // Labels to Type crosses the gap between the editable rows and the read-only ones.
  expect(steps).toEqual([32, 32, 32, 40, 32, 32, 32])
})

test('the Peek shows a chevron on editable rows only', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  const rows = peek().locator('dl > div')
  await expect(rows).toHaveCount(8)
  for (const [i, chevron] of [1, 1, 1, 1, 0, 0, 0, 0].entries()) {
    await expect(rows.nth(i).locator('[data-chevron]')).toHaveCount(chevron)
  }
})

test('the Peek shows the description in three lines at most, and reads it from the issue', async () => {
  await open()
  await item(/PSAPAC-1,/).click()
  const description = peek().getByRole('region', { name: 'Description' })
  const text = description.getByText('Agree the scope with the sponsor.')
  await expect(text).toBeVisible()

  // The description is plain text, not an editor.
  await expect(description.locator('[contenteditable], textarea, input')).toHaveCount(0)
  const clamp = await text.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      lines: style.getPropertyValue('-webkit-line-clamp'),
      height: el.getBoundingClientRect().height,
      line: Number.parseFloat(style.lineHeight),
      overflows: el.scrollHeight > el.clientHeight,
    }
  })
  expect(clamp.lines).toBe('3')
  expect(clamp.height).toBeCloseTo(clamp.line * 3, 0)
  expect(clamp.overflows).toBe(true)

  await item(/PSAPAC-3,/).click()
  await expect(description.getByText('No description')).toBeVisible()
})

test('the Peek starts the timer on an issue, and offers none on an Epic', async () => {
  await open()
  await item(/PSAPAC-2,/).click()
  await peek().getByRole('button', { name: 'Start timer' }).click()
  await expect(window.getByText('Started the timer on PSAPAC-2')).toBeVisible()
  await expect(peek().getByRole('button', { name: 'Stop timer' })).toBeVisible()

  await item(/PSAPAC-10,/).click()
  await expect(peek().getByRole('button', { name: 'Close' })).toBeVisible()
  await expect(peek().getByRole('button', { name: /timer$/ })).toHaveCount(0)
})

test('the page asks to set an estimate, and shows Time left only once there is one', async () => {
  await open()
  await item(/PSAPAC-2,/).click()
  await window.keyboard.press('Enter')
  await expect(issuePage().getByRole('button', { name: 'Review the data model' })).toBeVisible()

  const estimate = props().getByLabel('Original estimate')
  await expect(estimate).toHaveAttribute('placeholder', 'Set estimate')
  await expect(props().getByLabel('Time remaining (h)')).toHaveCount(0)
  await expect(props().getByText('Set start date')).toBeVisible()
  await expect(props().getByText('Set due date')).toBeVisible()

  await estimate.fill('4h')
  await window.keyboard.press('Enter')
  await expect(props().getByLabel('Time remaining (h)')).toBeVisible()
})

test('the page rows sit 32px apart, and read-only rows have no chevron', async () => {
  await open()
  await item(/PSAPAC-10,/).click()
  await window.keyboard.press('Enter')
  await expect(issuePage().getByRole('button', { name: 'Customer onboarding' })).toBeVisible()

  const rows = props().locator('section > div')
  const boxes = await rows.evaluateAll((all) =>
    all.map((row) => {
      const box = row.getBoundingClientRect()
      return {
        text: row.textContent,
        height: box.height,
        svg: row.querySelector('[data-chevron]') !== null,
      }
    }),
  )
  for (const row of boxes) expect(row.height).toBe(32)
  // An Epic's Type cannot change, so it follows the editable rows without a chevron.
  const chevronOf = (name: string) => boxes.filter((r) => r.text.startsWith(name)).map((r) => r.svg)
  expect(chevronOf('Type')).toEqual([false])
  expect(chevronOf('Status')).toEqual([true])
})
