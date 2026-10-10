import { describe, expect, it } from 'vitest'

import { formatClock, isPaused, pressOf } from './timer'

const running = {
  issueKey: 'PSAPAC-12',
  segments: [{ start: '2026-10-10T01:00:00.000Z', end: null }],
}
const paused = {
  issueKey: 'PSAPAC-12',
  segments: [{ start: '2026-10-10T01:00:00.000Z', end: '2026-10-10T01:10:00.000Z' }],
}

describe('pressOf', () => {
  it('starts when no timer runs', () => {
    expect(pressOf(null, 'PSAPAC-12')).toBe('start')
  })

  it('stops the timer that runs on the issue, paused or not', () => {
    expect(pressOf(running, 'PSAPAC-12')).toBe('stop')
    expect(pressOf(paused, 'PSAPAC-12')).toBe('stop')
  })

  it('switches when the timer runs on another issue', () => {
    expect(pressOf(running, 'PSAPAC-13')).toBe('switch')
  })
})

describe('isPaused', () => {
  it('is true when the last segment is closed', () => {
    expect(isPaused(running)).toBe(false)
    expect(isPaused(paused)).toBe(true)
  })
})

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [5_000, '0:05'],
    [65_000, '1:05'],
    [59 * 60_000 + 59_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_600_000 * 10 + 61_000, '10:01:01'],
    [-5_000, '0:00'],
  ])('writes %i ms as %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text)
  })
})
