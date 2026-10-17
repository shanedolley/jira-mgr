import { describe, expect, it } from 'vitest'

import { sprintLabel, sprintTitle } from './display.js'

const today = '2026-10-17'

describe('sprintLabel', () => {
  it('shows the number and the end day', () => {
    expect(sprintLabel({ name: 'Sprint 36', endDate: '2026-10-14' }, today)).toBe('S 36 (..14 Oct)')
    expect(sprintLabel({ name: 'Sprint 5', endDate: '2026-10-04' }, today)).toBe('S 5 (..4 Oct)')
  })

  it('takes the last number in the name', () => {
    expect(sprintLabel({ name: 'PSAPAC 2026 Sprint 36', endDate: '2026-10-14' }, today)).toBe(
      'S 36 (..14 Oct)',
    )
  })

  it('reads the date part of Jira timestamps, and ignores the dates in a PSAPAC name', () => {
    const live = { name: 'PS Sprint 36 (05 Oct-18 Oct)', endDate: '2026-10-18T14:00:00.000Z' }
    expect(sprintLabel(live, today)).toBe('S 36 (..18 Oct)')
    expect(sprintLabel({ name: 'PS Sprint 41,42(14 Dec-08 Jan)' }, today)).toBe('S 42')
    expect(sprintLabel({ name: 'PS Sprint 09 (21 Sep- 05 Oct)' }, today)).toBe('S 9')
  })

  it('drops the date without an end date', () => {
    expect(sprintLabel({ name: 'Sprint 6' }, today)).toBe('S 6')
    expect(sprintLabel({ name: 'Sprint 6', endDate: null }, today)).toBe('S 6')
    expect(sprintLabel({ name: 'Sprint 6', endDate: 'soon' }, today)).toBe('S 6')
  })

  it('shows the full name without a number', () => {
    expect(sprintLabel({ name: 'PS TEMPLATES', endDate: '2026-10-14' }, today)).toBe('PS TEMPLATES')
  })

  it('adds the year only when the end falls in another year', () => {
    expect(sprintLabel({ name: 'Sprint 30', endDate: '2025-12-31' }, today)).toBe(
      "S 30 (..31 Dec '25)",
    )
    expect(sprintLabel({ name: 'Sprint 40', endDate: '2027-01-06' }, '2026-12-28')).toBe(
      "S 40 (..6 Jan '27)",
    )
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
