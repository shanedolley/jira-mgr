import type { Issue } from '@jira-mgr/core'
import { priorityLevel } from '@jira-mgr/core/display'
import { STATUS_ORDER, type Progress } from '@jira-mgr/core/hierarchy'

import { percentOf } from './sprintView'

/** One row of the Epics table: an Epic with the progress of its direct children. */
export interface EpicRow {
  issue: Issue
  /** `undefined` for an Epic with no loaded child. */
  progress: Progress | undefined
}

export type SortDirection = 'asc' | 'desc'

/** The Epics table's columns, each with the direction its first click sorts in. */
export const EPIC_COLUMNS = [
  { id: 'epic', label: 'Epic', first: 'desc' },
  { id: 'customer', label: 'Customer', first: 'asc' },
  { id: 'status', label: 'Status', first: 'asc' },
  { id: 'priority', label: 'Priority', first: 'desc' },
  { id: 'assignee', label: 'Assignee', first: 'asc' },
  { id: 'issues', label: 'Issues', first: 'desc' },
  { id: 'due', label: 'Due date', first: 'asc' },
  { id: 'done', label: '% done', first: 'desc' },
] as const satisfies readonly { id: string; label: string; first: SortDirection }[]

export type EpicColumn = (typeof EPIC_COLUMNS)[number]['id']

export interface EpicSort {
  column: EpicColumn
  direction: SortDirection
}

/** Newest Epic first, as the Tree orders them. */
export const DEFAULT_EPIC_SORT: EpicSort = { column: 'epic', direction: 'desc' }

/** The sort a click on `column`'s header gives: its first direction, or the other when it is the sort already. */
export function clickSort(current: EpicSort, column: EpicColumn): EpicSort {
  if (current.column === column) {
    return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  const first = EPIC_COLUMNS.find((c) => c.id === column)?.first ?? 'asc'
  return { column, direction: first }
}

/** The Epics among `issues`, each with its progress. */
export function epicRows(
  issues: readonly Issue[],
  progress: ReadonlyMap<string, Progress>,
): EpicRow[] {
  return issues
    .filter((i) => i.issueType.hierarchyLevel >= 1)
    .map((issue) => ({ issue, progress: progress.get(issue.key) }))
}

const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf('-') + 1))

/** What a column sorts on: a number or a string, or `null` for an Epic that has no value, which sorts last either way. */
function sortValue(row: EpicRow, column: EpicColumn): number | string | null {
  const { issue, progress } = row
  switch (column) {
    case 'epic':
      return keyNumber(issue.key)
    case 'customer':
      return issue.customer?.value.toLowerCase() ?? null
    case 'status': {
      const rank = STATUS_ORDER.indexOf(issue.status.name)
      return rank === -1 ? STATUS_ORDER.length : rank
    }
    case 'priority':
      return issue.priority === null ? null : priorityLevel(issue.priority.name)
    case 'assignee':
      return issue.assignee?.displayName.toLowerCase() ?? null
    case 'issues':
      return progress?.total ?? 0
    case 'due':
      return issue.dueDate
    case 'done':
      return progress === undefined || progress.total === 0
        ? null
        : percentOf(progress.done, progress.total)
  }
}

/** The rows sorted by one column, ties by key, newest first. Does not change `rows`. */
export function sortEpics(rows: readonly EpicRow[], { column, direction }: EpicSort): EpicRow[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = sortValue(a, column)
    const y = sortValue(b, column)
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1
    } else if (x !== y) {
      return (x < y ? -1 : 1) * sign
    }
    return keyNumber(b.issue.key) - keyNumber(a.issue.key)
  })
}
