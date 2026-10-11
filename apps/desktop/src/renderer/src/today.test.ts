import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { watchDay } from './today'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('watchDay', () => {
  it('fires at local midnight, and again at the next one', () => {
    vi.setSystemTime(new Date(2026, 9, 11, 23, 59, 30))
    const changed = vi.fn()
    const stop = watchDay(changed)

    vi.advanceTimersByTime(29_000)
    expect(changed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_500)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(new Date().getDate()).toBe(12)

    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(changed).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stops when told to', () => {
    vi.setSystemTime(new Date(2026, 9, 11, 23, 59, 30))
    const changed = vi.fn()
    watchDay(changed)()
    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000)
    expect(changed).not.toHaveBeenCalled()
  })
})
