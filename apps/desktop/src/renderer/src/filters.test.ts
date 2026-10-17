import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import {
  clearField,
  valuesOf,
  filterChips,
  filterChoices,
  hasFilters,
  noMatchTitle,
  sentence,
  toggleChoice,
} from './filters'

function issue(key: string, extra: Partial<Issue> = {}): Issue {
  return {
    key,
    status: { id: '1', name: 'To Do', category: 'new' },
    issueType: { id: '1', name: 'Story', subtask: false, hierarchyLevel: 0 },
    assignee: null,
    creator: null,
    priority: null,
    customer: null,
    engagement: null,
    labels: [],
    links: [],
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
      sprints: [{ id: 7, name: 'Sprint 7', state: 'closed', endDate: null }],
    }),
    issue('P-2', {
      assignee: { accountId: 'u1', displayName: 'Ann', avatarUrl: null },
      issueType: { id: '2', name: 'Bug', subtask: false, hierarchyLevel: 0 },
      labels: ['alpha'],
      sprints: [{ id: 8, name: 'Sprint 8', state: 'active', endDate: null }],
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

describe('filterChoices for the new fields', () => {
  const choices = filterChoices(
    [
      issue('P-1', {
        summary: 'Plan',
        issueType: { id: '9', name: 'Epic', subtask: false, hierarchyLevel: 1 },
        creator: { accountId: 'u2', displayName: 'Zed' },
        priority: { id: '3', name: 'Medium' },
        customer: { id: '1', value: 'Acme' },
        engagement: { id: '7', value: 'North' },
      }),
      issue('P-2', {
        creator: { accountId: 'u1', displayName: 'Ann' },
        priority: { id: '1', name: 'Highest' },
        customer: { id: '2', value: 'Beta Ltd' },
      }),
    ],
    ['Zeta Corp', 'Acme'],
  )

  it('lists the Project’s Customers, those with no issue included, once each and sorted', () => {
    expect(choices.customer.map((c) => c.value)).toEqual(['Acme', 'Beta Ltd', 'Zeta Corp'])
  })

  it('falls back to the loaded issues’ Customers while the list has not loaded', () => {
    expect(
      filterChoices([issue('P-1', { customer: { id: '1', value: 'Acme' } })]).customer,
    ).toEqual([{ value: 'Acme', label: 'Acme' }])
  })

  it('lists Me then each creator, the priorities by urgency, and the Epics by key and summary', () => {
    expect(choices.creator).toEqual([
      { value: 'me', label: 'Me' },
      { value: 'u1', label: 'Ann' },
      { value: 'u2', label: 'Zed' },
    ])
    expect(choices.priority.map((c) => c.value)).toEqual(['Highest', 'Medium'])
    expect(choices.engagement.map((c) => c.value)).toEqual(['North'])
    expect(choices.epic).toEqual([{ value: 'P-1', label: 'P-1 Plan' }])
  })

  it('lists the fixed choices of Status type, Relations and the dates', () => {
    expect(choices.statusType.map((c) => c.value)).toEqual(['new', 'indeterminate', 'done'])
    expect(choices.relations.map((c) => c.value)).toEqual(['blocked', 'blocking'])
    expect(choices.due.map((c) => c.value)).toContain('overdue')
    expect(choices.created.map((c) => c.value)).not.toContain('overdue')
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

describe('the "is not" operator and the date fields', () => {
  it('toggles values into and out of not, apart from the is values', () => {
    const excluded = toggleChoice({ status: ['Done'] }, 'status', 'Hold', 'not')
    expect(excluded).toEqual({ status: ['Done'], not: { status: ['Hold'] } })
    expect(valuesOf(excluded, 'status', 'is')).toEqual(['Done'])
    expect(valuesOf(excluded, 'status', 'not')).toEqual(['Hold'])
    expect(toggleChoice(excluded, 'status', 'Hold', 'not')).toEqual({ status: ['Done'] })
  })

  it('stores a date field under dates, one value at a time, and drops it when cleared', () => {
    const due = toggleChoice({}, 'due', 'overdue')
    expect(due).toEqual({ dates: { due: 'overdue' } })
    expect(toggleChoice(due, 'due', 'today')).toEqual({ dates: { due: 'today' } })
    expect(toggleChoice(due, 'created', 'last-7-days')).toEqual({
      dates: { due: 'overdue', created: 'last-7-days' },
    })
    expect(toggleChoice(due, 'due', 'overdue')).toEqual({})
    expect(valuesOf(due, 'due', 'not')).toEqual([])
  })

  it('clears one operator of one field only', () => {
    const both = { status: ['Done'], not: { status: ['Hold'], label: ['etl'] } }
    expect(clearField(both, 'status', 'not')).toEqual({ status: ['Done'], not: { label: ['etl'] } })
    expect(clearField(both, 'status')).toEqual({ not: { status: ['Hold'], label: ['etl'] } })
    expect(clearField({ not: { status: ['Hold'] } }, 'status', 'not')).toEqual({})
  })

  it('keeps the text when it changes a field', () => {
    expect(toggleChoice({ text: 'x' }, 'priority', 'High', 'not')).toEqual({
      text: 'x',
      not: { priority: ['High'] },
    })
  })

  it('counts not values and dates as filters', () => {
    expect(hasFilters({ not: { label: ['etl'] } })).toBe(true)
    expect(hasFilters({ dates: { updated: 'today' } })).toBe(true)
    expect(hasFilters({ not: {}, dates: {} })).toBe(false)
  })

  it('draws one chip per field and operator, "is not" worded as such', () => {
    const choices = filterChoices([issue('P-1')])
    expect(
      filterChips(
        { status: ['Done'], not: { status: ['Hold'] }, dates: { due: 'overdue' } },
        choices,
      ),
    ).toEqual([
      { field: 'status', op: 'is', text: 'Status: Done' },
      { field: 'status', op: 'not', text: 'Status is not: Hold' },
      { field: 'due', op: 'is', text: 'Due date: Overdue' },
    ])
  })

  it('names the cause of an empty Tree with an exclusion', () => {
    const choices = filterChoices([issue('P-1')])
    expect(noMatchTitle({ not: { label: ['etl'] }, dates: { due: 'overdue' } }, choices)).toBe(
      'No issues match Label is not: etl and Due date: Overdue',
    )
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
      { field: 'status', op: 'is', text: 'Status: To Do, In Progress' },
      { field: 'assignee', op: 'is', text: 'Assignee: Me, Ann, gone' },
    ])
    expect(filterChips({ text: 'only text' }, choices)).toEqual([])
  })
})

describe('noMatchTitle', () => {
  const choices = filterChoices([
    issue('P-1', { issueType: { id: '2', name: 'Bug', subtask: false, hierarchyLevel: 0 } }),
  ])

  it('names the text and the chips that caused the empty Tree', () => {
    expect(noMatchTitle({ text: 'zzzzqq', type: ['Bug'] }, choices)).toBe(
      'No issues match “zzzzqq” with Type: Bug',
    )
  })

  it('names the text alone, or the chips alone', () => {
    expect(noMatchTitle({ text: ' zzzzqq ' }, choices)).toBe('No issues match “zzzzqq”')
    expect(noMatchTitle({ type: ['Bug'], status: ['To Do'] }, choices)).toBe(
      'No issues match Status: To Do and Type: Bug',
    )
  })

  it('says only "No issues match" when no filter is set', () => {
    expect(noMatchTitle({ text: '  ' }, choices)).toBe('No issues match')
  })
})

describe('sentence', () => {
  it('joins names with commas and a final "and"', () => {
    expect(sentence([])).toBe('')
    expect(sentence(['A'])).toBe('A')
    expect(sentence(['A', 'B'])).toBe('A and B')
    expect(sentence(['A', 'B', 'C'])).toBe('A, B and C')
  })
})
