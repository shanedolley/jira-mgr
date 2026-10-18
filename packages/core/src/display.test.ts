import { describe, expect, it } from 'vitest'

import {
  WIDTH_MAX,
  keepKnownWidths,
  sprintDates,
  sprintEnd,
  sprintLabel,
  sprintTitle,
} from './display.js'

const today = '2026-10-17'

describe('sprintEnd', () => {
  it('shows the end day, with the year when it differs from today', () => {
    expect(sprintEnd({ name: 'Sprint 36', endDate: '2026-10-14T14:00:00Z' }, today)).toBe('14 Oct')
    expect(sprintEnd({ name: 'Sprint 36', endDate: '2025-12-02' }, today)).toBe("2 Dec '25")
  })

  it('is null without a usable end date', () => {
    expect(sprintEnd({ name: 'Sprint 36' }, today)).toBeNull()
    expect(sprintEnd({ name: 'Sprint 36', endDate: '2026-13-01' }, today)).toBeNull()
  })
})

describe('sprintLabel', () => {
  it('shows the number alone, whatever the dates', () => {
    expect(sprintLabel({ name: 'Sprint 36', endDate: '2026-10-14' })).toBe('S 36')
    expect(sprintLabel({ name: 'Sprint 5', startDate: '2026-10-01', endDate: '2026-10-04' })).toBe(
      'S 5',
    )
    expect(sprintLabel({ name: 'Sprint 6' })).toBe('S 6')
  })

  it('takes the last number in the name', () => {
    expect(sprintLabel({ name: 'PSAPAC 2026 Sprint 36', endDate: '2026-10-14' })).toBe('S 36')
  })

  it('ignores the dates in a PSAPAC name', () => {
    expect(sprintLabel({ name: 'PS Sprint 36 (05 Oct-18 Oct)' })).toBe('S 36')
    expect(sprintLabel({ name: 'PS Sprint 41,42(14 Dec-08 Jan)' })).toBe('S 42')
    expect(sprintLabel({ name: 'PS Sprint 09 (21 Sep- 05 Oct)' })).toBe('S 9')
  })

  it('shows the full name without a number', () => {
    expect(sprintLabel({ name: 'PS TEMPLATES', endDate: '2026-10-14' })).toBe('PS TEMPLATES')
  })

  it('leaves the title with the end day, or none for an impossible one', () => {
    expect(sprintTitle({ name: 'Sprint 5', endDate: '2026-13-45' })).toBe('Sprint 5')
  })
})

describe('sprintDates', () => {
  it('lists the start and the end day', () => {
    const live = {
      name: 'PS Sprint 36',
      startDate: '2026-10-05T01:00:00.000Z',
      endDate: '2026-10-18T14:00:00.000Z',
    }
    expect(sprintDates(live, today)).toBe('5 Oct - 18 Oct')
  })

  it('adds the year to a day outside the year of today', () => {
    expect(sprintDates({ name: 'S', startDate: '2026-12-28', endDate: '2027-01-06' }, today)).toBe(
      "28 Dec - 6 Jan '27",
    )
  })

  it('shows the end alone without a usable start, and null without a usable end', () => {
    expect(sprintDates({ name: 'S', endDate: '2026-10-14' }, today)).toBe('14 Oct')
    expect(sprintDates({ name: 'S', startDate: 'soon', endDate: '2026-10-14' }, today)).toBe(
      '14 Oct',
    )
    expect(sprintDates({ name: 'S', startDate: '2026-10-05' }, today)).toBeNull()
    expect(
      sprintDates({ name: 'S', startDate: '2026-10-05', endDate: '2026-13-01' }, today),
    ).toBeNull()
  })
})

describe('sprintTitle', () => {
  it('keeps the full name and adds the end day', () => {
    expect(sprintTitle({ name: 'Sprint 5', endDate: '2026-10-14' })).toBe(
      'Sprint 5, ends 2026-10-14',
    )
    expect(sprintTitle({ name: 'PS TEMPLATES' })).toBe('PS TEMPLATES')
  })
})

describe('keepKnownWidths', () => {
  const listed = ['labels', 'due'] as const

  it('keeps whole pixel widths of listed properties', () => {
    expect(keepKnownWidths({ labels: 120, due: 1 }, listed)).toEqual({ labels: 120, due: 1 })
    expect(keepKnownWidths({ labels: WIDTH_MAX }, listed)).toEqual({ labels: WIDTH_MAX })
  })

  it('drops an entry it cannot read and keeps the rest', () => {
    const bad = { labels: 120, due: 0, sprint: 90, wat: 40 }
    expect(keepKnownWidths(bad, listed)).toEqual({ labels: 120 })
    for (const value of [0, -1, 1.5, WIDTH_MAX + 1, NaN, Infinity, '96', null, true]) {
      expect(keepKnownWidths({ labels: value }, listed)).toBeUndefined()
    }
  })

  it('drops the widths of a property that is not listed, so a re-added column starts at its default', () => {
    expect(keepKnownWidths({ labels: 120, due: 90 }, ['labels'])).toEqual({ labels: 120 })
    expect(keepKnownWidths({ labels: 120 }, [])).toBeUndefined()
  })

  it.each([
    ['a string', 'wide'],
    ['null', null],
    ['an array', [96]],
    ['a number', 3],
    ['nothing', undefined],
  ])('reads %s as no widths', (_name, value) => {
    expect(keepKnownWidths(value, listed)).toBeUndefined()
  })
})
