import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeSettings, writeTimer } from '@jira-mgr/core/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startReminders } from './reminders'

const START = Date.parse('2026-10-10T01:00:00.000Z')
const HOUR = 3_600_000
const CHECK = 1000

let dir: string
let stop: (() => void) | undefined
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-desktop-reminders-'))
  process.env.JM_STATE_DIR = dir
  await writeSettings({
    siteUrl: 'https://team.atlassian.net',
    projectKey: 'PSAPAC',
    email: 'me@example.com',
  })
  // Only the interval is faked: the file reads need the real event loop.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})
afterEach(async () => {
  stop?.()
  vi.useRealTimers()
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

let checks = 0

async function run(clock: { at: number }) {
  const notices: { title: string; body: string }[] = []
  const logged: string[] = []
  checks = 0
  stop = startReminders({
    checked: () => {
      checks++
    },
    notify: (title, body) => notices.push({ title, body }),
    now: () => new Date(clock.at),
    checkMs: CHECK,
    log: (line) => logged.push(line),
  })
  // The first check runs at once; wait for it so every later check starts from idle.
  await vi.waitFor(() => {
    expect(checks).toBe(1)
  })
  return { notices, logged }
}

/** Lets the next check run and waits until it has read the files and finished. */
async function check() {
  const done = checks + 1
  await vi.advanceTimersByTimeAsync(CHECK)
  await vi.waitFor(() => {
    expect(checks).toBeGreaterThanOrEqual(done)
  })
}

const runningSince = (issueKey: string, start = START) =>
  writeTimer({ issueKey, segments: [{ start: new Date(start).toISOString(), end: null }] })

describe('startReminders', () => {
  it('says nothing under the threshold, then notifies once past it', async () => {
    await runningSince('PSAPAC-12')
    const clock = { at: START + 7 * HOUR }
    const { notices } = await run(clock)
    await check()
    expect(notices).toEqual([])
    clock.at = START + 8.5 * HOUR
    await check()
    expect(notices).toEqual([
      { title: 'PSAPAC-12 is still being timed', body: 'The timer has run 8h 30m.' },
    ])
    await check()
    expect(notices).toHaveLength(1)
  })

  it('repeats every interval while the timer runs on', async () => {
    await runningSince('PSAPAC-12')
    const clock = { at: START + 9 * HOUR }
    const { notices } = await run(clock)
    await check()
    clock.at += 30 * 60_000
    await check()
    expect(notices).toHaveLength(1)
    clock.at += 30 * 60_000
    await check()
    expect(notices).toHaveLength(2)
  })

  it('stays quiet while the timer is paused or absent', async () => {
    const clock = { at: START + 9 * HOUR }
    const { notices } = await run(clock)
    await check()
    await writeTimer({
      issueKey: 'PSAPAC-12',
      segments: [
        { start: new Date(START).toISOString(), end: new Date(START + HOUR).toISOString() },
      ],
    })
    await check()
    expect(notices).toEqual([])
  })

  it('starts the count again for a new timer', async () => {
    await runningSince('PSAPAC-12')
    const clock = { at: START + 9 * HOUR }
    const { notices } = await run(clock)
    await check()
    await runningSince('PSAPAC-13', START + 0.5 * HOUR)
    await check()
    expect(notices.map((n) => n.title)).toEqual([
      'PSAPAC-12 is still being timed',
      'PSAPAC-13 is still being timed',
    ])
  })

  it('logs a corrupt state file once, not at every check', async () => {
    await writeFile(join(dir, 'timer.json'), '{ not json')
    const { logged } = await run({ at: START })
    await check()
    await check()
    expect(logged).toHaveLength(1)
  })
})
