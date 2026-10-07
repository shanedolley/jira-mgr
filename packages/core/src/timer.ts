import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { z } from 'zod'

import { adfDocSchema } from './adf-schema.js'
import { JiraMgrError } from './errors.js'
import { addWorklog, type AddWorklogInput, type Worklog } from './extras.js'
import type { HttpClient } from './http.js'
import { readSettings, readTimer, stateDir, writeTimer } from './state.js'
import { assertTimeable, worklogDraft, type RunningTimer, type WorklogDraft } from './timer-calc.js'
import { duration, issueKey, parseInput } from './validate.js'

/**
 * The timer engine: start, stop, pause and resume over the shared `timer.json`. The app and the
 * CLI both call it, and every read-modify-write runs under an exclusive lock file, so two
 * writers cannot lose a segment. Node-only; the pure rules live in `timer-calc.ts`.
 */

export interface LockOptions {
  /** How long to wait for another writer before giving up. Default 5000. */
  waitMs?: number
  /** A lock older than this is abandoned. An operation takes milliseconds. Default 10000. */
  staleMs?: number
  /** Pause between attempts. Default 10. */
  pollMs?: number
}

export interface TimerOptions {
  /** The clock. Tests inject a fixed one. */
  now?: () => Date
  lock?: LockOptions
}

const LOCK_NAME = 'timer.json.lock'

function isCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    // EPERM means the process exists under another user.
    return !isCode(cause, 'ESRCH')
  }
}

const lockSchema = z.object({ pid: z.number().int().positive(), at: z.number() })

function isStale(text: string, staleMs: number): boolean {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return true
  }
  const info = lockSchema.safeParse(raw)
  return !info.success || Date.now() - info.data.at > staleMs || !pidAlive(info.data.pid)
}

/**
 * Removes the lock when its holder is dead or too old. Returns true when the caller should try
 * to acquire again at once. The removal is a rename, so only one reclaimer wins; if the file it
 * took turns out to be a lock acquired after the check, it is linked back.
 * ponytail: that link-back leaves a window of microseconds where a third writer can slip in,
 * and needs a double race (stale holder plus two reclaimers). Add a reclaim lock if it ever bites.
 */
async function reclaimIfStale(file: string, staleMs: number): Promise<boolean> {
  let seen: string
  try {
    seen = await readFile(file, 'utf8')
  } catch (cause) {
    if (isCode(cause, 'ENOENT')) return true
    throw cause
  }
  if (!isStale(seen, staleMs)) return false
  const moved = `${file}.${randomUUID()}.stale`
  try {
    await rename(file, moved)
  } catch (cause) {
    if (isCode(cause, 'ENOENT')) return true
    throw cause
  }
  if ((await readFile(moved, 'utf8')) !== seen) await link(moved, file).catch(() => undefined)
  await rm(moved, { force: true })
  return true
}

async function withLock<T>(lock: LockOptions = {}, fn: () => Promise<T>): Promise<T> {
  const { waitMs = 5000, staleMs = 10_000, pollMs = 10 } = lock
  const file = join(stateDir(), LOCK_NAME)
  const token = randomUUID()
  let body = ''
  const deadline = Date.now() + waitMs
  try {
    await mkdir(stateDir(), { recursive: true })
    // Write the whole body to a private file, then link it into place: the lock appears
    // complete or not at all, and link fails with EEXIST while another writer holds it.
    const mine = `${file}.${randomUUID()}.tmp`
    try {
      for (;;) {
        // Stamp each attempt, so a lock taken after a long wait is fresh, not stale on entry.
        body = JSON.stringify({ pid: process.pid, at: Date.now(), token })
        await writeFile(mine, body)
        try {
          await link(mine, file)
          break
        } catch (cause) {
          if (!isCode(cause, 'EEXIST')) throw cause
        }
        if (await reclaimIfStale(file, staleMs)) continue
        if (Date.now() >= deadline) {
          throw new JiraMgrError(
            'internal',
            `${file} is held by another timer operation. Try again, or delete the file if no jm or app process is running.`,
          )
        }
        await sleep(pollMs)
      }
    } finally {
      await rm(mine, { force: true })
    }
  } catch (cause) {
    if (cause instanceof JiraMgrError) throw cause
    throw new JiraMgrError('internal', `Cannot lock ${file}.`, { cause })
  }
  try {
    return await fn()
  } finally {
    // Release only our own lock: a slow holder's lock may have been reclaimed and retaken.
    const current = await readFile(file, 'utf8').catch(() => undefined)
    if (current === body) await rm(file, { force: true })
  }
}

const clock = (options: TimerOptions) => (options.now ?? (() => new Date()))()

function running(now: Date, key: string): RunningTimer {
  return { issueKey: key, segments: [{ start: now.toISOString(), end: null }] }
}

function noTimer(): JiraMgrError {
  return new JiraMgrError('not_found', 'No timer is running. Start one first.')
}

export interface StartResult {
  timer: RunningTimer
  /** The timer that `switch` stopped, to log. `null` when nothing was running. */
  stopped: WorklogDraft | null
}

/** A timer taken off `timer.json`: the draft to log, and the timer with every segment closed. */
interface Stopped {
  timer: RunningTimer
  draft: WorklogDraft
}

function refuseOther(running: string, expected: string): JiraMgrError {
  return new JiraMgrError(
    'validation_failed',
    `${running} is being timed, not ${expected}. Look again before switching.`,
    { details: { runningIssueKey: running, expectedIssueKey: expected } },
  )
}

/**
 * Starts a timer on a Task, Bug, Story or Subtask (anything else is `validation_failed`).
 *
 * - Nothing running: starts.
 * - The same issue already runs: a no-op. If it is paused, it resumes.
 * - Another issue runs: throws `validation_failed` with `details.runningIssueKey`, unless
 *   `switch` is true. Then it stops that timer, starts the new one in the same write, and
 *   returns the old one's draft in `stopped` for the caller to log (Q50, Q59). That draft is
 *   the only record of the old timer: prefer `switchAndLog`, which restores it when logging fails.
 * - `expectRunning` is the issue key the caller showed the user. A different running timer
 *   throws `validation_failed` with `details.runningIssueKey` and `details.expectedIssueKey`,
 *   so a dialog never acts on a timer the CLI changed.
 */
export async function startTimer(
  issue: { key: string; issueType: { name: string } },
  options: TimerOptions & { switch?: boolean; expectRunning?: string } = {},
): Promise<StartResult> {
  const key = parseInput(issueKey, issue.key, 'start the timer')
  assertTimeable({ key, issueType: issue.issueType })
  const expected = parseInput(issueKey.optional(), options.expectRunning, 'start the timer')
  return withLock(options.lock, async () => {
    const now = clock(options)
    const current = await readTimer()
    if (current === null) {
      const timer = running(now, key)
      await writeTimer(timer)
      return { timer, stopped: null }
    }
    if (expected !== undefined && current.issueKey !== expected) {
      throw refuseOther(current.issueKey, expected)
    }
    if (current.issueKey === key) return { timer: await resume(current, now), stopped: null }
    if (options.switch !== true) {
      throw new JiraMgrError(
        'validation_failed',
        `${current.issueKey} is already being timed. Stop it first, or switch to ${key}.`,
        { details: { runningIssueKey: current.issueKey } },
      )
    }
    const stopped = worklogDraft(current, (await readSettings()).timer, now)
    const timer = running(now, key)
    await writeTimer(timer)
    return { timer, stopped }
  })
}

/**
 * Takes the timer off `timer.json` under the lock. Skips it when it runs on `keep`, and refuses
 * when it does not run on `expectRunning`. With `confirmed: false`, refuses a draft that needs
 * confirmation (Q55), judged on the draft taken here, so the clock cannot pass midnight between
 * the caller's check and the stop.
 */
async function takeTimer(
  options: TimerOptions,
  {
    keep,
    expectRunning,
    confirmed,
  }: { keep?: string; expectRunning?: string; confirmed?: boolean } = {},
): Promise<Stopped | null> {
  return withLock(options.lock, async () => {
    const current = await readTimer()
    if (current === null) return null
    if (expectRunning !== undefined && current.issueKey !== expectRunning) {
      throw refuseOther(current.issueKey, expectRunning)
    }
    if (current.issueKey === keep) return null
    const now = clock(options)
    const draft = worklogDraft(current, (await readSettings()).timer, now)
    if (confirmed === false && draft.needsConfirmation) {
      throw new JiraMgrError(
        'validation_failed',
        `${draft.issueKey} has run ${draft.timeSpent} since ${draft.started}, past the reminder threshold or across midnight. Confirm it, or give the time to log.`,
        { details: { draft } },
      )
    }
    await writeTimer(null)
    return {
      draft,
      timer: {
        ...current,
        segments: current.segments.map((s) => ({ ...s, end: s.end ?? now.toISOString() })),
      },
    }
  })
}

/**
 * Stops and clears the timer, and returns the draft to log. `null` when none runs. With
 * `expectRunning`, a different running timer throws `validation_failed` and nothing stops, so a
 * dialog's discard cannot drop a timer the user did not see.
 */
export async function stopTimer(
  options: TimerOptions & { expectRunning?: string } = {},
): Promise<WorklogDraft | null> {
  const expectRunning = parseInput(issueKey.optional(), options.expectRunning, 'stop the timer')
  return (await takeTimer(options, { expectRunning }))?.draft ?? null
}

/**
 * Puts a stopped timer back, paused, when logging its time failed. `timer.json` must still be
 * empty: a timer someone started meanwhile is never overwritten. Returns whether it restored.
 */
export async function restoreTimer(
  timer: RunningTimer,
  options: TimerOptions = {},
): Promise<boolean> {
  return withLock(options.lock, async () => {
    if ((await readTimer()) !== null) return false
    await writeTimer({
      ...timer,
      segments: timer.segments.map((s) => ({ ...s, end: s.end ?? clock(options).toISOString() })),
    })
    return true
  })
}

/** Closes the open segment. Pausing a paused timer changes nothing. Throws `not_found` when idle. */
export async function pauseTimer(options: TimerOptions = {}): Promise<RunningTimer> {
  return withLock(options.lock, async () => {
    const current = await readTimer()
    if (current === null) throw noTimer()
    const last = current.segments.at(-1)
    if (last?.end !== null) return current
    const timer = {
      ...current,
      segments: [...current.segments.slice(0, -1), { ...last, end: clock(options).toISOString() }],
    }
    await writeTimer(timer)
    return timer
  })
}

/** Opens a new segment. Resuming a running timer changes nothing. Throws `not_found` when idle. */
export async function resumeTimer(options: TimerOptions = {}): Promise<RunningTimer> {
  return withLock(options.lock, async () => {
    const current = await readTimer()
    if (current === null) throw noTimer()
    return resume(current, clock(options))
  })
}

/** Call under the lock. */
async function resume(current: RunningTimer, now: Date): Promise<RunningTimer> {
  if (current.segments.at(-1)?.end === null) return current
  const timer = {
    ...current,
    segments: [...current.segments, { start: now.toISOString(), end: null }],
  }
  await writeTimer(timer)
  return timer
}

export interface LogOptions {
  /** An ADF comment for the worklog. */
  comment?: AddWorklogInput['comment']
  /** Log this Jira duration instead of the draft's, for a time the user adjusted. */
  timeSpent?: string
  /**
   * The user saw a draft that needs confirmation (past the reminder threshold, or across
   * midnight) and accepts it as is. Without it, and without `timeSpent`, such a draft throws
   * `validation_failed` with `details.draft` and nothing stops.
   */
  confirm?: boolean
  /**
   * Cuts the worklog request short. The timer then comes back paused, as for any failed log, so
   * an interrupt loses no time.
   */
  signal?: AbortSignal
}

const logInput = z
  .object({
    comment: adfDocSchema.optional(),
    timeSpent: duration.optional(),
    expectRunning: issueKey.optional(),
  })
  .refine((input) => input.timeSpent === undefined || input.expectRunning !== undefined, {
    path: ['expectRunning'],
    error: 'Required with timeSpent: pass the issue key the user was shown.',
  })

/**
 * Check what the worklog needs before anything is stopped, so a bad input loses no time. An
 * adjusted `timeSpent` belongs to the timer the user saw, so it needs `expectRunning` too.
 */
function checkLog(options: LogOptions & { expectRunning?: string }) {
  const { comment, timeSpent, expectRunning } = options
  return parseInput(logInput, { comment, timeSpent, expectRunning }, 'log the timer')
}

/** An adjusted time is a confirmed one: the user chose what to log. */
const isConfirmed = ({ confirm, timeSpent }: LogOptions) =>
  confirm === true || timeSpent !== undefined

/**
 * Logs a taken timer. When anything fails, the timer goes back paused (`restoreTimer`) and the
 * error says so, with the draft and the timer in `details`. A timeout can leave the worklog
 * logged as well, so a retry may log twice.
 */
async function logOrRestore(
  http: HttpClient,
  { timer, draft }: Stopped,
  log: z.output<typeof logInput>,
  options: TimerOptions & LogOptions,
): Promise<{ draft: WorklogDraft; worklog: Worklog }> {
  const timeSpent = log.timeSpent ?? draft.timeSpent
  try {
    const worklog = await addWorklog(
      http,
      draft.issueKey,
      {
        timeSpent,
        started: new Date(draft.started),
        ...(log.comment !== undefined && { comment: log.comment }),
      },
      { signal: options.signal },
    )
    return { draft, worklog }
  } catch (cause) {
    const restored = await restoreTimer(timer, options).catch(() => false)
    const code = cause instanceof JiraMgrError ? cause.code : 'internal'
    const why = cause instanceof Error ? cause.message : String(cause)
    // Only a Jira or network failure may follow a request that got through.
    const check =
      code === 'jira_error' || code === 'internal'
        ? ` Check ${draft.issueKey}'s worklogs before retrying.`
        : ''
    const next = restored
      ? `The timer is paused on ${draft.issueKey}; stop the timer again.`
      : `The timer could not be put back, so log it by hand.`
    throw new JiraMgrError(
      code,
      `Logging ${timeSpent} on ${draft.issueKey} (started ${draft.started}) failed: ${why}${check} ${next}`,
      { details: { draft, timer, restored }, cause },
    )
  }
}

/**
 * Stops the timer and logs it with `addWorklog`, for the stop dialog and `jm timer stop` (Q51).
 * Returns `null` when no timer runs. The input is checked before the timer stops. If logging
 * fails the timer comes back paused, and the error carries `details.draft`, `details.timer`
 * and `details.restored`.
 *
 * `expectRunning` is the issue key the caller showed the user. A different running timer throws
 * `validation_failed` and nothing stops. It is required with `timeSpent`, so an adjusted time
 * never lands on a timer the user did not see.
 *
 * A draft that needs confirmation (past the threshold, or across midnight) throws
 * `validation_failed` with `details.draft` and stops nothing, unless `confirm` or `timeSpent` is
 * given. The check runs under the lock on the draft being taken. An aborted `signal` fails the
 * worklog request, and the timer comes back paused.
 */
export async function stopAndLog(
  http: HttpClient,
  options: TimerOptions & LogOptions & { expectRunning?: string } = {},
): Promise<{ draft: WorklogDraft; worklog: Worklog } | null> {
  const log = checkLog(options)
  options.signal?.throwIfAborted()
  const stopped = await takeTimer(options, {
    expectRunning: log.expectRunning,
    confirmed: isConfirmed(options),
  })
  return stopped === null ? null : logOrRestore(http, stopped, log, options)
}

/**
 * Stops the running timer, logs it, then starts the timer on `issue`, for a switch (Q50, Q59).
 * Nothing stops until the issue and log input check out. If logging fails the old timer comes
 * back paused, the new one does not start, and the error is as in `stopAndLog`. Starting on the
 * issue already running just resumes it, with nothing to log. `expectRunning` is as in
 * `startTimer`, and is required with `timeSpent` as in `stopAndLog`. A timer someone starts
 * between the log and the start makes the start throw `validation_failed`; the message says
 * the old time was logged, and `details.logged` holds it. `confirm` and `signal` are as in
 * `stopAndLog`, and apply to the old timer.
 */
export async function switchAndLog(
  http: HttpClient,
  issue: { key: string; issueType: { name: string } },
  options: TimerOptions & LogOptions & { expectRunning?: string } = {},
): Promise<StartResult & { logged: { draft: WorklogDraft; worklog: Worklog } | null }> {
  const key = parseInput(issueKey, issue.key, 'start the timer')
  assertTimeable({ key, issueType: issue.issueType })
  const log = checkLog(options)
  options.signal?.throwIfAborted()
  const stopped = await takeTimer(options, {
    keep: key,
    expectRunning: log.expectRunning,
    confirmed: isConfirmed(options),
  })
  const logged = stopped === null ? null : await logOrRestore(http, stopped, log, options)
  try {
    const { timer } = await startTimer(issue, options)
    return { timer, stopped: logged?.draft ?? null, logged }
  } catch (cause) {
    if (logged === null || !(cause instanceof JiraMgrError)) throw cause
    throw new JiraMgrError(
      cause.code,
      `The ${logged.draft.issueKey} time (${logged.draft.timeSpent}) was logged, but ${key} did not start: ${cause.message}`,
      { details: { ...(cause.details as object | undefined), logged }, cause },
    )
  }
}
