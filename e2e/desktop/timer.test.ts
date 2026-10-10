import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { counts, launch, logIn, readState, releaseEdit } from './harness.js'

interface TimerFile {
  issueKey: string
  segments: { start: string; end: string | null }[]
}

let app: ElectronApplication
let window: Page
let stateDir: string

/**
 * A fixed-offset zone in which it is now about noon. The dialog warns about a timer that crosses
 * local midnight, and the tests start timers up to 9h back, so a zone near midnight would flip them.
 * `Etc/GMT+N` is N hours behind UTC.
 */
function noonZone(): string {
  const behind = (new Date().getUTCHours() - 12 + 24) % 24
  return behind <= 12 ? `Etc/GMT+${String(behind)}` : `Etc/GMT-${String(24 - behind)}`
}

async function start(env: Record<string, string> = {}) {
  ;({ app, window } = await launch(stateDir, { TZ: noonZone(), ...env }))
}

test.beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'jm-e2e-'))
})

test.afterEach(async () => {
  await app.close().catch(() => undefined)
  await rm(stateDir, { recursive: true, force: true })
})

const tree = () => window.getByRole('tree', { name: 'Issues' })
const item = (name: string | RegExp) => tree().getByRole('treeitem', { name })
const issuePage = () => window.getByRole('region', { name: 'Issue page' })
const sidebarTimer = () =>
  window.getByRole('navigation', { name: 'Main' }).getByRole('region', { name: 'Timer' })
const rowClock = (row: RegExp) => item(row).locator('[data-timer-clock]')
const dialog = (name: string) => window.getByRole('dialog', { name })
const timeField = (name: string) => dialog(name).getByLabel('Time spent')

const HOUR = 3_600_000

/** Writes `timer.json` as `jm timer start` would have, `hoursAgo` hours back. */
async function writeTimer(issueKey: string, hoursAgo: number) {
  const timer: TimerFile = {
    issueKey,
    segments: [{ start: new Date(Date.now() - hoursAgo * HOUR).toISOString(), end: null }],
  }
  await writeFile(join(stateDir, 'timer.json'), JSON.stringify(timer))
}

const timerFile = () => readState<TimerFile>(stateDir, 'timer.json')

async function open() {
  await logIn(window)
  await expect(item(/PSAPAC-10,/)).toBeVisible()
  await expect(window.getByText('Loading Done issues:')).toBeVisible()
}

/** Makes the row active, then closes its Peek so the keys go to the Tree. */
async function select(row: RegExp) {
  await item(row).click()
  await expect(window.getByRole('complementary', { name: 'Peek' })).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(tree()).toBeFocused()
}

const lastBody = async () => (await counts(app)).editBodies.at(-1)

test.describe('start and stop with T', () => {
  test.beforeEach(async () => {
    await start()
    await open()
  })

  test('T starts the timer on the selected issue, and shows it on the row and in the sidebar', async () => {
    await select(/PSAPAC-2,/)
    await expect(sidebarTimer()).toHaveCount(0)
    await window.keyboard.press('t')

    await expect(rowClock(/PSAPAC-2,/)).toBeVisible()
    await expect(rowClock(/PSAPAC-2,/)).toHaveText(/^\d+:\d{2}$/)
    await expect(sidebarTimer()).toContainText('PSAPAC-2')
    await expect(window.getByText('Started the timer on PSAPAC-2')).toBeVisible()
    await expect.poll(timerFile).toMatchObject({
      issueKey: 'PSAPAC-2',
      segments: [{ end: null }],
    })
    await expect(rowClock(/PSAPAC-1,/)).toHaveCount(0)
  })

  test('the clock counts up', async () => {
    await select(/PSAPAC-2,/)
    await window.keyboard.press('t')
    await expect(rowClock(/PSAPAC-2,/)).toHaveText('0:00')
    await expect(rowClock(/PSAPAC-2,/)).toHaveText('0:02')
  })

  test('T on the running issue opens the stop dialog, and Log writes the worklog and clears the timer', async () => {
    await select(/PSAPAC-2,/)
    await window.keyboard.press('t')
    await expect(rowClock(/PSAPAC-2,/)).toBeVisible()
    await window.keyboard.press('t')

    const stop = 'Stop the timer on PSAPAC-2'
    await expect(dialog(stop)).toBeVisible()
    // A new timer rounds up to one 5 minute step (Q58).
    await expect(timeField(stop)).toHaveValue('5m')
    await expect(dialog(stop)).toContainText('Started')
    await dialog(stop).getByLabel('Comment').fill('Checked the model')
    await dialog(stop).getByRole('button', { name: 'Log', exact: true }).click()

    await expect.poll(async () => (await counts(app)).edits).toBe(1)
    expect(await lastBody()).toMatchObject({
      worklog: 'add',
      key: 'PSAPAC-2',
      adjustEstimate: 'auto',
      timeSpent: '5m',
    })
    await releaseEdit(app)

    await expect(dialog(stop)).toHaveCount(0)
    await expect(window.getByText('Logged 5m on PSAPAC-2')).toBeVisible()
    await expect(rowClock(/PSAPAC-2,/)).toHaveCount(0)
    await expect(sidebarTimer()).toHaveCount(0)
    expect(await timerFile()).toBeNull()
  })

  test('the stop dialog logs the time the user typed', async () => {
    await writeTimer('PSAPAC-2', 1)
    await select(/PSAPAC-2,/)
    await expect(rowClock(/PSAPAC-2,/)).toBeVisible({ timeout: 10_000 })
    await window.keyboard.press('t')

    const stop = 'Stop the timer on PSAPAC-2'
    await expect(timeField(stop)).toHaveValue('1h')
    await timeField(stop).fill('45m')
    await dialog(stop).getByRole('button', { name: 'Log', exact: true }).click()
    await expect.poll(async () => (await counts(app)).edits).toBe(1)
    expect(await lastBody()).toMatchObject({ worklog: 'add', key: 'PSAPAC-2', timeSpent: '45m' })
    await releaseEdit(app)
    await expect(window.getByText('Logged 45m on PSAPAC-2')).toBeVisible()
  })

  test('Discard drops the time, and Cancel keeps the timer', async () => {
    await select(/PSAPAC-2,/)
    await window.keyboard.press('t')
    await expect(rowClock(/PSAPAC-2,/)).toBeVisible()
    await window.keyboard.press('t')
    const stop = 'Stop the timer on PSAPAC-2'

    await dialog(stop).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(stop)).toHaveCount(0)
    expect(await timerFile()).not.toBeNull()
    await expect(rowClock(/PSAPAC-2,/)).toBeVisible()

    await window.keyboard.press('t')
    await dialog(stop).getByRole('button', { name: 'Discard' }).click()
    await expect(window.getByText('Discarded the timer on PSAPAC-2')).toBeVisible()
    await expect(rowClock(/PSAPAC-2,/)).toHaveCount(0)
    expect(await timerFile()).toBeNull()
    expect((await counts(app)).edits).toBe(0)
  })

  test('Esc closes the dialog and the sidebar Stop button opens it', async () => {
    await select(/PSAPAC-2,/)
    await window.keyboard.press('t')
    await expect(sidebarTimer()).toBeVisible()
    await sidebarTimer().getByRole('button', { name: 'Stop' }).click()
    await expect(dialog('Stop the timer on PSAPAC-2')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(dialog('Stop the timer on PSAPAC-2')).toHaveCount(0)
    expect(await timerFile()).not.toBeNull()
  })

  test('an Epic cannot be timed', async () => {
    await select(/PSAPAC-10,/)
    await window.keyboard.press('t')
    await expect(window.getByText(/PSAPAC-10 is a Epic/)).toBeVisible()
    expect(await timerFile()).toBeNull()
  })

  test('an Epic opens no switch dialog while another timer runs', async () => {
    await writeTimer('PSAPAC-2', 1)
    await expect(rowClock(/PSAPAC-2,/)).toBeVisible({ timeout: 10_000 })
    await select(/PSAPAC-10,/)
    await window.keyboard.press('t')
    await expect(window.getByText(/PSAPAC-10 is a Epic/)).toBeVisible()
    await expect(window.getByRole('dialog')).toHaveCount(0)
    expect((await timerFile())?.issueKey).toBe('PSAPAC-2')
  })

  test('the issue page shows the clock and a button that starts and stops', async () => {
    await item(/PSAPAC-2,/).click()
    await window.keyboard.press('Enter')
    await expect(issuePage()).toBeVisible()
    await issuePage().getByRole('button', { name: 'Start timer' }).click()
    await expect(issuePage().locator('[data-timer-clock]')).toBeVisible()
    await expect(sidebarTimer()).toContainText('PSAPAC-2')
    await window.keyboard.press('t')
    await expect(dialog('Stop the timer on PSAPAC-2')).toBeVisible()
    await expect(issuePage().getByRole('button', { name: 'Stop timer' })).toBeVisible()
  })

  test('shows a timer that jm started, and one jm stopped', async () => {
    await writeTimer('PSAPAC-4', 0.5)
    await expect(rowClock(/PSAPAC-4,/)).toBeVisible({ timeout: 10_000 })
    await expect(sidebarTimer()).toContainText('PSAPAC-4')
    await rm(join(stateDir, 'timer.json'))
    await expect(rowClock(/PSAPAC-4,/)).toHaveCount(0, { timeout: 10_000 })
  })
})

test.describe('switch', () => {
  test.beforeEach(async () => {
    await start()
    await writeTimer('PSAPAC-2', 1)
    await open()
    await expect(rowClock(/PSAPAC-2,/)).toBeVisible()
    await select(/PSAPAC-3,/)
    await window.keyboard.press('t')
  })

  const name = 'Switch to PSAPAC-3'

  test('logs the running timer, then starts the new one', async () => {
    await expect(dialog(name)).toContainText('The timer on PSAPAC-2 stops first')
    await expect(timeField(name)).toHaveValue('1h')
    await dialog(name).getByRole('button', { name: 'Log and start PSAPAC-3' }).click()

    await expect.poll(async () => (await counts(app)).edits).toBe(1)
    expect(await lastBody()).toMatchObject({ worklog: 'add', key: 'PSAPAC-2', timeSpent: '1h' })
    // Nothing starts until the worklog is in.
    expect((await timerFile())?.issueKey).not.toBe('PSAPAC-3')
    await releaseEdit(app)

    await expect(window.getByText('Logged 1h on PSAPAC-2')).toBeVisible()
    await expect(window.getByText('Started the timer on PSAPAC-3')).toBeVisible()
    await expect(rowClock(/PSAPAC-3,/)).toBeVisible()
    await expect(rowClock(/PSAPAC-2,/)).toHaveCount(0)
    expect((await timerFile())?.issueKey).toBe('PSAPAC-3')
  })

  test('Discard drops the old time and starts the new timer', async () => {
    await dialog(name).getByRole('button', { name: 'Discard and start PSAPAC-3' }).click()
    await expect(window.getByText('Discarded the timer on PSAPAC-2')).toBeVisible()
    await expect(rowClock(/PSAPAC-3,/)).toBeVisible()
    expect((await timerFile())?.issueKey).toBe('PSAPAC-3')
    expect((await counts(app)).edits).toBe(0)
  })

  test('Cancel changes nothing', async () => {
    await dialog(name).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(name)).toHaveCount(0)
    expect((await timerFile())?.issueKey).toBe('PSAPAC-2')
  })

  test('a timer jm changed meanwhile is refused, not logged', async () => {
    await writeTimer('PSAPAC-4', 2)
    await dialog(name).getByRole('button', { name: 'Log and start PSAPAC-3' }).click()
    await expect(dialog(name).getByRole('alert')).toContainText('PSAPAC-4 is being timed')
    expect((await timerFile())?.issueKey).toBe('PSAPAC-4')
    expect((await counts(app)).edits).toBe(0)
  })
})

test.describe('long timer', () => {
  test.beforeEach(async () => {
    await start()
    await writeTimer('PSAPAC-2', 9)
    await open()
    await expect(rowClock(/PSAPAC-2,/)).toBeVisible()
    await select(/PSAPAC-2,/)
    await window.keyboard.press('t')
  })

  const name = 'Stop the timer on PSAPAC-2'

  test('warns, and logs the time only once the user confirms it', async () => {
    await expect(dialog(name).getByRole('note')).toContainText('run a long time')
    await expect(timeField(name)).toHaveValue('9h')
    await dialog(name).getByRole('button', { name: 'Confirm and log' }).click()
    await expect.poll(async () => (await counts(app)).edits).toBe(1)
    expect(await lastBody()).toMatchObject({ worklog: 'add', key: 'PSAPAC-2', timeSpent: '9h' })
    await releaseEdit(app)
    await expect(window.getByText('Logged 9h on PSAPAC-2')).toBeVisible()
    expect(await timerFile()).toBeNull()
  })

  test('logs an edited time instead', async () => {
    await timeField(name).fill('2h')
    await dialog(name).getByRole('button', { name: 'Confirm and log' }).click()
    await expect.poll(async () => (await counts(app)).edits).toBe(1)
    expect(await lastBody()).toMatchObject({ worklog: 'add', key: 'PSAPAC-2', timeSpent: '2h' })
    await releaseEdit(app)
    await expect(window.getByText('Logged 2h on PSAPAC-2')).toBeVisible()
  })

  test('a timer under the threshold shows no warning', async () => {
    await dialog(name).getByRole('button', { name: 'Cancel' }).click()
    await writeTimer('PSAPAC-2', 2)
    await expect(rowClock(/PSAPAC-2,/)).toContainText('2:00', { timeout: 10_000 })
    await window.keyboard.press('t')
    await expect(dialog(name)).toBeVisible()
    await expect(dialog(name).getByRole('note')).toHaveCount(0)
    await expect(dialog(name).getByRole('button', { name: 'Log', exact: true })).toBeVisible()
  })
})

test.describe('reminders', () => {
  test('notifies once a timer passes the threshold, and not again before the interval', async () => {
    await writeTimer('PSAPAC-2', 9)
    await start({ JM_E2E_REMINDER_MS: '200' })
    await open()
    await expect
      .poll(async () => (await counts(app)).notifications)
      .toEqual([{ title: 'PSAPAC-2 is still being timed', body: 'The timer has run 9h.' }])
    // Many checks later, the hour between reminders has not passed.
    await window.waitForTimeout(1000)
    expect((await counts(app)).notifications).toHaveLength(1)
  })

  test('stays quiet under the threshold', async () => {
    await writeTimer('PSAPAC-2', 1)
    await start({ JM_E2E_REMINDER_MS: '200' })
    await open()
    await window.waitForTimeout(1000)
    expect((await counts(app)).notifications).toEqual([])
  })

  test('fires with every window closed', async () => {
    // Quitting on the last window is how Linux and Windows apps behave; macOS keeps running.
    test.skip(process.platform !== 'darwin', 'the app quits with its last window off macOS')
    await start({ JM_E2E_REMINDER_MS: '200' })
    await open()
    await window.close()
    await writeTimer('PSAPAC-2', 9)
    await expect
      .poll(async () => (await counts(app)).notifications.length, { timeout: 10_000 })
      .toBe(1)
  })
})
