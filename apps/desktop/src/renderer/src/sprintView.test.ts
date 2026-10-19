import type { Issue } from '@jira-mgr/core'
import { formatDate } from '@jira-mgr/core/display'
import { describe, expect, it } from 'vitest'

import type { SprintOption } from '../../shared/ipc'
import { formatDay, groupByStatus, percentOf, shareText, sidebarSprints } from './sprintView'

const sprint = (
  id: number,
  state: SprintOption['state'],
  startDate: string | null = null,
): SprintOption => ({ id, name: `Sprint ${String(id)}`, state, startDate, endDate: null })

describe('sidebarSprints', () => {
  it('opens the active sprint as Current and the earliest dated future sprint as Upcoming', () => {
    const { current, upcoming } = sidebarSprints([
      sprint(9, 'future', '2026-11-01T00:00:00.000Z'),
      sprint(7, 'future'),
      sprint(8, 'future', '2026-10-15T00:00:00.000Z'),
      sprint(5, 'active', '2026-10-01T00:00:00.000Z'),
      sprint(4, 'closed', '2026-09-01T00:00:00.000Z'),
    ])
    expect(current?.id).toBe(5)
    expect(upcoming?.id).toBe(8)
  })

  it('has no Upcoming for an undated template or a closed sprint, and no Current without an active one', () => {
    const { current, upcoming } = sidebarSprints([sprint(7, 'future'), sprint(4, 'closed')])
    expect(current).toBeNull()
    expect(upcoming).toBeNull()
  })
})

describe('formatDay', () => {
  it('shows a sprint date as a short local day', () => {
    const local = new Date(2026, 9, 5, 23, 30)
    expect(formatDay(local.toISOString())).toBe(formatDate(local.toISOString()))
    expect(formatDay(new Date(2020, 9, 5, 12).toISOString())).toBe("5 Oct '20")
  })

  it('says Not set for an undated sprint', () => {
    expect(formatDay(null)).toBe('Not set')
  })
})

describe('groupByStatus', () => {
  const issue = (key: string, name: string, category: Issue['status']['category']) =>
    ({ key, status: { id: name, name, category } }) as Issue

  it('orders the groups as the Tree does and the issues by key number', () => {
    const groups = groupByStatus([
      issue('PSAPAC-10', 'Done', 'done'),
      issue('PSAPAC-9', 'To Do', 'new'),
      issue('PSAPAC-2', 'Done', 'done'),
      issue('PSAPAC-3', 'In Progress', 'indeterminate'),
      issue('PSAPAC-1', 'Odd status', 'indeterminate'),
    ])
    expect(groups.map((g) => [g.status.name, g.issues.map((i) => i.key)])).toEqual([
      ['To Do', ['PSAPAC-9']],
      ['In Progress', ['PSAPAC-3']],
      ['Done', ['PSAPAC-2', 'PSAPAC-10']],
      ['Odd status', ['PSAPAC-1']],
    ])
  })

  it('has no groups for an empty sprint', () => {
    expect(groupByStatus([])).toEqual([])
  })
})

describe('shares', () => {
  it('writes a breakdown row as "N% of M"', () => {
    expect(shareText({ id: 'a', name: 'Ann', total: 3, completed: 1, percent: 33 })).toBe(
      '33% of 3',
    )
  })

  it('rounds a share to a whole percent and reads an empty sprint as 0', () => {
    expect(percentOf(1, 7)).toBe(14)
    expect(percentOf(2, 3)).toBe(67)
    expect(percentOf(0, 0)).toBe(0)
  })
})
