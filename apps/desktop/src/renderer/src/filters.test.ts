import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { clearField, filterChips, filterChoices, hasFilters, toggleChoice } from './filters'

function issue(key: string, extra: Partial<Issue> = {}): Issue {
  return {
    key,
    status: { id: '1', name: 'To Do', category: 'new' },
    issueType: { id: '1', name: 'Story', subtask: false, hierarchyLevel: 0 },
    assignee: null,
    labels: [],
    sprints: [],
    ...extra,
  } as Issue
}

describe('filterChoices', () => {
  const choices = filterChoices([
    issue('P-1', {
      status: { id: '9', name: 'Waiting', category: 'indeterminate' },
      assignee: { accountId: 'u2', displayName: 'Zed', avatarUrl: null },
      labels: ['beta', 'alpha'],
      sprints: [{ id: 7, name: 'Sprint 7', state: 'closed' }],
    }),
    issue('P-2', {
      assignee: { accountId: 'u1', displayName: 'Ann', avatarUrl: null },
      issueType: { id: '2', name: 'Bug', subtask: false, hierarchyLevel: 0 },
      labels: ['alpha'],
      sprints: [{ id: 8, name: 'Sprint 8', state: 'active' }],
    }),
    issue('P-3', { assignee: { accountId: 'u1', displayName: 'Ann', avatarUrl: null } }),
  ])

  it('lists Me and Unassigned, then each assignee once', () => {
    expect(choices.assignee).toEqual([
      { value: 'me', label: 'Me' },
      { value: 'unassigned', label: 'Unassigned' },
      { value: 'u1', label: 'Ann' },
      { value: 'u2', label: 'Zed' },
    ])
  })

  it('lists statuses in the Q21 order, then any other loaded status', () => {
    expect(choices.status.map((c) => c.value)).toEqual([
      'Opportunity',
      'To Do',
      'In Progress',
      'Review',
      'Hold',
      'Done',
      'Waiting',
    ])
  })

  it('lists labels and types sorted, once each', () => {
    expect(choices.label.map((c) => c.value)).toEqual(['alpha', 'beta'])
    expect(choices.type.map((c) => c.value)).toEqual(['Bug', 'Story'])
  })

  it('lists Current sprint, then active sprints, then the rest, by id', () => {
    expect(choices.sprint).toEqual([
      { value: 'current', label: 'Current sprint' },
      { value: '8', label: 'Sprint 8' },
      { value: '7', label: 'Sprint 7' },
    ])
  })
})

describe('toggleChoice', () => {
  it('adds a value, then removes it and drops the emptied field', () => {
    const added = toggleChoice({}, 'status', 'To Do')
    expect(added).toEqual({ status: ['To Do'] })
    expect(toggleChoice(added, 'status', 'In Progress').status).toEqual(['To Do', 'In Progress'])
    expect(toggleChoice(added, 'status', 'To Do')).toEqual({})
  })

  it('keeps the other fields and the text', () => {
    expect(toggleChoice({ text: 'x', label: ['a'] }, 'status', 'Done')).toEqual({
      text: 'x',
      label: ['a'],
      status: ['Done'],
    })
  })
})

describe('clearField and hasFilters', () => {
  it('clears one field only', () => {
    expect(clearField({ status: ['Done'], label: ['a'] }, 'status')).toEqual({ label: ['a'] })
  })

  it('counts the text, but not a blank one or an empty list', () => {
    expect(hasFilters({})).toBe(false)
    expect(hasFilters({ text: '   ', status: [] })).toBe(false)
    expect(hasFilters({ text: 'export' })).toBe(true)
    expect(hasFilters({ sprint: ['current'] })).toBe(true)
  })
})

describe('filterChips', () => {
  it('names each filtered field with the labels of its choices', () => {
    const choices = filterChoices([
      issue('P-1', { assignee: { accountId: 'u1', displayName: 'Ann', avatarUrl: null } }),
    ])
    expect(
      filterChips({ status: ['To Do', 'In Progress'], assignee: ['me', 'u1', 'gone'] }, choices),
    ).toEqual([
      { field: 'assignee', text: 'Assignee: Me, Ann, gone' },
      { field: 'status', text: 'Status: To Do, In Progress' },
    ])
    expect(filterChips({ text: 'only text' }, choices)).toEqual([])
  })
})
