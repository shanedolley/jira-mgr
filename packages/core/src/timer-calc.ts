import { JiraMgrError } from './errors.js'
import type { Issue } from './issue.js'
import type { Settings, TimerState } from './state.js'

/** The pure timer rules. Nothing here touches `node:`, so the renderer imports it too. */

export type RunningTimer = NonNullable<TimerState>
export type TimerSettings = Settings['timer']

/** What a stopped timer wants logged. Log it with `addWorklog`, or drop it to discard the time. */
export interface WorklogDraft {
  issueKey: string
  /** Start of the first segment, a UTC ISO string. */
  started: string
  /** The rounded time, `timeSpent` in seconds. */
  seconds: number
  /** The rounded time as a Jira duration such as `1h 5m`. */
  timeSpent: string
  /**
   * The total passed the reminder threshold, or the first start and the stop fall on different
   * local dates (Q55): one worklog dated day 1 would hold day 2's work. Pauses do not matter.
   */
  needsConfirmation: boolean
}

/** Q56: Epics, and any other type, have no timer. */
const TIMEABLE_TYPES = ['Task', 'Bug', 'Story', 'Subtask']

export function assertTimeable(issue: Pick<Issue, 'key'> & { issueType: { name: string } }): void {
  if (!TIMEABLE_TYPES.includes(issue.issueType.name)) {
    throw new JiraMgrError(
      'validation_failed',
      `${issue.key} is a ${issue.issueType.name}. Only Task, Bug, Story and Subtask can be timed.`,
    )
  }
}

const STEP_MINUTES = { none: 1, '5m': 5, '15m': 15 } as const

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

function spans(timer: RunningTimer, now: Date) {
  return timer.segments.map((s) => ({
    start: Date.parse(s.start),
    end: s.end === null ? now.getTime() : Date.parse(s.end),
  }))
}

/** Running time in milliseconds, paused time excluded. An open segment runs to `now`. */
export function elapsedMs(timer: RunningTimer, now: Date): number {
  return spans(timer, now).reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0)
}

/**
 * Rounds to the nearest step, halves up, with one step as the minimum (Q58). `none` rounds to
 * whole minutes, Jira's unit, with a one-minute minimum.
 */
export function roundMinutes(ms: number, rounding: TimerSettings['rounding']): number {
  const step = STEP_MINUTES[rounding]
  const stepMs = step * MINUTE_MS
  return Math.max(1, Math.floor((ms + stepMs / 2) / stepMs)) * step
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h > 0 && `${String(h)}h`, m > 0 && `${String(m)}m`].filter(Boolean).join(' ')
}

/** True when the two instants fall on different dates in the machine's local time. */
function differentLocalDates(start: number, end: number): boolean {
  const midnight = new Date(start)
  midnight.setHours(24, 0, 0, 0)
  return midnight.getTime() <= end
}

export function worklogDraft(
  timer: RunningTimer,
  settings: TimerSettings,
  now: Date,
): WorklogDraft {
  const ms = elapsedMs(timer, now)
  const minutes = roundMinutes(ms, settings.rounding)
  const started = timer.segments[0]?.start ?? now.toISOString()
  return {
    issueKey: timer.issueKey,
    started,
    seconds: minutes * 60,
    timeSpent: formatDuration(minutes),
    needsConfirmation:
      ms > settings.reminderThresholdHours * HOUR_MS ||
      differentLocalDates(Date.parse(started), now.getTime()),
  }
}

/**
 * Whether the app should notify now (Q55): once when the running time passes the threshold, then
 * every `reminderIntervalMinutes`. `lastReminderAt` is the last notice for this timer, or `null`.
 * A paused or absent timer never notifies.
 */
export function reminderDue(
  timer: TimerState,
  settings: TimerSettings,
  now: Date,
  lastReminderAt: Date | null,
): boolean {
  if (timer === null || timer.segments.at(-1)?.end !== null) return false
  const over = elapsedMs(timer, now) - settings.reminderThresholdHours * HOUR_MS
  if (over <= 0) return false
  // The timer runs, so the threshold passed `over` ms ago.
  const crossedAt = now.getTime() - over
  if (lastReminderAt === null || lastReminderAt.getTime() < crossedAt) return true
  return now.getTime() - lastReminderAt.getTime() >= settings.reminderIntervalMinutes * MINUTE_MS
}
