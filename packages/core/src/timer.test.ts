import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JiraMgrError } from './errors.js'
import type { HttpClient } from './http.js'
import { readTimer, writeSettings, writeTimer } from './state.js'
import {
  pauseTimer,
  restoreTimer,
  resumeTimer,
  startTimer,
  stopAndLog,
  stopTimer,
  switchAndLog,
} from './timer.js'
import { markdownToAdf } from './adf.js'

let dir: string
let clockMs: number

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-timer-'))
  process.env.JM_STATE_DIR = dir
  clockMs = new Date(2026, 9, 7, 9, 0, 0).getTime()
})

afterEach(async () => {
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

const now = () => new Date(clockMs)
const options = { now }
/** Moves the injected clock forward. */
const tick = (minutes: number) => {
  clockMs += minutes * 60_000
}

const readFileSyncText = () => readFileSync(join(dir, 'timer.json.lock'), 'utf8')

const task = (key: string) => ({ key, issueType: { name: 'Task' } })
const A = task('PSAPAC-1')
const B = task('PSAPAC-2')

async function rejection(promise: Promise<unknown>): Promise<JiraMgrError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(JiraMgrError)
  return error as JiraMgrError
}

describe('start, pause, resume and stop', () => {
  it('records one running segment on start', async () => {
    const { timer, stopped } = await startTimer(A, options)
    expect(stopped).toBeNull()
    expect(timer).toEqual({
      issueKey: 'PSAPAC-1',
      segments: [{ start: now().toISOString(), end: null }],
    })
    expect(await readTimer()).toEqual(timer)
  })

  it('accounts segments across pause and resume, and stop logs running time only', async () => {
    await startTimer(A, options)
    tick(30)
    const paused = await pauseTimer(options)
    expect(paused.segments).toHaveLength(1)
    expect(paused.segments[0]?.end).toBe(now().toISOString())
    tick(120)
    const resumed = await resumeTimer(options)
    expect(resumed.segments).toHaveLength(2)
    tick(15)
    const draft = await stopTimer(options)
    expect(draft).toMatchObject({
      issueKey: 'PSAPAC-1',
      started: new Date(2026, 9, 7, 9, 0, 0).toISOString(),
      timeSpent: '45m',
      seconds: 2700,
      needsConfirmation: false,
    })
    expect(await readTimer()).toBeNull()
  })

  it('pausing twice keeps one closed segment, and resuming twice one open segment', async () => {
    await startTimer(A, options)
    tick(10)
    const first = await pauseTimer(options)
    tick(10)
    expect(await pauseTimer(options)).toEqual(first)
    tick(10)
    const resumed = await resumeTimer(options)
    tick(10)
    expect(await resumeTimer(options)).toEqual(resumed)
    expect(resumed.segments).toHaveLength(2)
    expect((await readTimer())?.segments.map((s) => s.end === null)).toEqual([false, true])
  })

  it('stops a paused timer without counting the open pause', async () => {
    await startTimer(A, options)
    tick(20)
    await pauseTimer(options)
    tick(600)
    expect(await stopTimer(options)).toMatchObject({ timeSpent: '20m', needsConfirmation: false })
  })

  it('applies the rounding setting from settings.json', async () => {
    await writeSettings({ timer: { rounding: '15m' } })
    await startTimer(A, options)
    tick(8)
    expect((await stopTimer(options))?.timeSpent).toBe('15m')
  })

  it('flags a stop past the threshold setting', async () => {
    await writeSettings({ timer: { reminderThresholdHours: 1 } })
    await startTimer(A, options)
    tick(61)
    expect((await stopTimer(options))?.needsConfirmation).toBe(true)
  })

  it('flags a stop after a segment crossed local midnight', async () => {
    clockMs = new Date(2026, 9, 7, 23, 50).getTime()
    await startTimer(A, options)
    tick(20)
    expect((await stopTimer(options))?.needsConfirmation).toBe(true)
  })

  it('returns null when stopping with no timer', async () => {
    expect(await stopTimer(options)).toBeNull()
  })

  it.each([pauseTimer, resumeTimer])('refuses pause or resume with no timer', async (op) => {
    expect(await rejection(op(options))).toMatchObject({ code: 'not_found' })
  })
})

describe('starting on another issue', () => {
  it('refuses without switch and leaves the running timer alone', async () => {
    await startTimer(A, options)
    tick(10)
    const error = await rejection(startTimer(B, options))
    expect(error).toMatchObject({
      code: 'validation_failed',
      details: { runningIssueKey: 'PSAPAC-1' },
    })
    expect((await readTimer())?.issueKey).toBe('PSAPAC-1')
  })

  it('with switch stops the old timer, returns its draft and starts the new one', async () => {
    await startTimer(A, options)
    tick(12)
    const { timer, stopped } = await startTimer(B, { ...options, switch: true })
    expect(stopped).toMatchObject({ issueKey: 'PSAPAC-1', timeSpent: '10m' })
    expect(timer.issueKey).toBe('PSAPAC-2')
    expect(await readTimer()).toEqual(timer)
  })

  it('expectRunning refuses when a different timer runs, and changes nothing', async () => {
    await startTimer(B, options)
    tick(10)
    const error = await rejection(
      startTimer(task('PSAPAC-3'), { ...options, switch: true, expectRunning: 'PSAPAC-1' }),
    )
    expect(error).toMatchObject({
      code: 'validation_failed',
      details: { runningIssueKey: 'PSAPAC-2', expectedIssueKey: 'PSAPAC-1' },
    })
    expect((await readTimer())?.issueKey).toBe('PSAPAC-2')
  })

  it('expectRunning passes when that timer still runs, and when none runs', async () => {
    await startTimer(A, options)
    tick(12)
    const { stopped } = await startTimer(B, { ...options, switch: true, expectRunning: 'PSAPAC-1' })
    expect(stopped?.issueKey).toBe('PSAPAC-1')
    await stopTimer(options)
    const none = await startTimer(A, { ...options, switch: true, expectRunning: 'PSAPAC-9' })
    expect(none.stopped).toBeNull()
  })

  it('switching from nothing starts without a draft', async () => {
    expect((await startTimer(A, { ...options, switch: true })).stopped).toBeNull()
  })

  it('starting the running issue again is a no-op', async () => {
    const { timer } = await startTimer(A, options)
    tick(5)
    const again = await startTimer(A, options)
    expect(again).toEqual({ timer, stopped: null })
  })

  it('starting a paused issue resumes it', async () => {
    await startTimer(A, options)
    tick(5)
    await pauseTimer(options)
    tick(5)
    const { timer, stopped } = await startTimer(A, options)
    expect(stopped).toBeNull()
    expect(timer.segments).toHaveLength(2)
    expect(timer.segments[1]?.end).toBeNull()
  })
})

describe('issue types', () => {
  it.each(['Task', 'Bug', 'Story', 'Subtask'])('times a %s', async (name) => {
    await startTimer({ key: 'PSAPAC-3', issueType: { name } }, options)
    expect((await readTimer())?.issueKey).toBe('PSAPAC-3')
  })

  it('refuses an Epic with validation_failed and starts nothing', async () => {
    const epic = { key: 'PSAPAC-9', issueType: { name: 'Epic' } }
    const error = await rejection(startTimer(epic, options))
    expect(error.code).toBe('validation_failed')
    expect(await readTimer()).toBeNull()
  })

  it('refuses a malformed key', async () => {
    expect(await rejection(startTimer(task('../x'), options))).toMatchObject({
      code: 'validation_failed',
    })
  })

  it('refuses an Epic even while another issue runs, with switch', async () => {
    await startTimer(A, options)
    const epic = { key: 'PSAPAC-9', issueType: { name: 'Epic' } }
    await rejection(startTimer(epic, { ...options, switch: true }))
    expect((await readTimer())?.issueKey).toBe('PSAPAC-1')
  })
})

describe('concurrency', () => {
  it('loses no timer when many callers switch at once', async () => {
    const keys = Array.from({ length: 12 }, (_, i) => `PSAPAC-${String(i + 1)}`)
    const results = await Promise.all(
      keys.map((key) => startTimer(task(key), { ...options, switch: true })),
    )
    const stopped = results.flatMap((r) => (r.stopped === null ? [] : [r.stopped.issueKey]))
    const last = (await readTimer())?.issueKey ?? ''
    // Every timer was either stopped once, or is the one still running.
    expect([...stopped, last].sort()).toEqual([...keys].sort())
    expect(new Set(stopped).size).toBe(stopped.length)
    expect(await readdir(dir)).toEqual(['timer.json'])
  })

  it('keeps every segment closed but the last under parallel pause and resume', async () => {
    await startTimer(A, options)
    await Promise.all([
      pauseTimer(options),
      resumeTimer(options),
      pauseTimer(options),
      resumeTimer(options),
    ])
    const timer = await readTimer()
    expect(timer?.segments.slice(0, -1).every((s) => s.end !== null)).toBe(true)
  })

  it('waits for a live lock, then gives up with a typed error', async () => {
    await writeFile(
      join(dir, 'timer.json.lock'),
      JSON.stringify({ pid: process.pid, at: Date.now(), token: 'x' }),
    )
    const error = await rejection(startTimer(A, { ...options, lock: { waitMs: 50, pollMs: 5 } }))
    expect(error.code).toBe('internal')
    expect(await readTimer()).toBeNull()
  })

  it('recovers a lock whose process is dead', async () => {
    await writeFile(
      join(dir, 'timer.json.lock'),
      JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now(), token: 'x' }),
    )
    await startTimer(A, options)
    expect((await readTimer())?.issueKey).toBe('PSAPAC-1')
    expect(await readdir(dir)).toEqual(['timer.json'])
  })

  it('recovers a lock older than staleMs even when its pid lives', async () => {
    await writeFile(
      join(dir, 'timer.json.lock'),
      JSON.stringify({ pid: process.pid, at: Date.now() - 60_000, token: 'x' }),
    )
    await startTimer(A, { ...options, lock: { staleMs: 1000 } })
    expect((await readTimer())?.issueKey).toBe('PSAPAC-1')
  })

  it.each([0, -1])('recovers a fresh lock whose pid is %s', async (pid) => {
    // Signalling pid 0 or -1 reaches a process group, so only the schema keeps them from "live".
    await writeFile(
      join(dir, 'timer.json.lock'),
      JSON.stringify({ pid, at: Date.now(), token: 'x' }),
    )
    await startTimer(A, { ...options, lock: { waitMs: 200, pollMs: 5 } })
    expect((await readTimer())?.issueKey).toBe('PSAPAC-1')
  })

  it.each(['not json', '{}', '{"pid":"7","at":1}', 'null'])(
    'recovers a corrupt or misshapen lock file (%s)',
    async (text) => {
      await writeFile(join(dir, 'timer.json.lock'), text)
      await startTimer(A, options)
      expect((await readTimer())?.issueKey).toBe('PSAPAC-1')
    },
  )

  it('releases the lock when the operation fails', async () => {
    await startTimer(A, options)
    await rejection(startTimer(B, options))
    expect(await readdir(dir)).toEqual(['timer.json'])
  })

  it('stamps the lock when it is taken, not when the wait began', async () => {
    // A live lock that goes stale mid-wait: the waiter takes over after about staleMs.
    await writeFile(
      join(dir, 'timer.json.lock'),
      JSON.stringify({ pid: process.pid, at: Date.now(), token: 'x' }),
    )
    let age = Infinity
    await startTimer(A, {
      lock: { waitMs: 2000, staleMs: 100, pollMs: 5 },
      now: () => {
        const { at } = JSON.parse(readFileSyncText()) as { at: number }
        age = Date.now() - at
        return now()
      },
    })
    expect(age).toBeLessThan(50)
  })

  it('does not release a lock that was reclaimed from under a slow holder', async () => {
    await writeTimer(null)
    // The clock runs under the lock, so swap the lock file there, as a reclaimer would.
    await startTimer(A, {
      now: () => {
        const taken = JSON.stringify({ pid: process.pid, at: Date.now(), token: 'other' })
        writeFileSync(join(dir, 'timer.json.lock'), taken)
        return now()
      },
    })
    expect(await readdir(dir)).toContain('timer.json.lock')
  })
})

describe('logging a stopped timer', () => {
  const worklogResponse = {
    id: '1',
    timeSpent: '10m',
    timeSpentSeconds: 600,
    started: '2026-10-06T23:00:00.000+0000',
    created: '2026-10-07T00:00:00.000+0000',
    updated: '2026-10-07T00:00:00.000+0000',
  }

  function fakeHttp(respond: () => unknown) {
    const requests: { method: string; path: string; body: unknown }[] = []
    const http: HttpClient = {
      request: async (method, path, opts) => {
        requests.push({ method, path, body: opts?.body })
        await Promise.resolve()
        return respond()
      },
    }
    return { http, requests }
  }

  const refused = () => {
    throw new JiraMgrError('permission_denied', 'No.')
  }
  const startedAt = new Date(2026, 9, 7, 9, 0, 0).toISOString()

  /** A timer with two segments, 12 minutes of running time, still running. */
  async function runTwoSegments() {
    await startTimer(A, options)
    tick(6)
    await pauseTimer(options)
    tick(30)
    await resumeTimer(options)
    tick(6)
  }

  it('stops the timer and logs the rounded time from the first start', async () => {
    const { http, requests } = fakeHttp(() => worklogResponse)
    await runTwoSegments()
    const result = await stopAndLog(http, options)
    expect(result?.draft.timeSpent).toBe('10m')
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/rest/api/3/issue/PSAPAC-1/worklog?adjustEstimate=auto',
        body: { timeSpent: '10m', started: startedAt.replace(/Z$/, '+0000') },
      },
    ])
    expect(await readTimer()).toBeNull()
  })

  it('logs an adjusted timeSpent and a comment', async () => {
    const { http, requests } = fakeHttp(() => worklogResponse)
    await startTimer(A, options)
    tick(12)
    const comment = markdownToAdf('Fixed it.')
    await stopAndLog(http, { ...options, timeSpent: '1h', comment, expectRunning: 'PSAPAC-1' })
    expect(requests[0]?.body).toMatchObject({ timeSpent: '1h', comment })
  })

  it('does nothing when no timer runs', async () => {
    const { http, requests } = fakeHttp(() => worklogResponse)
    expect(await stopAndLog(http, options)).toBeNull()
    expect(requests).toHaveLength(0)
  })

  it('refuses a bad comment before stopping, so the timer keeps running', async () => {
    const { http, requests } = fakeHttp(() => worklogResponse)
    await startTimer(A, options)
    tick(7 * 60)
    const before = await readTimer()
    const bad = { version: 2, type: 'doc', content: [] } as never
    expect(await rejection(stopAndLog(http, { ...options, comment: bad }))).toMatchObject({
      code: 'validation_failed',
    })
    expect(await rejection(stopAndLog(http, { ...options, timeSpent: '1.5h' }))).toMatchObject({
      code: 'validation_failed',
    })
    expect(requests).toHaveLength(0)
    expect(await readTimer()).toEqual(before)
  })

  it.each([
    ['a 401', () => new JiraMgrError('permission_denied', 'Not logged in.'), 'permission_denied'],
    ['a 5xx', () => new JiraMgrError('jira_error', 'Jira is down.'), 'jira_error'],
    ['a network drop', () => new TypeError('fetch failed'), 'internal'],
  ])('puts the timer back paused with every segment after %s', async (_name, fail, code) => {
    const { http } = fakeHttp(() => {
      tick(45)
      throw fail()
    })
    await runTwoSegments()
    const error = await rejection(stopAndLog(http, options))
    expect(error.code).toBe(code)
    expect(error.message).toContain('The timer is paused on PSAPAC-1; stop the timer again.')
    expect(error.message).toContain(startedAt)
    expect(error.details).toMatchObject({ restored: true, draft: { timeSpent: '10m' } })
    const timer = await readTimer()
    expect(timer?.issueKey).toBe('PSAPAC-1')
    expect(timer?.segments).toHaveLength(2)
    expect(timer?.segments.every((s) => s.end !== null)).toBe(true)
    // Stopping again gives the same time.
    tick(90)
    expect((await stopTimer(options))?.timeSpent).toBe('10m')
  })

  it.each([
    ['jira_error', new JiraMgrError('jira_error', 'Jira is down.'), true],
    ['internal', new TypeError('fetch failed'), true],
    ['permission_denied', new JiraMgrError('permission_denied', 'No.'), false],
    ['validation_failed', new JiraMgrError('validation_failed', 'Bad.'), false],
  ])(
    'on %s says to check the worklogs only when the request may have landed',
    async (_c, err, check) => {
      const { http } = fakeHttp(() => {
        throw err
      })
      await startTimer(A, options)
      tick(12)
      const error = await rejection(stopAndLog(http, options))
      expect(error.message.includes("Check PSAPAC-1's worklogs before retrying.")).toBe(check)
    },
  )

  it('does not overwrite a timer someone started while it logged', async () => {
    const { http } = fakeHttp(() => {
      writeFileSync(
        join(dir, 'timer.json'),
        JSON.stringify({
          issueKey: 'PSAPAC-7',
          segments: [{ start: now().toISOString(), end: null }],
        }),
      )
      return refused()
    })
    await runTwoSegments()
    const error = await rejection(stopAndLog(http, options))
    expect(error.message).toContain('could not be put back')
    expect(error.message).toContain(startedAt)
    expect(error.details).toMatchObject({ restored: false, draft: { issueKey: 'PSAPAC-1' } })
    expect((await readTimer())?.issueKey).toBe('PSAPAC-7')
  })

  it('refuses an adjusted timeSpent without expectRunning, and stops nothing', async () => {
    const { http, requests } = fakeHttp(() => worklogResponse)
    await startTimer(A, options)
    tick(12)
    const before = await readTimer()
    const error = await rejection(stopAndLog(http, { ...options, timeSpent: '3h' }))
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('expectRunning')
    expect(requests).toHaveLength(0)
    expect(await readTimer()).toEqual(before)
  })

  it('does not log the stop dialog time on a timer the CLI switched to meanwhile', async () => {
    const { http, requests } = fakeHttp(() => worklogResponse)
    // The app's dialog is open on A and the user types 3h.
    await startTimer(A, options)
    tick(12)
    // Meanwhile the CLI switches to C, which logs A and starts C.
    await switchAndLog(http, task('PSAPAC-3'), options)
    expect(requests).toHaveLength(1)
    tick(5)
    const running = await readTimer()
    const error = await rejection(
      stopAndLog(http, { ...options, timeSpent: '3h', expectRunning: 'PSAPAC-1' }),
    )
    expect(error).toMatchObject({
      code: 'validation_failed',
      details: { runningIssueKey: 'PSAPAC-3', expectedIssueKey: 'PSAPAC-1' },
    })
    expect(requests).toHaveLength(1)
    expect(await readTimer()).toEqual(running)
  })

  it('stopTimer with expectRunning refuses a different timer and keeps it', async () => {
    await startTimer(B, options)
    tick(12)
    const before = await readTimer()
    const error = await rejection(stopTimer({ ...options, expectRunning: 'PSAPAC-1' }))
    expect(error.details).toMatchObject({ runningIssueKey: 'PSAPAC-2' })
    expect(await readTimer()).toEqual(before)
    expect((await stopTimer({ ...options, expectRunning: 'PSAPAC-2' }))?.issueKey).toBe('PSAPAC-2')
  })

  it('stops when the running timer is the one shown', async () => {
    const { http, requests } = fakeHttp(() => worklogResponse)
    await startTimer(A, options)
    tick(12)
    await stopAndLog(http, { ...options, timeSpent: '3h', expectRunning: 'PSAPAC-1' })
    expect(requests[0]?.body).toMatchObject({ timeSpent: '3h' })
    expect(await readTimer()).toBeNull()
  })

  it('restoreTimer only fills an empty timer.json', async () => {
    await runTwoSegments()
    const taken = await readTimer()
    if (taken === null) throw new Error('expected a timer')
    expect(await restoreTimer(taken, options)).toBe(false)
    await stopTimer(options)
    expect(await restoreTimer(taken, options)).toBe(true)
    expect((await readTimer())?.segments.every((s) => s.end !== null)).toBe(true)
  })

  describe('switchAndLog', () => {
    it('logs the old timer, then starts the new one', async () => {
      const { http, requests } = fakeHttp(() => worklogResponse)
      await startTimer(A, options)
      tick(12)
      const result = await switchAndLog(http, B, options)
      expect(result.stopped).toMatchObject({ issueKey: 'PSAPAC-1', timeSpent: '10m' })
      expect(result.logged?.worklog.id).toBe('1')
      expect(result.timer.issueKey).toBe('PSAPAC-2')
      expect(requests).toHaveLength(1)
      expect(await readTimer()).toEqual(result.timer)
    })

    it('keeps the old timer paused and starts nothing when logging fails', async () => {
      const { http } = fakeHttp(refused)
      await startTimer(A, options)
      tick(12)
      const error = await rejection(switchAndLog(http, B, options))
      expect(error.details).toMatchObject({ restored: true })
      const timer = await readTimer()
      expect(timer?.issueKey).toBe('PSAPAC-1')
      expect(timer?.segments.every((s) => s.end !== null)).toBe(true)
    })

    it('stops nothing when the new issue is an Epic or the comment is bad', async () => {
      const { http, requests } = fakeHttp(() => worklogResponse)
      await startTimer(A, options)
      const epic = { key: 'PSAPAC-9', issueType: { name: 'Epic' } }
      await rejection(switchAndLog(http, epic, options))
      const bad = { version: 2, type: 'doc', content: [] } as never
      await rejection(switchAndLog(http, B, { ...options, comment: bad }))
      expect(requests).toHaveLength(0)
      expect((await readTimer())?.segments.at(-1)?.end).toBeNull()
    })

    it('resumes the same issue with nothing to log', async () => {
      const { http, requests } = fakeHttp(() => worklogResponse)
      await startTimer(A, options)
      tick(5)
      await pauseTimer(options)
      tick(5)
      const result = await switchAndLog(http, A, options)
      expect(result.logged).toBeNull()
      expect(result.timer.segments).toHaveLength(2)
      expect(requests).toHaveLength(0)
    })

    it('says the old time was logged when the start is then refused', async () => {
      const { http } = fakeHttp(() => {
        writeFileSync(
          join(dir, 'timer.json'),
          JSON.stringify({
            issueKey: 'PSAPAC-7',
            segments: [{ start: now().toISOString(), end: null }],
          }),
        )
        return worklogResponse
      })
      await startTimer(A, options)
      tick(12)
      const error = await rejection(switchAndLog(http, B, options))
      expect(error.code).toBe('validation_failed')
      expect(error.message).toContain('The PSAPAC-1 time (10m) was logged')
      expect(error.details).toMatchObject({
        runningIssueKey: 'PSAPAC-7',
        logged: { draft: { issueKey: 'PSAPAC-1', timeSpent: '10m' }, worklog: { id: '1' } },
      })
      expect((await readTimer())?.issueKey).toBe('PSAPAC-7')
    })

    it('refuses an adjusted timeSpent without expectRunning, and stops nothing', async () => {
      const { http, requests } = fakeHttp(() => worklogResponse)
      await startTimer(A, options)
      tick(12)
      const before = await readTimer()
      const error = await rejection(switchAndLog(http, B, { ...options, timeSpent: '3h' }))
      expect(error.code).toBe('validation_failed')
      expect(requests).toHaveLength(0)
      expect(await readTimer()).toEqual(before)
    })

    it('refuses when another timer than the one shown runs, and logs nothing', async () => {
      const { http, requests } = fakeHttp(() => worklogResponse)
      await startTimer(B, options)
      tick(12)
      const error = await rejection(
        switchAndLog(http, task('PSAPAC-3'), { ...options, expectRunning: 'PSAPAC-1' }),
      )
      expect(error.details).toMatchObject({ runningIssueKey: 'PSAPAC-2' })
      expect(requests).toHaveLength(0)
      expect((await readTimer())?.issueKey).toBe('PSAPAC-2')
    })
  })
})
