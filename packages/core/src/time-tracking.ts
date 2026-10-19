import { z } from 'zod'

import { MONTHS } from './display.js'

/**
 * The part of `GET /rest/api/3/configuration` that sets a working day. `null` when the site has
 * time tracking off or sends no configuration, so a client hides its time block instead of
 * guessing an 8-hour day.
 */
export const timeTrackingConfig = z
  .object({
    timeTrackingEnabled: z.boolean(),
    timeTrackingConfiguration: z
      .object({
        workingHoursPerDay: z.number().positive(),
        workingDaysPerWeek: z.number().positive(),
      })
      .optional(),
  })
  .transform((config) =>
    config.timeTrackingEnabled ? (config.timeTrackingConfiguration ?? null) : null,
  )

export type TimeTrackingSettings = NonNullable<z.output<typeof timeTrackingConfig>>

const HOUR = 3600

/** A count to one decimal with a trailing ".0" dropped, and its unit in the plural unless it is 1. */
function counted(value: number, unit: string): string {
  const rounded = Number(value.toFixed(1))
  return `${String(rounded)} ${unit}${rounded === 1 ? '' : 's'}`
}

/** Seconds as hours to one decimal: "2.5 hours", "1 hour", "0 hours". */
export function formatHours(seconds: number): string {
  return counted(seconds / HOUR, 'hour')
}

/**
 * Seconds as a duration for a reader. Under an hour it counts minutes ("30 minutes"), under a
 * working day hours to one decimal ("2.5 hours"), and from a working day up days to one decimal
 * ("1.5 days"), a day being `workingHoursPerDay` hours.
 */
export function formatDuration(seconds: number, workingHoursPerDay: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Number((seconds / HOUR).toFixed(1))
  if (hours < workingHoursPerDay) return counted(seconds / HOUR, 'hour')
  return counted(seconds / (workingHoursPerDay * HOUR), 'day')
}

/** Logged over estimated, as a whole percent. `null` without an estimate. It can pass 100. */
export function percentUsed(logged: number, estimate: number | null): number | null {
  return estimate === null || estimate <= 0 ? null : Math.round((logged / estimate) * 100)
}

/** What is left of the estimate, as a whole percent: 100 minus the percent used, never below 0. `null` without an estimate. */
export function percentRemaining(logged: number, estimate: number | null): number | null {
  const used = percentUsed(logged, estimate)
  return used === null ? null : Math.max(0, 100 - used)
}

export type ChartPeriod = 'days' | 'weeks' | 'months'

/** How many bars each period shows: the last 14 days, 12 weeks and 12 months. */
export const CHART_BARS: Record<ChartPeriod, number> = { days: 14, weeks: 12, months: 12 }

export interface ChartBar {
  /** The first local day of the period, `YYYY-MM-DD`. */
  start: string
  /** The period in words: "Mon 5 Oct", "Week of 5 Oct", "Oct 2026". */
  label: string
  seconds: number
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The first local midnight of the day, Monday-based week or month `date` falls in. */
function startOf(date: Date, period: ChartPeriod): Date {
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()
  if (period === 'months') return new Date(y, m, 1)
  return new Date(y, m, period === 'days' ? d : d - ((date.getDay() + 6) % 7))
}

/** The start of the period `n` periods from `start`. Built from calendar fields, so a DST change cannot shift it. */
function shift(start: Date, period: ChartPeriod, n: number): Date {
  const y = start.getFullYear()
  const m = start.getMonth()
  const d = start.getDate()
  if (period === 'months') return new Date(y, m + n, 1)
  return new Date(y, m, d + (period === 'days' ? n : 7 * n))
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) =>
  `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function labelOf(start: Date, period: ChartPeriod): string {
  const day = `${String(start.getDate())} ${MONTHS[start.getMonth()] ?? ''}`
  if (period === 'days') return `${DAYS[start.getDay()] ?? ''} ${day}`
  if (period === 'weeks') return `Week of ${day}`
  return `${MONTHS[start.getMonth()] ?? ''} ${String(start.getFullYear())}`
}

/**
 * Sums worklogs into one bar per period, oldest first, ending with the period `now` is in. Every
 * period is in the machine's local time, a week starts on Monday, and an empty period is a bar of
 * zero. A worklog outside the window counts for nothing.
 */
export function bucketWorklogs(
  worklogs: readonly { started: string; timeSpentSeconds: number }[],
  period: ChartPeriod,
  now: Date,
): ChartBar[] {
  const count = CHART_BARS[period]
  const last = startOf(now, period)
  const bars = Array.from({ length: count }, (_, i) => {
    const start = shift(last, period, i - (count - 1))
    return { start: localDate(start), label: labelOf(start, period), seconds: 0 }
  })
  const byStart = new Map(bars.map((bar) => [bar.start, bar]))
  for (const worklog of worklogs) {
    const bar = byStart.get(localDate(startOf(new Date(worklog.started), period)))
    if (bar !== undefined) bar.seconds += worklog.timeSpentSeconds
  }
  return bars
}

/** The text alternative of a bar: its period and its hours. */
export const barText = (bar: ChartBar): string => `${bar.label}: ${formatHours(bar.seconds)}`
