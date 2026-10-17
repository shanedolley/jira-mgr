import { ROW_PROPERTIES } from '@jira-mgr/core/display'
import { describe, expect, it } from 'vitest'

import { extrasWidth, fittingCount } from './propertyFit'

const none = {
  blocked: false,
  blocking: false,
  differs: false,
  timer: false,
  progress: false,
}

describe('fittingCount', () => {
  it('shows every property in a wide Tree and none in a bare one', () => {
    expect(fittingCount(ROW_PROPERTIES, 2000, 4, extrasWidth(none))).toBe(ROW_PROPERTIES.length)
    expect(fittingCount(ROW_PROPERTIES, 300, 1, 0)).toBe(0)
  })

  it('drops the trailing properties first, one at a time as the Tree narrows', () => {
    const widths = [1000, 900, 800, 700, 600, 500]
    const counts = widths.map((w) => fittingCount(ROW_PROPERTIES, w, 1, 0))
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(new Set(counts).size).toBeGreaterThan(3)
  })

  it('leaves less room for a deeper level and for wider extras', () => {
    const widths = Array.from({ length: 100 }, (_, i) => 400 + i * 8)
    const wide = extrasWidth({ ...none, differs: true, progress: true })
    for (const w of widths) {
      const open = fittingCount(ROW_PROPERTIES, w, 1, 0)
      expect(fittingCount(ROW_PROPERTIES, w, 4, 0)).toBeLessThanOrEqual(open)
      expect(fittingCount(ROW_PROPERTIES, w, 1, wide)).toBeLessThanOrEqual(open)
    }
    expect(
      widths.some(
        (w) => fittingCount(ROW_PROPERTIES, w, 4, 0) < fittingCount(ROW_PROPERTIES, w, 1, 0),
      ),
    ).toBe(true)
    expect(
      widths.some(
        (w) => fittingCount(ROW_PROPERTIES, w, 1, wide) < fittingCount(ROW_PROPERTIES, w, 1, 0),
      ),
    ).toBe(true)
  })

  it('counts from the first property, so a short list is never cut for a long one', () => {
    expect(fittingCount(['updated'], 700, 4, extrasWidth({ ...none, blocked: true }))).toBe(1)
  })
})

describe('extrasWidth', () => {
  it('is nothing for a row with no extras and grows with each', () => {
    expect(extrasWidth(none)).toBe(0)
    expect(extrasWidth({ ...none, blocked: true })).toBeGreaterThan(0)
    expect(extrasWidth({ ...none, blocked: true, blocking: true })).toBeGreaterThan(
      extrasWidth({ ...none, blocked: true }),
    )
  })
})
