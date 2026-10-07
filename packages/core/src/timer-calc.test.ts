import { describe, expect, it } from 'vitest'

import { JiraMgrError } from './errors.js'
import type { TimerSettings } from './timer-calc.js'
import { assertTimeable, elapsedMs, reminderDue, roundMinutes, worklogDraft } from './timer-calc.js'

/** A local-time instant, so midnight checks do not depend on the machine's zone. */
const at = (h: number, m = 0, s = 0, day = 7) => new Date(2026, 9, day, h, m, s)
const iso = (d: Date) => d.toISOString()
const MIN = 60_000

const settings: TimerSettings = {
  rounding: '5m',
  reminderThresholdHours: 8,
  reminderIntervalMinutes: 60,
}

/** One closed segment of `minutes` starting at 09:00. */
const ran = (minutes: number) => ({
  issueKey: 'PSAPAC-1',
  segments: [{ start: iso(at(9)), end: iso(new Date(at(9).getTime() + minutes * MIN)) }],
})

describe('roundMinutes', () => {
  it.each([
    // [minutes, none, 5m, 15m]
    [0, 1, 5, 15],
    [0.4, 1, 5, 15],
    [0.5, 1, 5, 15],
    [1, 1, 5, 15],
    [2, 2, 5, 15],
    [2.5, 3, 5, 15],
    [2.4, 2, 5, 15],
    [7, 7, 5, 15],
    [7.5, 8, 10, 15],
    [8, 8, 10, 15],
    [12, 12, 10, 15],
    [12.5, 13, 15, 15],
    [22, 22, 20, 15],
    [22.5, 23, 25, 30],
    [23, 23, 25, 30],
    [60, 60, 60, 60],
  ])('%s min rounds to %s (none), %s (5m), %s (15m)', (minutes, none, five, fifteen) => {
    const ms = minutes * MIN
    expect(roundMinutes(ms, 'none')).toBe(none)
    expect(roundMinutes(ms, '5m')).toBe(five)
    expect(roundMinutes(ms, '15m')).toBe(fifteen)
  })
})

describe('worklogDraft', () => {
  it('rounds the total and formats a Jira duration', () => {
    expect(worklogDraft(ran(7), settings, at(18))).toMatchObject({
      issueKey: 'PSAPAC-1',
      started: iso(at(9)),
      seconds: 300,
      timeSpent: '5m',
    })
    expect(worklogDraft(ran(65), { ...settings, rounding: 'none' }, at(18))).toMatchObject({
      seconds: 3900,
      timeSpent: '1h 5m',
    })
    expect(worklogDraft(ran(120), settings, at(18)).timeSpent).toBe('2h')
  })

  it('excludes paused time and starts at the first segment', () => {
    const timer = {
      issueKey: 'PSAPAC-1',
      segments: [
        { start: iso(at(9)), end: iso(at(9, 30)) },
        { start: iso(at(11)), end: iso(at(11, 15)) },
        { start: iso(at(13)), end: null },
      ],
    }
    expect(elapsedMs(timer, at(13, 10))).toBe(55 * MIN)
    expect(worklogDraft(timer, settings, at(13, 10))).toMatchObject({
      started: iso(at(9)),
      seconds: 55 * 60,
      timeSpent: '55m',
    })
  })

  it('flags a total past the threshold, and not one exactly at it', () => {
    expect(worklogDraft(ran(8 * 60), settings, at(23)).needsConfirmation).toBe(false)
    expect(worklogDraft(ran(8 * 60 + 1), settings, at(23)).needsConfirmation).toBe(true)
    expect(
      worklogDraft(ran(3 * 60), { ...settings, reminderThresholdHours: 2 }, at(23))
        .needsConfirmation,
    ).toBe(true)
  })

  it('flags a stop on a later local date than the first start', () => {
    const across = {
      issueKey: 'PSAPAC-1',
      segments: [{ start: iso(at(23, 50)), end: iso(at(0, 10, 0, 8)) }],
    }
    expect(worklogDraft(across, settings, at(1, 0, 0, 8)).needsConfirmation).toBe(true)
    // A running segment reaches the next date at `now`.
    const open = { issueKey: 'PSAPAC-1', segments: [{ start: iso(at(23, 50)), end: null }] }
    expect(worklogDraft(open, settings, at(23, 59)).needsConfirmation).toBe(false)
    expect(worklogDraft(open, settings, at(0, 10, 0, 8)).needsConfirmation).toBe(true)
  })

  it('flags a stop exactly at midnight, since that instant is the next date', () => {
    const open = { issueKey: 'PSAPAC-1', segments: [{ start: iso(at(23)), end: null }] }
    expect(worklogDraft(open, settings, at(23, 59, 59)).needsConfirmation).toBe(false)
    expect(worklogDraft(open, settings, at(0, 0, 0, 8)).needsConfirmation).toBe(true)
  })

  it('flags a pause that spans midnight, though no segment does', () => {
    const paused = {
      issueKey: 'PSAPAC-1',
      segments: [
        { start: iso(at(22)), end: iso(at(23)) },
        { start: iso(at(8, 0, 0, 8)), end: iso(at(9, 0, 0, 8)) },
      ],
    }
    expect(worklogDraft(paused, settings, at(10, 0, 0, 8)).needsConfirmation).toBe(true)
    const sameDay = {
      issueKey: 'PSAPAC-1',
      segments: [
        { start: iso(at(9)), end: iso(at(10)) },
        { start: iso(at(20)), end: iso(at(21)) },
      ],
    }
    expect(worklogDraft(sameDay, settings, at(23, 59)).needsConfirmation).toBe(false)
  })
})

describe('reminderDue', () => {
  const start = at(0, 5)
  const timer = { issueKey: 'PSAPAC-1', segments: [{ start: iso(start), end: null }] }
  const after = (minutes: number) => new Date(start.getTime() + minutes * MIN)
  const threshold = 8 * 60

  it('is quiet until the threshold passes', () => {
    expect(reminderDue(timer, settings, after(threshold - 1), null)).toBe(false)
    expect(reminderDue(timer, settings, after(threshold), null)).toBe(false)
  })

  it('fires once past the threshold, then every interval', () => {
    expect(reminderDue(timer, settings, after(threshold + 1), null)).toBe(true)
    const first = after(threshold + 1)
    expect(reminderDue(timer, settings, after(threshold + 30), first)).toBe(false)
    expect(reminderDue(timer, settings, after(threshold + 60), first)).toBe(false)
    expect(reminderDue(timer, settings, after(threshold + 61), first)).toBe(true)
  })

  it('treats a notice from before the threshold as not yet reminded', () => {
    // Only 6 minutes since that notice, so the interval alone would say no.
    expect(reminderDue(timer, settings, after(threshold + 1), after(threshold - 5))).toBe(true)
  })

  it('honours a custom threshold and interval', () => {
    const custom = { ...settings, reminderThresholdHours: 1, reminderIntervalMinutes: 15 }
    expect(reminderDue(timer, custom, after(61), null)).toBe(true)
    expect(reminderDue(timer, custom, after(75), after(61))).toBe(false)
    expect(reminderDue(timer, custom, after(76), after(61))).toBe(true)
  })

  it('never fires for a paused or absent timer', () => {
    const paused = { issueKey: 'PSAPAC-1', segments: [{ start: iso(start), end: iso(after(600)) }] }
    expect(reminderDue(paused, settings, after(900), null)).toBe(false)
    expect(reminderDue(null, settings, after(900), null)).toBe(false)
  })

  it('counts running time only, so paused time delays the threshold', () => {
    const pausedEarlier = {
      issueKey: 'PSAPAC-1',
      segments: [
        { start: iso(start), end: iso(after(60)) },
        { start: iso(after(300)), end: null },
      ],
    }
    // 60 min before the pause, so 8h of running time arrives at minute 300 + 420.
    expect(reminderDue(pausedEarlier, settings, after(300 + 420), null)).toBe(false)
    expect(reminderDue(pausedEarlier, settings, after(300 + 421), null)).toBe(true)
  })
})

describe('assertTimeable', () => {
  it.each(['Task', 'Bug', 'Story', 'Subtask'])('accepts a %s', (name) => {
    expect(() => {
      assertTimeable({ key: 'PSAPAC-1', issueType: { name } })
    }).not.toThrow()
  })

  it.each(['Epic', 'Initiative'])('refuses a %s with validation_failed', (name) => {
    let error: unknown
    try {
      assertTimeable({ key: 'PSAPAC-1', issueType: { name } })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(JiraMgrError)
    expect(error).toMatchObject({ code: 'validation_failed' })
  })
})
