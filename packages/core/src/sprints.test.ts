import { describe, expect, it } from 'vitest'

import type { Issue } from './issue.js'
import { sprintStats } from './sprints.js'

const STATUS = {
  'To Do': { id: '1', name: 'To Do', category: 'new' },
  Doing: { id: '2', name: 'Doing', category: 'indeterminate' },
  Review: { id: '3', name: 'Review', category: 'indeterminate' },
  Done: { id: '4', name: 'Done', category: 'done' },
  Closed: { id: '5', name: 'Closed', category: 'done' },
  Hold: { id: '6', name: 'Hold', category: 'new' },
} as const

interface Person {
  accountId: string
  displayName: string
  avatarUrl: string | null
}
const ANN: Person = { accountId: 'a', displayName: 'Ann', avatarUrl: 'https://img.test/a.png' }
const BOB: Person = { accountId: 'b', displayName: 'Bob', avatarUrl: null }

interface Spec {
  status: keyof typeof STATUS
  assignee?: Person
  labels?: string[]
  priority?: { id: string; name: string }
  customer?: { id: string; value: string }
}

function issue(key: string, spec: Spec): Issue {
  return {
    id: key,
    key,
    summary: key,
    issueType: { id: '2', name: 'Story', subtask: false, hierarchyLevel: 0 },
    status: STATUS[spec.status],
    resolution: null,
    parentKey: null,
    creator: null,
    links: [],
    assignee: spec.assignee ?? null,
    labels: spec.labels ?? [],
    priority: spec.priority ?? null,
    customer: spec.customer ?? null,
    engagement: null,
    sprints: [],
    startDate: null,
    dueDate: null,
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null,
    timeSpentSeconds: null,
    timeRemainingHours: null,
    created: '2026-10-01T00:00:00.000Z',
    updated: '2026-10-01T00:00:00.000Z',
  }
}

const HIGH = { id: '2', name: 'High' }
const LOW = { id: '4', name: 'Low' }

describe('sprintStats', () => {
  it('reads Completed from the status category, not the status name', () => {
    const issues = [
      issue('A-1', { status: 'Closed', assignee: ANN, labels: ['x'], priority: HIGH }),
      issue('A-2', { status: 'Done', assignee: ANN, labels: ['x'], priority: HIGH }),
      issue('A-3', { status: 'Hold', assignee: ANN, labels: ['x'], priority: HIGH }),
    ]
    const stats = sprintStats(issues)
    expect(stats).toMatchObject({ scope: 3, started: 0, completed: 2 })
    for (const groups of [stats.assignees, stats.labels, stats.priorities]) {
      expect(groups[0]).toMatchObject({ total: 3, completed: 2, percent: 67 })
    }
  })

  it('counts the scope, the started issues (In Progress) and the completed ones (Done)', () => {
    const stats = sprintStats([
      issue('A-1', { status: 'To Do' }),
      issue('A-2', { status: 'Doing' }),
      issue('A-3', { status: 'Review' }),
      issue('A-4', { status: 'Done' }),
      issue('A-5', { status: 'Done' }),
    ])
    expect(stats).toMatchObject({ scope: 5, started: 2, completed: 2 })
  })

  it('reads an empty sprint as zeros', () => {
    expect(sprintStats([])).toEqual({
      scope: 0,
      started: 0,
      completed: 0,
      assignees: [],
      labels: [],
      priorities: [],
      customers: [],
      engagements: [],
    })
  })

  it('reads "N% of M" as the completed share of the M issues that share a value', () => {
    const { assignees } = sprintStats([
      issue('A-1', { status: 'Done', assignee: ANN }),
      issue('A-2', { status: 'Doing', assignee: ANN }),
      issue('A-3', { status: 'To Do', assignee: ANN }),
      issue('A-4', { status: 'Done', assignee: BOB }),
    ])
    expect(assignees).toEqual([
      {
        id: 'a',
        name: 'Ann',
        avatarUrl: 'https://img.test/a.png',
        total: 3,
        completed: 1,
        percent: 33,
      },
      { id: 'b', name: 'Bob', avatarUrl: null, total: 1, completed: 1, percent: 100 },
    ])
  })

  it('puts issues with no value in one group that sorts last', () => {
    const { assignees, priorities, customers, engagements } = sprintStats([
      issue('A-1', { status: 'Done' }),
      issue('A-2', { status: 'To Do' }),
      issue('A-3', { status: 'To Do' }),
      issue('A-4', { status: 'Done', assignee: BOB, priority: HIGH }),
    ])
    expect(assignees.map((g) => [g.name, g.total, g.percent])).toEqual([
      ['Bob', 1, 100],
      ['Unassigned', 3, 33],
    ])
    expect(priorities.map((g) => g.name)).toEqual(['High', 'No priority'])
    expect(customers.map((g) => g.name)).toEqual(['No Customer'])
    expect(engagements.map((g) => g.name)).toEqual(['No Engagement'])
  })

  it('counts an issue under each of its labels, and sorts by size then name', () => {
    const { labels } = sprintStats([
      issue('A-1', { status: 'Done', labels: ['docs', 'api'] }),
      issue('A-2', { status: 'To Do', labels: ['docs'] }),
      issue('A-3', { status: 'To Do', labels: ['zed'] }),
      issue('A-4', { status: 'To Do' }),
    ])
    expect(labels.map((g) => [g.name, g.total, g.completed])).toEqual([
      ['docs', 2, 1],
      ['api', 1, 1],
      ['zed', 1, 0],
      ['No label', 1, 0],
    ])
  })

  it('groups priorities and Customers by id, naming them by their value', () => {
    const { priorities, customers } = sprintStats([
      issue('A-1', { status: 'Done', priority: LOW, customer: { id: '9', value: 'Acme' } }),
      issue('A-2', { status: 'To Do', priority: LOW, customer: { id: '9', value: 'Acme' } }),
      issue('A-3', { status: 'To Do', priority: HIGH, customer: { id: '8', value: 'Beta' } }),
    ])
    expect(priorities.map((g) => [g.name, g.total, g.percent])).toEqual([
      ['Low', 2, 50],
      ['High', 1, 0],
    ])
    expect(customers.map((g) => [g.name, g.total])).toEqual([
      ['Acme', 2],
      ['Beta', 1],
    ])
  })
})
