import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, releaseEdit } from './harness.js'

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

const reads = async () => (await counts(app)).issueReads

test('the Peek reads the description once it holds still, not on each row an arrow key passes', async () => {
  await open()
  await item(/PSAPAC-10,/).click()
  await expect.poll(reads).toEqual(['PSAPAC-10'])

  for (let i = 0; i < 4; i++) await window.keyboard.press('ArrowDown')
  const key = (await peek().locator('p.font-mono').textContent())?.match(/PSAPAC-\d+/)?.[0]
  expect(key).not.toBe('PSAPAC-10')
  await expect.poll(async () => (await reads()).length).toBe(2)
  // Wait out a late read, then check that only the row the arrows stopped on was read.
  await window.waitForTimeout(500)
  expect(await reads()).toEqual(['PSAPAC-10', key])
})

test('the Peek shows a row visited again from the read it already holds', async () => {
  await open()
  await item(/PSAPAC-2,/).click()
  await expect.poll(reads).toEqual(['PSAPAC-2'])
  await item(/PSAPAC-3,/).click()
  await expect.poll(reads).toEqual(['PSAPAC-2', 'PSAPAC-3'])

  await item(/PSAPAC-2,/).click()
  await expect(peek().getByRole('heading', { name: 'Review the data model' })).toBeVisible()
  await window.waitForTimeout(500)
  expect(await reads()).toEqual(['PSAPAC-2', 'PSAPAC-3'])
})

test('a read of the page that opens while an edit is in flight keeps the edit', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await expect.poll(reads).toEqual(['PSAPAC-4'])

  await peek().getByRole('button', { name: 'Status: In Progress' }).click()
  await window.getByRole('option', { name: 'To Do' }).click()
  await expect(peek().getByRole('button', { name: 'Status: To Do' })).toBeVisible()
  // The fake holds the edit, so Jira still says In Progress while the page reads the issue.
  await expect.poll(async () => (await counts(app)).edits).toBe(1)

  // Away to the next row and back, then into the page, as a user paging through the Tree would.
  await tree().focus()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('Enter')
  const page = window.getByRole('region', { name: 'Issue page' })
  await expect(page.getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
  await expect.poll(async () => (await reads()).length).toBe(2)
  await window.waitForTimeout(300)
  await expect(page.getByRole('button', { name: 'Status: To Do' })).toBeVisible()

  await releaseEdit(app)
  await expect.poll(async () => (await counts(app)).applied).toBe(1)
  await expect(page.getByRole('button', { name: 'Status: To Do' })).toBeVisible()
})

const listbox = (name: string) => window.getByRole('listbox', { name })

test('a Peek picker opens 13rem wide and leaves every property name readable', async () => {
  await open()
  await item(/PSAPAC-4,/).click()
  await peek().getByRole('button', { name: 'Priority: Medium' }).click()

  const box = await listbox('Priority').locator('xpath=..').boundingBox()
  expect(box?.width).toBe(208)
  const nameEdges = await peek()
    .locator('dt')
    .evaluateAll((names) => names.map((name) => name.getBoundingClientRect().right))
  expect(box?.x).toBeGreaterThanOrEqual(Math.max(...nameEdges))
})

test('Priority and Labels options carry a glyph, and a check marks the chosen priority', async () => {
  await open()
  await item(/PSAPAC-4,/).click()

  await peek().getByRole('button', { name: 'Priority: Medium' }).click()
  const priorities = listbox('Priority').getByRole('option')
  await expect(priorities).toHaveCount(4)
  await expect(priorities.locator('[data-glyph=priority]')).toHaveCount(4)
  const levels = await priorities
    .locator('[data-glyph=priority]')
    .evaluateAll((bars) => bars.map((bar) => bar.getAttribute('data-level')))
  expect(levels).toEqual(['4', '3', '2', '1'])
  // The glyph, plus a check on the chosen option only.
  await expect(priorities.nth(2).locator('svg')).toHaveCount(2)
  await expect(priorities.nth(1).locator('svg')).toHaveCount(1)
  await window.keyboard.press('Escape')

  await peek()
    .getByRole('button', { name: /^Labels:/ })
    .click()
  const labels = listbox('Labels').getByRole('option')
  expect(await labels.count()).toBeGreaterThan(0)
  await expect(labels.locator('[data-glyph=label]')).toHaveCount(await labels.count())
})
