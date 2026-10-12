import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  barText,
  bucketWorklogs,
  formatDuration,
  formatHours,
  percentUsed,
  timeTrackingConfig,
} from './time-tracking.js'

const HOUR = 3600
const DAY = 8 * HOUR

describe('formatDuration', () => {
  it.each([
    [0, '0 minutes'],
    [60, '1 minute'],
    [30 * 60, '30 minutes'],
    [59 * 60, '59 minutes'],
    [HOUR, '1 hour'],
    [2.5 * HOUR, '2.5 hours'],
    [90 * 60, '1.5 hours'],
    [7.5 * HOUR, '7.5 hours'],
    [DAY, '1 day'],
    [1.5 * DAY, '1.5 days'],
    [12 * HOUR, '1.5 days'],
    [3 * DAY, '3 days'],
  ])('writes %d seconds on an 8-hour day as %s', (seconds, text) => {
    expect(formatDuration(seconds, 8)).toBe(text)
  })

  it('moves to the next unit when rounding reaches it', () => {
    expect(formatDuration(59 * 60 + 40, 8)).toBe('1 hour')
    expect(formatDuration(7.97 * HOUR, 8)).toBe('1 day')
  })

  it('counts a day as the site working hours', () => {
    expect(formatDuration(12 * HOUR, 6)).toBe('2 days')
    expect(formatDuration(5 * HOUR, 6)).toBe('5 hours')
    expect(formatDuration(24 * HOUR, 24)).toBe('1 day')
  })
})

describe('formatHours', () => {
  it('writes hours to one decimal', () => {
    expect(formatHours(0)).toBe('0 hours')
    expect(formatHours(HOUR)).toBe('1 hour')
    expect(formatHours(2.5 * HOUR)).toBe('2.5 hours')
    expect(formatHours(30 * HOUR)).toBe('30 hours')
  })
})

describe('percentUsed', () => {
  it('rounds to a whole percent and passes 100', () => {
    expect(percentUsed(12 * HOUR, 24 * HOUR)).toBe(50)
    expect(percentUsed(30 * HOUR, 24 * HOUR)).toBe(125)
    expect(percentUsed(HOUR, 3 * HOUR)).toBe(33)
    expect(percentUsed(0, 3 * HOUR)).toBe(0)
  })

  it('has no percentage without an estimate', () => {
    expect(percentUsed(HOUR, null)).toBeNull()
    expect(percentUsed(HOUR, 0)).toBeNull()
  })
})

describe('timeTrackingConfig', () => {
  const on = { workingHoursPerDay: 8, workingDaysPerWeek: 5, timeFormat: 'pretty' }

  it('keeps the working day and week', () => {
    expect(
      timeTrackingConfig.parse({ timeTrackingEnabled: true, timeTrackingConfiguration: on }),
    ).toEqual({ workingHoursPerDay: 8, workingDaysPerWeek: 5 })
  })

  it('is null when time tracking is off or the configuration is missing', () => {
    expect(
      timeTrackingConfig.parse({ timeTrackingEnabled: false, timeTrackingConfiguration: on }),
    ).toBeNull()
    expect(timeTrackingConfig.parse({ timeTrackingEnabled: true })).toBeNull()
  })

  it('refuses a configuration without a usable day', () => {
    const bad = { ...on, workingHoursPerDay: 0 }
    expect(
      timeTrackingConfig.safeParse({ timeTrackingEnabled: true, timeTrackingConfiguration: bad })
        .success,
    ).toBe(false)
  })
})

// A zone behind UTC, so a Sunday night here is already Monday in UTC. A bucket cut in UTC fails.
describe('bucketWorklogs', () => {
  let zone: string | undefined
  beforeAll(() => {
    zone = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
  })
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  })

  // Tuesday 13 October 2026, local noon.
  const now = () => new Date(2026, 9, 13, 12)
  const log = (date: Date, hours: number) => ({
    started: date.toISOString(),
    timeSpentSeconds: hours * HOUR,
  })
  const hours = (bars: { seconds: number }[]) => bars.map((bar) => bar.seconds / HOUR)

  it('runs in the pinned zone', () => {
    expect(new Date(2026, 9, 11, 23, 30).getUTCDate()).toBe(12)
  })

  it('shows the last 14 days, oldest first, with empty days as zero', () => {
    const bars = bucketWorklogs([log(new Date(2026, 9, 13, 9), 2)], 'days', now())
    expect(bars).toHaveLength(14)
    expect(bars[0]).toMatchObject({ start: '2026-09-30', label: 'Wed 30 Sep' })
    expect(bars[13]).toMatchObject({ start: '2026-10-13', label: 'Tue 13 Oct', seconds: 2 * HOUR })
    expect(hours(bars).reduce((a, b) => a + b)).toBe(2)
  })

  it('puts a worklog that starts on Sunday night local time on Sunday', () => {
    const sunday = log(new Date(2026, 9, 11, 23, 30), 1.5)
    const days = bucketWorklogs([sunday], 'days', now())
    expect(days.find((bar) => bar.seconds > 0)).toMatchObject({ start: '2026-10-11' })
    const weeks = bucketWorklogs([sunday], 'weeks', now())
    // The week that began Monday 5 October, not the one that began on the 12th.
    expect(weeks.find((bar) => bar.seconds > 0)).toMatchObject({
      start: '2026-10-05',
      label: 'Week of 5 Oct',
    })
    expect(weeks[11]).toMatchObject({ start: '2026-10-12', seconds: 0 })
  })

  it('starts a week on Monday and shows the last 12', () => {
    const monday = log(new Date(2026, 9, 12, 0, 5), 1)
    const bars = bucketWorklogs([monday], 'weeks', now())
    expect(bars).toHaveLength(12)
    expect(bars[0]).toMatchObject({ start: '2026-07-27' })
    expect(bars[11]).toMatchObject({ start: '2026-10-12', seconds: HOUR })
  })

  it('shows the last 12 months and sums a month', () => {
    const bars = bucketWorklogs(
      [log(new Date(2026, 9, 1, 0, 30), 1), log(new Date(2026, 9, 31, 23, 30), 2)],
      'months',
      now(),
    )
    expect(bars).toHaveLength(12)
    expect(bars[0]).toMatchObject({ start: '2025-11-01', label: 'Nov 2025' })
    expect(bars[11]).toMatchObject({ start: '2026-10-01', label: 'Oct 2026', seconds: 3 * HOUR })
  })

  it('leaves out a worklog outside the window', () => {
    const old = log(new Date(2026, 8, 29, 12), 5)
    const future = log(new Date(2026, 9, 14, 12), 5)
    expect(hours(bucketWorklogs([old, future], 'days', now())).every((h) => h === 0)).toBe(true)
  })

  it('keeps 14 distinct days across the autumn clock change', () => {
    // Clocks go back on 1 November 2026, a 25-hour day.
    const bars = bucketWorklogs(
      [log(new Date(2026, 10, 1, 23, 30), 1)],
      'days',
      new Date(2026, 10, 3),
    )
    expect(new Set(bars.map((bar) => bar.start)).size).toBe(14)
    expect(bars.find((bar) => bar.seconds > 0)).toMatchObject({ start: '2026-11-01' })
  })

  it('gives each bar a text alternative with its period and hours', () => {
    const [bar] = bucketWorklogs([], 'days', now())
    expect(bar && barText(bar)).toBe('Wed 30 Sep: 0 hours')
    const logged = bucketWorklogs([log(new Date(2026, 9, 13, 9), 2.5)], 'days', now())
    expect(logged[13] && barText(logged[13])).toBe('Tue 13 Oct: 2.5 hours')
  })
})
