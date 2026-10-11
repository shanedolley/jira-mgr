import type { Issue } from '@jira-mgr/core'
import { childProgress } from '@jira-mgr/core/hierarchy'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EPIC_SORT,
  clickSort,
  epicRows,
  sortEpics,
  type EpicColumn,
  type EpicSort,
} from './overview'

interface Spec {
  status?: string
  category?: Issue['status']['category']
  customer?: string
  priority?: string
  assignee?: string
  due?: string
  parent?: string
  epic?: boolean
}

const issue = (key: string, spec: Spec = {}): Issue =>
  ({
    key,
    issueType: spec.epic === false ? { hierarchyLevel: 0 } : { hierarchyLevel: 1 },
    status: {
      id: spec.status ?? 'To Do',
      name: spec.status ?? 'To Do',
      category: spec.category ?? 'new',
    },
    customer: spec.customer === undefined ? null : { id: spec.customer, value: spec.customer },
    priority: spec.priority === undefined ? null : { id: spec.priority, name: spec.priority },
    assignee:
      spec.assignee === undefined
        ? null
        : { accountId: spec.assignee, displayName: spec.assignee, avatarUrl: null },
    dueDate: spec.due ?? null,
    parentKey: spec.parent ?? null,
  }) as Issue

const done = (key: string, parent: string) =>
  issue(key, { epic: false, parent, status: 'Done', category: 'done' })
const open = (key: string, parent: string) => issue(key, { epic: false, parent })

describe('epicRows', () => {
  it('lists the Epics with their progress and leaves the other issues out', () => {
    const issues = [issue('P-1'), open('P-2', 'P-1'), done('P-3', 'P-1'), issue('P-4')]
    const rows = epicRows(issues, childProgress(issues))
    expect(rows.map((r) => [r.issue.key, r.progress])).toEqual([
      ['P-1', { done: 1, total: 2 }],
      ['P-4', undefined],
    ])
  })
})

describe('sortEpics', () => {
  const rows = epicRows(
    [
      issue('P-1', {
        customer: 'Beta',
        status: 'In Progress',
        priority: 'High',
        assignee: 'Zed',
        due: '2026-12-01',
      }),
      issue('P-2', {
        customer: 'acme',
        status: 'To Do',
        priority: 'Low',
        assignee: 'amy',
        due: '2026-11-01',
      }),
      issue('P-3', { status: 'Done', category: 'done' }),
      issue('P-4', { customer: 'Cargo', priority: 'Highest', assignee: 'Bob' }),
    ],
    new Map([
      ['P-1', { done: 1, total: 2 }],
      ['P-2', { done: 3, total: 4 }],
      ['P-4', { done: 0, total: 5 }],
    ]),
  )
  const keys = (sort: EpicSort) => sortEpics(rows, sort).map((r) => r.issue.key)
  const sorted = (column: EpicColumn, direction: EpicSort['direction']) =>
    keys({ column, direction })

  it('sorts by the Epic key by number, newest first by default', () => {
    expect(keys(DEFAULT_EPIC_SORT)).toEqual(['P-4', 'P-3', 'P-2', 'P-1'])
    expect(sorted('epic', 'asc')).toEqual(['P-1', 'P-2', 'P-3', 'P-4'])
  })

  it('sorts by Customer in any case, with no Customer last in either direction', () => {
    expect(sorted('customer', 'asc')).toEqual(['P-2', 'P-1', 'P-4', 'P-3'])
    expect(sorted('customer', 'desc')).toEqual(['P-4', 'P-1', 'P-2', 'P-3'])
  })

  it("sorts by Status in the Tree's order", () => {
    expect(sorted('status', 'asc')).toEqual(['P-4', 'P-2', 'P-1', 'P-3'])
    expect(sorted('status', 'desc')).toEqual(['P-3', 'P-1', 'P-4', 'P-2'])
  })

  it('sorts by Priority with unrated last, and by Assignee by name', () => {
    expect(sorted('priority', 'desc')).toEqual(['P-4', 'P-1', 'P-2', 'P-3'])
    expect(sorted('priority', 'asc')).toEqual(['P-2', 'P-1', 'P-4', 'P-3'])
    expect(sorted('assignee', 'asc')).toEqual(['P-2', 'P-4', 'P-1', 'P-3'])
  })

  it('sorts by the Issues count, an Epic with none counting 0', () => {
    expect(sorted('issues', 'desc')).toEqual(['P-4', 'P-2', 'P-1', 'P-3'])
    expect(sorted('issues', 'asc')).toEqual(['P-3', 'P-1', 'P-2', 'P-4'])
  })

  it('sorts by due date, soonest first, with undated last in either direction', () => {
    expect(sorted('due', 'asc')).toEqual(['P-2', 'P-1', 'P-4', 'P-3'])
    expect(sorted('due', 'desc')).toEqual(['P-1', 'P-2', 'P-4', 'P-3'])
  })

  it('sorts by percent done, an Epic with no issue last in either direction', () => {
    expect(sorted('done', 'desc')).toEqual(['P-2', 'P-1', 'P-4', 'P-3'])
    expect(sorted('done', 'asc')).toEqual(['P-4', 'P-1', 'P-2', 'P-3'])
  })

  it('does not change the rows it sorts', () => {
    const before = rows.map((r) => r.issue.key)
    sortEpics(rows, { column: 'customer', direction: 'desc' })
    expect(rows.map((r) => r.issue.key)).toEqual(before)
  })
})

describe('clickSort', () => {
  it('starts a column in its own direction and reverses it on the next click', () => {
    const priority = clickSort(DEFAULT_EPIC_SORT, 'priority')
    expect(priority).toEqual({ column: 'priority', direction: 'desc' })
    expect(clickSort(priority, 'priority')).toEqual({ column: 'priority', direction: 'asc' })
    expect(clickSort(priority, 'customer')).toEqual({ column: 'customer', direction: 'asc' })
  })
})
