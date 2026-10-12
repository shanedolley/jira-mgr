import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { launch, logIn, logWork, setEstimate } from './harness.js'

let app: ElectronApplication
let window: Page
let stateDir: string

/**
 * A fixed-offset zone in which it is now about noon, so a worklog `n` days back lands on a day `n`
 * days back whatever the real hour. `Etc/GMT+N` is N hours behind UTC.
 */
function noonZone(): string {
  const behind = (new Date().getUTCHours() - 12 + 24) % 24
  return behind <= 12 ? `Etc/GMT+${String(behind)}` : `Etc/GMT-${String(24 - behind)}`
}

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
  ;({ app, window } = await launch(stateDir, { TZ: noonZone() }))
})

test.afterEach(async () => {
  await app.close()
  await rm(stateDir, { recursive: true, force: true })
})

const HOUR = 3600
const DAY_MS = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString()

const item = (row: RegExp) =>
  window.getByRole('tree', { name: 'Issues' }).getByRole('treeitem', { name: row })
const peek = () => window.getByRole('complementary', { name: 'Peek' })
const page = () => window.getByRole('region', { name: 'Issue page' })
const block = (scope: Locator) => scope.getByRole('region', { name: 'Time tracking' })
const figure = (scope: Locator, name: string) => block(scope).locator(`[data-figure="${name}"] dd`)
const bars = (scope: Locator) =>
  block(scope)
    .getByRole('list', { name: /^Time logged per / })
    .getByRole('listitem')
const period = (scope: Locator, name: string) =>
  block(scope).getByRole('group', { name: 'Chart period' }).getByRole('button', { name })

/** Logs in and opens the Peek on the row. */
async function openPeek(row: RegExp) {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await item(row).click()
  await expect(peek()).toBeVisible()
}

/** The hours the bars hold together, read from their text alternatives. */
async function totalHours(scope: Locator): Promise<number> {
  const texts = await bars(scope).allTextContents()
  return texts.reduce((sum, text) => sum + Number(/: ([\d.]+) hours?$/.exec(text)?.[1]), 0)
}

test('shows a 3 day estimate, 1.5 days logged and 50% on the Peek and the issue page', async () => {
  await setEstimate(app, 'PSAPAC-4', 24 * HOUR)
  await logWork(app, 'PSAPAC-4', daysAgo(2), 2.5 * HOUR)
  await logWork(app, 'PSAPAC-4', daysAgo(1), 4.5 * HOUR)
  await logWork(app, 'PSAPAC-4', daysAgo(5), 5 * HOUR)
  await openPeek(/PSAPAC-4,/)

  await expect(figure(peek(), 'Estimate')).toHaveText('3 days')
  await expect(figure(peek(), 'Logged')).toHaveText('1.5 days')
  await expect(figure(peek(), 'Used')).toHaveText('50%')

  await window.keyboard.press('Enter')
  await expect(page().getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
  await expect(figure(page(), 'Estimate')).toHaveText('3 days')
  await expect(figure(page(), 'Logged')).toHaveText('1.5 days')
  await expect(figure(page(), 'Used')).toHaveText('50%')
})

/** Slows the renderer, so a race between the toggle and the bars shows. */
async function throttle(rate: number) {
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
}

for (const rate of [1, 20]) {
  test(`switches the chart between days, weeks and months, and holds the choice (CPU ${String(rate)}x slower)`, async () => {
    await throttle(rate)
    await logWork(app, 'PSAPAC-4', daysAgo(1), 4.5 * HOUR)
    await logWork(app, 'PSAPAC-4', daysAgo(2), 2.5 * HOUR)
    await logWork(app, 'PSAPAC-4', daysAgo(5), 5 * HOUR)
    await openPeek(/PSAPAC-4,/)

    await expect(period(peek(), 'Days')).toHaveAttribute('aria-pressed', 'true')
    await expect(bars(peek())).toHaveCount(14)
    // One day's bar: the one a day back holds 4.5 hours, and no other holds that.
    await expect(bars(peek()).filter({ hasText: ': 4.5 hours' })).toHaveCount(1)
    await expect(bars(peek()).filter({ hasText: ': 2.5 hours' })).toHaveCount(1)
    expect(await totalHours(peek())).toBe(12)

    await period(peek(), 'Weeks').click()
    await expect(bars(peek())).toHaveCount(12)
    expect(await totalHours(peek())).toBe(12)

    await period(peek(), 'Months').click()
    await expect(bars(peek())).toHaveCount(12)
    expect(await totalHours(peek())).toBe(12)

    // The page opens on the choice, not on Days.
    await peek().getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page().getByRole('heading', { name: 'Migrate the dashboards' })).toBeVisible()
    await expect(period(page(), 'Months')).toHaveAttribute('aria-pressed', 'true')
    await expect(bars(page())).toHaveCount(12)
    await period(page(), 'Days').click()
    await expect(bars(page())).toHaveCount(14)
  })
}

test('with no estimate it says so, shows the time logged and no percentage', async () => {
  await logWork(app, 'PSAPAC-3', daysAgo(1), 1.5 * HOUR)
  await openPeek(/PSAPAC-3,/)

  await expect(figure(peek(), 'Estimate')).toHaveText('No estimate')
  await expect(figure(peek(), 'Logged')).toHaveText('1.5 hours')
  await expect(block(peek()).locator('[data-figure="Used"]')).toHaveCount(0)

  await window.keyboard.press('Enter')
  await expect(page().getByRole('heading', { name: 'Fix the export timeout' })).toBeVisible()
  await expect(figure(page(), 'Estimate')).toHaveText('No estimate')
  await expect(block(page()).locator('[data-figure="Used"]')).toHaveCount(0)
})

test('shows a percentage over 100 when more time is logged than estimated', async () => {
  // PSAPAC-4 holds a 2 hour estimate.
  await logWork(app, 'PSAPAC-4', daysAgo(1), 2.5 * HOUR)
  await openPeek(/PSAPAC-4,/)

  await expect(figure(peek(), 'Estimate')).toHaveText('2 hours')
  await expect(figure(peek(), 'Logged')).toHaveText('2.5 hours')
  await expect(figure(peek(), 'Used')).toHaveText('125%')
})

test('says no time is logged for an issue with no worklogs', async () => {
  await openPeek(/PSAPAC-3,/)

  await expect(figure(peek(), 'Logged')).toHaveText('0 minutes')
  await expect(block(peek()).getByText('No time logged')).toBeVisible()
  await expect(block(peek()).getByRole('group', { name: 'Chart period' })).toHaveCount(0)
})

test('shows no time block on an Epic, in the Peek or on its page', async () => {
  await openPeek(/PSAPAC-10,/)
  await expect(peek().getByRole('heading', { name: 'Customer onboarding' })).toBeVisible()
  await expect(peek().getByText('Updated')).toBeVisible()
  await expect(block(peek())).toHaveCount(0)

  await window.keyboard.press('Enter')
  await expect(page().getByRole('heading', { name: 'Customer onboarding' })).toBeVisible()
  await expect(block(page())).toHaveCount(0)
})

/** Sets the window's content size. The app's own minimum is 900px, so the test lifts it, as `narrow.test.ts` does. */
async function resize(width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.setMinimumSize(1, 1)
      win?.setContentSize(w ?? 0, h ?? 0)
    },
    [width, height],
  )
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width)
}

/** How far the document scrolls. A classic scrollbar (Linux) takes 15px for any amount, so it must be 0. */
const documentScroll = () =>
  window.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  )

test('the chart leaves the document unscrolled in a narrow, short window', async () => {
  // PSAPAC-2 holds worklogs, so the chart draws. Its screen-reader text must stay inside the scroller.
  await openPeek(/PSAPAC-2,/)
  await resize(959, 700)
  await expect(bars(peek())).toHaveCount(14)
  expect(await documentScroll()).toBe(0)

  await peek().getByRole('button', { name: 'Open', exact: true }).click()
  await resize(720, 700)
  await expect(bars(page())).toHaveCount(14)
  expect(await documentScroll()).toBe(0)
})
