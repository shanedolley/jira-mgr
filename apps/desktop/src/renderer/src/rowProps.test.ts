import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { dueTone, rowSprint, shortDate } from './rowProps'

const sprints = (...list: Issue['sprints']) => ({ sprints: list }) as Issue

describe('shortDate', () => {
  it('names the month and day, and adds the year only for another year', () => {
    expect(shortDate('2026-10-04', '2026-10-11')).toBe('Oct 4')
    expect(shortDate('2025-12-31', '2026-10-11')).toBe("Dec 31 '25")
  })

  it('reads a Jira timestamp as the local day', () => {
    const local = new Date(2026, 2, 9, 23, 30)
    expect(shortDate(local.toISOString(), '2026-10-11')).toBe('Mar 9')
  })
})

describe('dueTone', () => {
  const today = '2026-10-11'

  it('is overdue on the day and after it', () => {
    expect(dueTone('2026-10-11', today, false)).toBe('overdue')
    expect(dueTone('2020-01-02', today, false)).toBe('overdue')
  })

  it('is soon for the next seven days and later after that', () => {
    expect(dueTone('2026-10-12', today, false)).toBe('soon')
    expect(dueTone('2026-10-18', today, false)).toBe('soon')
    expect(dueTone('2026-10-19', today, false)).toBe('later')
    expect(dueTone('2999-12-31', today, false)).toBe('later')
  })

  it('counts days across a month and a year end', () => {
    expect(dueTone('2027-01-03', '2026-12-28', false)).toBe('soon')
    expect(dueTone('2027-01-05', '2026-12-28', false)).toBe('later')
  })

  it('is never urgent for a Done issue', () => {
    expect(dueTone('2020-01-02', today, true)).toBe('later')
  })
})

describe('rowSprint', () => {
  const closed = { id: 3, name: 'S3', state: 'closed' }
  const future = { id: 7, name: 'S7', state: 'future' }
  const active = { id: 5, name: 'S5', state: 'active' }

  it('prefers the active sprint, then the newest', () => {
    expect(rowSprint(sprints(closed, active, future))).toEqual(active)
    expect(rowSprint(sprints(closed, future))).toEqual(future)
    expect(rowSprint(sprints())).toBeUndefined()
  })
})
