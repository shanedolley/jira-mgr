import { describe, expect, it } from 'vitest'

import { loadFixture } from '../test/msw.js'
import {
  buildHierarchy,
  type CustomerGroup,
  type HierarchyNode,
  type HierarchyOptions,
} from './hierarchy.js'
import { issueSchema, type Issue } from './issue.js'

const ACME = { id: '1', value: 'Acme' }
const BETA = { id: '2', value: 'beta' }
const CORP = { id: '3', value: 'Corp' }
const TEAM = { id: '8', value: 'Collibra (Internal team)' }
const TEMPLATE = { id: '9', value: 'Collibra (Internal template)' }

const TYPES = {
  Epic: { id: '1', name: 'Epic', subtask: false, hierarchyLevel: 1 },
  Story: { id: '2', name: 'Story', subtask: false, hierarchyLevel: 0 },
  Subtask: { id: '3', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
}
const CATEGORY: Record<string, Issue['status']['category'] | undefined> = {
  Done: 'done',
  'To Do': 'new',
}

interface Spec {
  type?: keyof typeof TYPES
  status?: string
  parent?: string
  customer?: { id: string; value: string }
  assignee?: string
}

function issue(key: string, spec: Spec = {}): Issue {
  const status = spec.status ?? 'To Do'
  return {
    id: key,
    key,
    summary: key,
    issueType: TYPES[spec.type ?? 'Story'],
    status: {
      id: status,
      name: status,
      category: CATEGORY[status] ?? 'indeterminate',
    },
    resolution: null,
    parentKey: spec.parent ?? null,
    assignee: spec.assignee
      ? { accountId: spec.assignee, displayName: spec.assignee, avatarUrl: null }
      : null,
    labels: [],
    priority: null,
    customer: spec.customer ?? null,
    engagement: null,
    sprints: [],
    startDate: null,
    dueDate: null,
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null,
    timeRemainingHours: null,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
  }
}

const OFF: HierarchyOptions = {
  hideDone: false,
  assigneeMe: false,
  hideEmptyCustomers: true,
  accountId: 'me',
}
const build = (issues: Issue[], options: Partial<HierarchyOptions> = {}) =>
  buildHierarchy(issues, { ...OFF, ...options })
const keys = (nodes: HierarchyNode[]) => nodes.map((n) => n.issue.key)
const names = (groups: CustomerGroup[]) => groups.map((g) => g.customer?.value ?? null)

describe('buildHierarchy', () => {
  it('nests Customer, Epic, Story and Subtask', () => {
    const tree = build([
      issue('P-1', { type: 'Epic', customer: ACME }),
      issue('P-2', { parent: 'P-1', customer: ACME }),
      issue('P-3', { type: 'Subtask', parent: 'P-2', customer: ACME }),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.customer).toEqual(ACME)
    expect(keys(tree[0]?.epics ?? [])).toEqual(['P-1'])
    const story = tree[0]?.epics[0]?.children[0]
    expect(story?.issue.key).toBe('P-2')
    expect(keys(story?.children ?? [])).toEqual(['P-3'])
  })

  it("groups a child under its Epic's Customer and flags the mismatch with both values", () => {
    const tree = build([
      issue('P-1', { type: 'Epic', customer: ACME }),
      issue('P-2', { parent: 'P-1', customer: BETA }),
      issue('P-3', { parent: 'P-1', customer: ACME }),
      issue('P-4', { parent: 'P-1' }),
    ])

    expect(names(tree)).toEqual(['Acme'])
    const [p4, p3, p2] = tree[0]?.epics[0]?.children ?? []
    expect(p2?.customerMismatch).toEqual({ own: BETA, epic: ACME })
    expect(p4?.customerMismatch).toEqual({ own: null, epic: ACME })
    expect(p3?.customerMismatch).toBeNull()
  })

  it('never flags a Subtask, whatever its Customer', () => {
    const tree = build([
      issue('P-1', { type: 'Epic', customer: ACME }),
      issue('P-2', { parent: 'P-1', customer: ACME }),
      issue('P-3', { type: 'Subtask', parent: 'P-2', customer: BETA }),
      issue('P-4', { type: 'Subtask', parent: 'P-2' }),
    ])

    const story = tree[0]?.epics[0]?.children[0]
    expect(keys(story?.children ?? [])).toEqual(['P-4', 'P-3'])
    expect(story?.children.map((c) => c.customerMismatch)).toEqual([null, null])
  })

  it('does not flag an Epic with no Customer and a child with none', () => {
    const tree = build([issue('P-1', { type: 'Epic' }), issue('P-2', { parent: 'P-1' })])

    expect(tree[0]?.epics[0]?.children[0]?.customerMismatch).toBeNull()
  })

  it('puts issues with no Customer in a No Customer group', () => {
    const tree = build([issue('P-1', { type: 'Epic' })])

    expect(tree[0]?.customer).toBeNull()
    expect(keys(tree[0]?.epics ?? [])).toEqual(['P-1'])
  })

  it('puts an Epic-less issue in No Epic under its own Customer', () => {
    const tree = build([issue('P-1', { customer: ACME }), issue('P-2', { parent: 'P-9' })])

    expect(keys(tree.find((g) => g.customer?.id === '1')?.noEpic ?? [])).toEqual(['P-1'])
    expect(keys(tree.find((g) => g.customer === null)?.noEpic ?? [])).toEqual(['P-2'])
    expect(tree[0]?.epics).toEqual([])
  })

  it('puts a Subtask whose parent is not loaded in No Epic under its own Customer', () => {
    const tree = build([issue('P-3', { type: 'Subtask', parent: 'P-2', customer: BETA })])

    expect(keys(tree[0]?.noEpic ?? [])).toEqual(['P-3'])
    expect(tree[0]?.customer).toEqual(BETA)
  })

  it('keeps a Subtask under its Epic-less Story in No Epic', () => {
    const tree = build([
      issue('P-1', { customer: ACME }),
      issue('P-2', { type: 'Subtask', parent: 'P-1', customer: ACME }),
    ])

    expect(keys(tree[0]?.noEpic ?? [])).toEqual(['P-1'])
    expect(keys(tree[0]?.noEpic[0]?.children ?? [])).toEqual(['P-2'])
  })

  describe('Done children', () => {
    const issues = [
      issue('P-1', { type: 'Epic', customer: ACME }),
      issue('P-2', { parent: 'P-1', status: 'Done' }),
      issue('P-3', { parent: 'P-1', status: 'Done' }),
      issue('P-4', { parent: 'P-1' }),
    ]

    it('collapse to a count on an open parent', () => {
      const epic = build(issues)[0]?.epics[0]

      expect(keys(epic?.children ?? [])).toEqual(['P-4'])
      expect(keys(epic?.doneChildren ?? [])).toEqual(['P-3', 'P-2'])
      expect(epic?.doneCount).toBe(2)
    })

    it('collapse whatever "Hide done" says', () => {
      const epic = build(issues, { hideDone: true })[0]?.epics[0]

      expect(epic?.doneCount).toBe(2)
      expect(keys(epic?.children ?? [])).toEqual(['P-4'])
    })

    it('stay listed under a Done parent', () => {
      const epic = build([
        issue('P-1', { type: 'Epic', status: 'Done', customer: ACME }),
        issue('P-2', { parent: 'P-1', status: 'Done' }),
        issue('P-3', { parent: 'P-1' }),
      ])[0]?.epics[0]

      expect(keys(epic?.children ?? [])).toEqual(['P-3', 'P-2'])
      expect(epic?.doneCount).toBe(0)
    })
  })

  describe('Hide done', () => {
    it('drops a Done Epic with its whole subtree', () => {
      const tree = build(
        [
          issue('P-1', { type: 'Epic', status: 'Done', customer: ACME }),
          issue('P-2', { parent: 'P-1' }),
          issue('P-3', { type: 'Epic', customer: BETA }),
        ],
        { hideDone: true },
      )

      expect(names(tree)).toEqual(['beta'])
    })

    it('drops a Done Epic-less issue and keeps it when off', () => {
      const issues = [issue('P-1', { status: 'Done', customer: ACME })]

      expect(build(issues, { hideDone: true })).toEqual([])
      expect(keys(build(issues)[0]?.noEpic ?? [])).toEqual(['P-1'])
    })
  })

  describe('Assignee: me', () => {
    const issues = [
      issue('P-1', { type: 'Epic', customer: ACME }),
      issue('P-2', { parent: 'P-1', assignee: 'other' }),
      issue('P-3', { parent: 'P-1' }),
      issue('P-4', { type: 'Subtask', parent: 'P-3', assignee: 'me' }),
      issue('P-5', { type: 'Epic', customer: BETA }),
      issue('P-6', { parent: 'P-5', assignee: 'other' }),
    ]

    it('keeps mine plus ancestors, marked as context only', () => {
      const tree = build(issues, { assigneeMe: true })

      expect(names(tree)).toEqual(['Acme'])
      const epic = tree[0]?.epics[0]
      expect(epic?.contextOnly).toBe(true)
      expect(keys(epic?.children ?? [])).toEqual(['P-3'])
      expect(epic?.children[0]?.contextOnly).toBe(true)
      expect(epic?.children[0]?.children[0]?.contextOnly).toBe(false)
    })

    it('keeps a Done ancestor of my open issue as context under "Hide done"', () => {
      const tree = build(
        [
          issue('P-1', { type: 'Epic', status: 'Done', customer: ACME }),
          issue('P-2', { parent: 'P-1', status: 'Done', assignee: 'other' }),
          issue('P-3', { parent: 'P-1', status: 'Done', assignee: 'me' }),
          issue('P-4', { parent: 'P-1', assignee: 'me' }),
          issue('P-5', { type: 'Epic', status: 'Done', customer: BETA }),
          issue('P-6', { parent: 'P-5', status: 'Done', assignee: 'me' }),
        ],
        { assigneeMe: true, hideDone: true },
      )

      expect(names(tree)).toEqual(['Acme'])
      const epic = tree[0]?.epics[0]
      expect(epic?.contextOnly).toBe(true)
      expect(keys(epic?.children ?? [])).toEqual(['P-4'])
    })

    it('hides a Done ancestor of my open issue only when "Assignee: me" is off', () => {
      const issues = [
        issue('P-1', { type: 'Epic', status: 'Done', customer: ACME }),
        issue('P-2', { parent: 'P-1', assignee: 'me' }),
      ]

      expect(build(issues, { hideDone: true })).toEqual([])
      expect(build(issues, { hideDone: true, assigneeMe: true })).toHaveLength(1)
    })

    it('keeps everything when off', () => {
      const tree = build(issues)

      expect(names(tree)).toEqual(['Acme', 'beta'])
      expect(tree[0]?.epics[0]?.contextOnly).toBe(false)
    })

    it('counts only kept Done children', () => {
      const epic = build(
        [
          issue('P-1', { type: 'Epic', customer: ACME }),
          issue('P-2', { parent: 'P-1', status: 'Done', assignee: 'me' }),
          issue('P-3', { parent: 'P-1', status: 'Done', assignee: 'other' }),
        ],
        { assigneeMe: true },
      )[0]?.epics[0]

      expect(epic?.doneCount).toBe(1)
    })
  })

  describe('empty Customers', () => {
    const customers = [ACME, BETA, CORP]
    const issues = [issue('P-1', { type: 'Epic', customer: ACME })]

    it('are dropped when hidden', () => {
      expect(names(build(issues, { customers }))).toEqual(['Acme'])
    })

    it('show from the full Customer list when not hidden', () => {
      const tree = build(issues, { customers, hideEmptyCustomers: false })

      expect(names(tree)).toEqual(['Acme', 'beta', 'Corp'])
      expect(tree[1]).toEqual({ customer: BETA, epics: [], noEpic: [] })
    })

    it('show a Customer whose issues "Hide done" removed, when not hidden', () => {
      const done = [issue('P-1', { type: 'Epic', status: 'Done', customer: ACME })]

      expect(names(build(done, { hideDone: true, hideEmptyCustomers: false }))).toEqual(['Acme'])
      expect(build(done, { hideDone: true })).toEqual([])
    })

    it('drops a Customer that "Assignee: me" empties, when hidden', () => {
      expect(build(issues, { assigneeMe: true })).toEqual([])
    })
  })

  describe('sorting', () => {
    it('orders Customers case-insensitively with the internal ones last', () => {
      const tree = build([
        issue('P-1', { type: 'Epic', customer: TEMPLATE }),
        issue('P-2', { type: 'Epic', customer: CORP }),
        issue('P-3', { type: 'Epic', customer: TEAM }),
        issue('P-4', { type: 'Epic', customer: BETA }),
        issue('P-5', { type: 'Epic', customer: ACME }),
      ])

      expect(names(tree)).toEqual([
        'Acme',
        'beta',
        'Corp',
        'Collibra (Internal team)',
        'Collibra (Internal template)',
      ])
    })

    it('puts No Customer before the internal Customers', () => {
      const tree = build([
        issue('P-1', { type: 'Epic', customer: TEAM }),
        issue('P-2', { type: 'Epic' }),
        issue('P-3', { type: 'Epic', customer: ACME }),
      ])

      expect(names(tree)).toEqual(['Acme', null, 'Collibra (Internal team)'])
    })

    it('orders Epics by key descending, numerically', () => {
      const tree = build([
        issue('P-9', { type: 'Epic', customer: ACME }),
        issue('P-100', { type: 'Epic', customer: ACME }),
        issue('P-20', { type: 'Epic', customer: ACME }),
      ])

      expect(keys(tree[0]?.epics ?? [])).toEqual(['P-100', 'P-20', 'P-9'])
    })

    it('orders children by status, then key descending, with unknown statuses after Done', () => {
      const tree = build([
        issue('P-1', { type: 'Epic', customer: ACME }),
        issue('P-2', { parent: 'P-1', status: 'Weird' }),
        issue('P-3', { parent: 'P-1', status: 'Hold' }),
        issue('P-4', { parent: 'P-1', status: 'Review' }),
        issue('P-5', { parent: 'P-1', status: 'In Progress' }),
        issue('P-6', { parent: 'P-1', status: 'To Do' }),
        issue('P-7', { parent: 'P-1', status: 'Opportunity' }),
        issue('P-8', { parent: 'P-1', status: 'To Do' }),
      ])

      expect(keys(tree[0]?.epics[0]?.children ?? [])).toEqual([
        'P-7',
        'P-8',
        'P-6',
        'P-5',
        'P-4',
        'P-3',
        'P-2',
      ])
    })

    it('orders the No Epic group by status, then key descending', () => {
      const tree = build([
        issue('P-1', { status: 'In Progress', customer: ACME }),
        issue('P-2', { customer: ACME }),
        issue('P-3', { customer: ACME }),
      ])

      expect(keys(tree[0]?.noEpic ?? [])).toEqual(['P-3', 'P-2', 'P-1'])
    })

    it('orders Done children by status order too, then key descending', () => {
      const epic = build([
        issue('P-1', { type: 'Epic', customer: ACME }),
        issue('P-2', { parent: 'P-1', status: 'Done' }),
        issue('P-3', { parent: 'P-1', status: 'Done' }),
      ])[0]?.epics[0]

      expect(keys(epic?.doneChildren ?? [])).toEqual(['P-3', 'P-2'])
    })
  })

  it('does not change its input', () => {
    const issues = [
      issue('P-1', { type: 'Epic', customer: ACME }),
      issue('P-2', { parent: 'P-1', status: 'Done' }),
      issue('P-3', { parent: 'P-1' }),
    ]
    const before = structuredClone(issues)

    build(issues)

    expect(issues).toEqual(before)
  })

  describe('recorded fixtures', () => {
    const IDS = {
      customer: 'customfield_14849',
      engagement: 'customfield_14850',
      sprint: 'customfield_10600',
      startDate: 'customfield_13808',
      timeRemaining: 'customfield_21785',
    }
    const issues = [
      'search-unresolved-1',
      'search-unresolved-2',
      'search-done-1',
      'search-done-2',
    ].flatMap((name) => {
      const page = loadFixture(name) as unknown as { issues: unknown[] }
      return page.issues.map((raw) => issueSchema(IDS).parse(raw))
    })
    const unique = [...new Map(issues.map((i) => [i.key, i])).values()]

    function walk(nodes: HierarchyNode[]): string[] {
      return nodes.flatMap((n) => [n.issue.key, ...walk(n.children), ...walk(n.doneChildren)])
    }

    it('places every recorded issue exactly once and survives JSON', () => {
      const tree = build(unique)
      const placed = tree.flatMap((g) => walk([...g.epics, ...g.noEpic]))

      expect(placed.toSorted()).toEqual(unique.map((i) => i.key).toSorted())
      expect(JSON.parse(JSON.stringify(tree))).toEqual(tree)
    })
  })
})
