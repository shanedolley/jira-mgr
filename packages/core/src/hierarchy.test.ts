import { describe, expect, it } from 'vitest'

import { loadFixture } from '../test/msw.js'
import {
  buildHierarchy,
  childProgress,
  customerTotals,
  fitManualOrder,
  moveInManualOrder,
  siblingKeys,
  sortedByManual,
  STATUS_ORDER,
  treeOrder,
  type CustomerGroup,
  type HierarchyNode,
  type HierarchyOptions,
} from './hierarchy.js'
import { ISSUE_ORDERS, MANUAL_ORDER_LIMIT, ORDER_DEFAULT_DIRECTION } from './display.js'
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
  priority?: string
  due?: string
  updated?: string
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
    creator: null,
    labels: [],
    links: [],
    priority: spec.priority === undefined ? null : { id: spec.priority, name: spec.priority },
    customer: spec.customer ?? null,
    engagement: null,
    sprints: [],
    startDate: null,
    dueDate: spec.due ?? null,
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null,
    timeSpentSeconds: null,
    timeRemainingHours: null,
    created: '2026-01-01T00:00:00.000Z',
    updated: spec.updated ?? '2026-01-01T00:00:00.000Z',
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

    it('vanish under "Hide done", with no chip', () => {
      const epic = build(issues, { hideDone: true })[0]?.epics[0]

      expect(epic?.doneCount).toBe(0)
      expect(epic?.doneChildren).toEqual([])
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
    it('drops a Done Epic and attaches its open child as a root in its own Customer group', () => {
      const tree = build(
        [
          issue('P-1', { type: 'Epic', status: 'Done', customer: ACME }),
          issue('P-2', { parent: 'P-1', customer: ACME }),
          issue('P-3', { parent: 'P-1', status: 'Done', customer: ACME }),
          issue('P-4', { type: 'Epic', customer: BETA }),
        ],
        { hideDone: true },
      )

      expect(names(tree)).toEqual(['Acme', 'beta'])
      expect(tree[0]?.epics).toEqual([])
      expect(keys(tree[0]?.noEpic ?? [])).toEqual(['P-2'])
      expect(tree[0]?.noEpic[0]?.contextOnly).toBe(false)
      expect(tree[1]?.epics[0]?.contextOnly).toBe(false)
    })

    it('attaches an open issue to its nearest open ancestor, past Done ones', () => {
      const tree = build(
        [
          issue('P-1', { type: 'Epic', customer: ACME }),
          issue('P-2', { parent: 'P-1', status: 'Done', customer: ACME }),
          issue('P-3', { type: 'Subtask', parent: 'P-2', customer: ACME }),
          issue('P-4', { parent: 'P-1', status: 'Done', customer: ACME }),
          issue('P-5', { type: 'Subtask', parent: 'P-4', status: 'Done', customer: ACME }),
        ],
        { hideDone: true },
      )

      const epic = tree[0]?.epics[0]
      expect(keys(epic?.children ?? [])).toEqual(['P-3'])
      expect(epic?.doneChildren).toEqual([])
      expect(epic?.children[0]?.customerMismatch).toBeNull()
    })

    it('roots an open Subtask whose Done chain ends in no open ancestor', () => {
      const tree = build(
        [
          issue('P-1', { type: 'Epic', status: 'Done', customer: ACME }),
          issue('P-2', { parent: 'P-1', status: 'Done', customer: ACME }),
          issue('P-3', { type: 'Subtask', parent: 'P-2', customer: ACME }),
        ],
        { hideDone: true },
      )

      expect(keys(tree[0]?.noEpic ?? [])).toEqual(['P-3'])
    })

    it('shows no Done row and no chip anywhere', () => {
      const tree = build(
        [
          issue('P-1', { type: 'Epic', customer: ACME }),
          issue('P-2', { parent: 'P-1', customer: ACME }),
          issue('P-3', { parent: 'P-1', status: 'Done', customer: ACME }),
          issue('P-4', { type: 'Subtask', parent: 'P-2', status: 'Done', customer: ACME }),
          issue('P-5', { type: 'Epic', status: 'Done', customer: BETA }),
        ],
        { hideDone: true },
      )

      const all = (nodes: HierarchyNode[]): HierarchyNode[] =>
        nodes.flatMap((n) => [n, ...all(n.children), ...all(n.doneChildren)])
      const nodes = tree.flatMap((g) => all([...g.epics, ...g.noEpic]))
      expect(nodes.map((n) => n.issue.key)).toEqual(['P-1', 'P-2'])
      expect(nodes.every((n) => n.doneCount === 0 && n.doneChildren.length === 0)).toBe(true)
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

    it('hides a Done ancestor of my open issue under "Hide done"', () => {
      const tree = build(
        [
          issue('P-1', { type: 'Epic', status: 'Done', customer: ACME }),
          issue('P-2', { parent: 'P-1', status: 'Done', assignee: 'other' }),
          issue('P-3', { parent: 'P-1', status: 'Done', assignee: 'me' }),
          issue('P-4', { parent: 'P-1', assignee: 'me', customer: ACME }),
          issue('P-5', { type: 'Epic', status: 'Done', customer: BETA }),
          issue('P-6', { parent: 'P-5', status: 'Done', assignee: 'me' }),
        ],
        { assigneeMe: true, hideDone: true },
      )

      expect(names(tree)).toEqual(['Acme'])
      expect(tree[0]?.epics).toEqual([])
      expect(keys(tree[0]?.noEpic ?? [])).toEqual(['P-4'])
    })

    it("drops a group whose only match is a Done child of someone else's Epic", () => {
      const tree = build(
        [
          issue('P-1', { type: 'Epic', status: 'In Progress', customer: ACME, assignee: 'other' }),
          issue('P-2', { parent: 'P-1', status: 'Done', customer: ACME, assignee: 'me' }),
        ],
        { assigneeMe: true, hideDone: true },
      )

      expect(tree).toEqual([])
      expect(
        build(
          [
            issue('P-1', { type: 'Epic', customer: ACME, assignee: 'other' }),
            issue('P-2', { parent: 'P-1', status: 'Done', customer: ACME, assignee: 'me' }),
          ],
          { assigneeMe: true, hideDone: true, hideEmptyCustomers: false, customers: [ACME] },
        ),
      ).toEqual([{ customer: ACME, epics: [], noEpic: [] }])
    })

    it('drops a group whose only view match is a Done child of an open Epic', () => {
      const tree = build(
        [
          issue('P-1', { type: 'Epic', customer: ACME }),
          issue('P-2', { parent: 'P-1', status: 'Done', customer: ACME }),
          issue('P-3', { parent: 'P-1', customer: ACME }),
        ],
        { hideDone: true, match: (i) => i.key === 'P-2' },
      )

      expect(tree).toEqual([])
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

      expect(
        names(build(done, { hideDone: true, hideEmptyCustomers: false, customers: [ACME] })),
      ).toEqual(['Acme'])
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

    it('orders children by key alone, whatever their status', () => {
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
        'P-8',
        'P-7',
        'P-6',
        'P-5',
        'P-4',
        'P-3',
        'P-2',
      ])
    })

    it('orders the No Epic group by key descending, whatever the status', () => {
      const tree = build([
        issue('P-1', { status: 'In Progress', customer: ACME }),
        issue('P-2', { customer: ACME }),
        issue('P-3', { customer: ACME }),
      ])

      expect(keys(tree[0]?.noEpic ?? [])).toEqual(['P-3', 'P-2', 'P-1'])
    })

    it('orders Done children by key descending too', () => {
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

describe('order', () => {
  const epics = [
    issue('P-1', { type: 'Epic', customer: ACME, priority: 'Low', due: '2026-03-01' }),
    issue('P-2', {
      type: 'Epic',
      customer: ACME,
      priority: 'Highest',
      updated: '2026-02-01T00:00:00.000Z',
    }),
    issue('P-3', { type: 'Epic', customer: ACME, priority: 'Medium', due: '2026-02-01' }),
    issue('P-4', { type: 'Epic', customer: ACME }),
  ]
  const children = [
    issue('P-10', {
      parent: 'P-1',
      customer: ACME,
      priority: 'Low',
      due: '2026-05-01',
      updated: '2026-02-01T00:00:00.000Z',
    }),
    issue('P-11', {
      parent: 'P-1',
      customer: ACME,
      priority: 'High',
      due: '2026-04-01',
      updated: '2026-03-01T00:00:00.000Z',
    }),
    issue('P-12', {
      parent: 'P-1',
      customer: ACME,
      priority: 'High',
      updated: '2026-04-01T00:00:00.000Z',
    }),
    issue('P-13', {
      parent: 'P-1',
      customer: ACME,
      status: 'In Progress',
      priority: 'Lowest',
      due: '2026-01-01',
    }),
    issue('P-14', { type: 'Subtask', parent: 'P-11', customer: ACME, priority: 'Low' }),
    issue('P-15', { type: 'Subtask', parent: 'P-11', customer: ACME, priority: 'Highest' }),
  ]
  const loose = [
    issue('P-20', { customer: ACME, priority: 'Low', due: '2026-06-01' }),
    issue('P-21', { customer: ACME, priority: 'High', updated: '2026-06-01T00:00:00.000Z' }),
    issue('P-22', { customer: ACME, priority: 'High', due: '2026-01-01' }),
  ]
  const all = [...epics, ...children, ...loose]
  const group = (order?: HierarchyOptions['order']) => build(all, { order })[0]

  it('keeps the key order when asked for it, and when not asked', () => {
    expect(build(all, { order: 'key' })).toEqual(build(all))
    expect(keys(group('key')?.epics ?? [])).toEqual(['P-4', 'P-3', 'P-2', 'P-1'])
    expect(keys(group('key')?.epics[3]?.children ?? [])).toEqual(['P-13', 'P-12', 'P-11', 'P-10'])
    expect(keys(group('key')?.noEpic ?? [])).toEqual(['P-22', 'P-21', 'P-20'])
  })

  it('sorts by priority, highest first and unrated last, ties by key', () => {
    const g = group('priority')
    expect(keys(g?.epics ?? [])).toEqual(['P-2', 'P-3', 'P-1', 'P-4'])
    // P-10 and P-13 tie on Low and Lowest (one level), so the key decides.
    expect(keys(g?.epics[2]?.children ?? [])).toEqual(['P-12', 'P-11', 'P-13', 'P-10'])
    expect(keys(g?.noEpic ?? [])).toEqual(['P-22', 'P-21', 'P-20'])
  })

  it('sorts a Subtask list too', () => {
    const subtasks = group('priority')?.epics[2]?.children[1]?.children
    expect(keys(subtasks ?? [])).toEqual(['P-15', 'P-14'])
  })

  it('sorts by updated, newest first', () => {
    const g = group('updated')
    expect(keys(g?.epics ?? [])).toEqual(['P-2', 'P-4', 'P-3', 'P-1'])
    expect(keys(g?.epics[3]?.children ?? [])).toEqual(['P-12', 'P-11', 'P-10', 'P-13'])
    expect(keys(g?.noEpic ?? [])).toEqual(['P-21', 'P-22', 'P-20'])
  })

  it('sorts by due date, soonest first and undated last', () => {
    const g = group('due')
    // The undated P-2 and P-4 tie, and Due date runs ascending, so the lower key comes first.
    expect(keys(g?.epics ?? [])).toEqual(['P-3', 'P-1', 'P-2', 'P-4'])
    expect(keys(g?.epics[1]?.children ?? [])).toEqual(['P-13', 'P-11', 'P-10', 'P-12'])
    expect(keys(g?.noEpic ?? [])).toEqual(['P-22', 'P-20', 'P-21'])
  })

  it('keeps the Customer groups in their order, and every issue in its group', () => {
    const grouped = [
      ...all,
      issue('P-30', { type: 'Epic', customer: BETA, priority: 'Highest' }),
      issue('P-31', { type: 'Epic', priority: 'Highest' }),
      issue('P-32', { type: 'Epic', customer: TEAM, priority: 'Highest' }),
    ]
    for (const order of ISSUE_ORDERS) {
      const tree = build(grouped, { order })
      expect(names(tree)).toEqual(['Acme', 'beta', null, 'Collibra (Internal team)'])
      expect(keys(tree[0]?.epics ?? []).toSorted()).toEqual(['P-1', 'P-2', 'P-3', 'P-4'])
    }
  })

  it('moves Done children behind the chip in the chosen order', () => {
    const done = [
      issue('P-1', { type: 'Epic', customer: ACME }),
      issue('P-2', { parent: 'P-1', status: 'Done', priority: 'Low' }),
      issue('P-3', { parent: 'P-1', status: 'Done', priority: 'High' }),
      issue('P-4', { parent: 'P-1' }),
    ]
    const epic = build(done, { order: 'priority' })[0]?.epics[0]
    expect(keys(epic?.doneChildren ?? [])).toEqual(['P-3', 'P-2'])
  })
})

describe('direction', () => {
  const epics = [
    issue('P-1', {
      type: 'Epic',
      customer: ACME,
      status: 'Done',
      priority: 'Low',
      due: '2026-03-01',
    }),
    issue('P-2', {
      type: 'Epic',
      customer: ACME,
      status: 'In Progress',
      priority: 'Highest',
      updated: '2026-02-01T00:00:00.000Z',
    }),
    issue('P-3', {
      type: 'Epic',
      customer: ACME,
      status: 'To Do',
      priority: 'Medium',
      due: '2026-02-01',
    }),
    issue('P-4', { type: 'Epic', customer: ACME, status: 'To Do' }),
    issue('P-5', {
      type: 'Epic',
      customer: ACME,
      status: 'Review',
      priority: 'Low',
      due: '2026-03-01',
    }),
  ]
  const stories = [
    issue('P-10', { parent: 'P-1', status: 'Review', priority: 'Low', due: '2026-05-01' }),
    issue('P-11', { parent: 'P-1', status: 'To Do', priority: 'High', due: '2026-04-01' }),
    issue('P-12', { parent: 'P-1', status: 'To Do', priority: 'High' }),
    issue('P-13', { parent: 'P-1', status: 'Opportunity', priority: 'Low' }),
    issue('P-14', { type: 'Subtask', parent: 'P-11', status: 'In Progress' }),
    issue('P-15', { type: 'Subtask', parent: 'P-11', status: 'To Do' }),
  ]
  const loose = [
    issue('P-20', { customer: ACME, status: 'Hold', due: '2026-06-01' }),
    issue('P-21', { customer: ACME, status: 'To Do' }),
    issue('P-22', { customer: ACME, status: 'To Do', due: '2026-01-01' }),
  ]
  const all = [...epics, ...stories, ...loose]
  const group = (order: HierarchyOptions['order'], direction?: HierarchyOptions['direction']) =>
    build(all, { order, direction })[0]
  // Epic P-1 holds the Stories, and the Subtasks sit under P-11.
  const levels = (g: CustomerGroup | undefined) => ({
    epics: keys(g?.epics ?? []),
    stories: keys(g?.epics.find((e) => e.issue.key === 'P-1')?.children ?? []),
    subtasks: keys(
      g?.epics.find((e) => e.issue.key === 'P-1')?.children.find((c) => c.issue.key === 'P-11')
        ?.children ?? [],
    ),
    noEpic: keys(g?.noEpic ?? []),
  })

  it('runs each order in its own default direction when none is given', () => {
    for (const order of ISSUE_ORDERS)
      expect(levels(group(order))).toEqual(levels(group(order, ORDER_DEFAULT_DIRECTION[order])))
    expect(ORDER_DEFAULT_DIRECTION).toEqual({
      key: 'desc',
      priority: 'desc',
      updated: 'desc',
      due: 'asc',
      status: 'asc',
      manual: 'asc',
    })
  })

  it.each([
    [
      'key',
      'desc',
      {
        epics: ['P-5', 'P-4', 'P-3', 'P-2', 'P-1'],
        stories: ['P-13', 'P-12', 'P-11', 'P-10'],
        subtasks: ['P-15', 'P-14'],
        noEpic: ['P-22', 'P-21', 'P-20'],
      },
    ],
    [
      'key',
      'asc',
      {
        epics: ['P-1', 'P-2', 'P-3', 'P-4', 'P-5'],
        stories: ['P-10', 'P-11', 'P-12', 'P-13'],
        subtasks: ['P-14', 'P-15'],
        noEpic: ['P-20', 'P-21', 'P-22'],
      },
    ],
    [
      'status',
      'asc',
      {
        epics: ['P-3', 'P-4', 'P-2', 'P-5', 'P-1'],
        stories: ['P-13', 'P-11', 'P-12', 'P-10'],
        subtasks: ['P-15', 'P-14'],
        noEpic: ['P-21', 'P-22', 'P-20'],
      },
    ],
    [
      'status',
      'desc',
      {
        epics: ['P-1', 'P-5', 'P-2', 'P-4', 'P-3'],
        stories: ['P-10', 'P-12', 'P-11', 'P-13'],
        subtasks: ['P-14', 'P-15'],
        noEpic: ['P-20', 'P-22', 'P-21'],
      },
    ],
    [
      'priority',
      'desc',
      {
        epics: ['P-2', 'P-3', 'P-5', 'P-1', 'P-4'],
        stories: ['P-12', 'P-11', 'P-13', 'P-10'],
        subtasks: ['P-15', 'P-14'],
        noEpic: ['P-22', 'P-21', 'P-20'],
      },
    ],
    [
      'priority',
      'asc',
      {
        epics: ['P-4', 'P-1', 'P-5', 'P-3', 'P-2'],
        stories: ['P-10', 'P-13', 'P-11', 'P-12'],
        subtasks: ['P-14', 'P-15'],
        noEpic: ['P-20', 'P-21', 'P-22'],
      },
    ],
    [
      'updated',
      'desc',
      {
        epics: ['P-2', 'P-5', 'P-4', 'P-3', 'P-1'],
        stories: ['P-13', 'P-12', 'P-11', 'P-10'],
        subtasks: ['P-15', 'P-14'],
        noEpic: ['P-22', 'P-21', 'P-20'],
      },
    ],
    [
      'updated',
      'asc',
      {
        epics: ['P-1', 'P-3', 'P-4', 'P-5', 'P-2'],
        stories: ['P-10', 'P-11', 'P-12', 'P-13'],
        subtasks: ['P-14', 'P-15'],
        noEpic: ['P-20', 'P-21', 'P-22'],
      },
    ],
    [
      'due',
      'asc',
      {
        epics: ['P-3', 'P-1', 'P-5', 'P-2', 'P-4'],
        stories: ['P-11', 'P-10', 'P-12', 'P-13'],
        subtasks: ['P-14', 'P-15'],
        noEpic: ['P-22', 'P-20', 'P-21'],
      },
    ],
    [
      'due',
      'desc',
      {
        epics: ['P-5', 'P-1', 'P-3', 'P-4', 'P-2'],
        stories: ['P-10', 'P-11', 'P-13', 'P-12'],
        subtasks: ['P-15', 'P-14'],
        noEpic: ['P-20', 'P-22', 'P-21'],
      },
    ],
  ] as const)('orders every level by %s, %s', (order, direction, expected) => {
    expect(levels(group(order, direction))).toEqual(expected)
  })

  it('sorts by key alone under Key, not by status, in both directions', () => {
    const g = (direction: 'asc' | 'desc') => levels(group('key', direction)).stories
    // P-1's Stories are Review, To Do, To Do and Opportunity, which status would reorder.
    expect(g('desc')).toEqual(['P-13', 'P-12', 'P-11', 'P-10'])
    expect(g('asc')).toEqual(['P-10', 'P-11', 'P-12', 'P-13'])
  })

  it.each([
    ['asc', ['P-6', 'P-5', 'P-7', 'P-4', 'P-3', 'P-2']],
    ['desc', ['P-3', 'P-4', 'P-7', 'P-5', 'P-6', 'P-2']],
  ] as const)('puts an unlisted status last under Status %s', (direction, expected) => {
    const tree = build(
      [
        issue('P-1', { type: 'Epic', customer: ACME }),
        issue('P-2', { parent: 'P-1', status: 'Weird' }),
        issue('P-3', { parent: 'P-1', status: 'Hold' }),
        issue('P-4', { parent: 'P-1', status: 'In Progress' }),
        issue('P-5', { parent: 'P-1', status: 'To Do' }),
        issue('P-6', { parent: 'P-1', status: 'Opportunity' }),
        issue('P-7', { parent: 'P-1', status: 'To Do' }),
      ],
      { order: 'status', direction },
    )
    expect(keys(tree[0]?.epics[0]?.children ?? [])).toEqual(expected)
  })

  it('keeps undated issues last under Due date in both directions', () => {
    for (const direction of ['asc', 'desc'] as const) {
      expect(levels(group('due', direction)).noEpic.at(-1)).toBe('P-21')
      expect(levels(group('due', direction)).epics.at(-1)).toBe(
        direction === 'desc' ? 'P-2' : 'P-4',
      )
    }
  })

  it('orders Done children in the chosen direction', () => {
    const done = [
      issue('P-1', { type: 'Epic', customer: ACME }),
      issue('P-2', { parent: 'P-1', status: 'Done' }),
      issue('P-3', { parent: 'P-1', status: 'Done' }),
      issue('P-4', { parent: 'P-1' }),
    ]
    const epic = build(done, { direction: 'asc' })[0]?.epics[0]
    expect(keys(epic?.doneChildren ?? [])).toEqual(['P-2', 'P-3'])
  })

  it('keeps the Customer groups alphabetical, internal last, in both directions', () => {
    const grouped = [
      issue('P-1', { type: 'Epic', customer: BETA }),
      issue('P-2', { type: 'Epic', customer: TEAM }),
      issue('P-3', { type: 'Epic', customer: ACME }),
      issue('P-4', { type: 'Epic' }),
    ]
    for (const direction of ['asc', 'desc'] as const) {
      expect(names(build(grouped, { direction }))).toEqual(['Acme', 'beta', null, TEAM.value])
    }
  })
})

describe('manual order', () => {
  const epics = [
    issue('P-1', { type: 'Epic', customer: ACME }),
    issue('P-2', { type: 'Epic', customer: ACME }),
    issue('P-3', { type: 'Epic', customer: ACME }),
    issue('P-30', { type: 'Epic', customer: BETA }),
    issue('P-31', { type: 'Epic', customer: BETA }),
  ]
  const stories = [
    issue('P-10', { parent: 'P-1', customer: ACME }),
    issue('P-11', { parent: 'P-1', customer: ACME }),
    issue('P-12', { parent: 'P-1', customer: ACME }),
    issue('P-13', { type: 'Subtask', parent: 'P-11', customer: ACME }),
    issue('P-14', { type: 'Subtask', parent: 'P-11', customer: ACME }),
    issue('P-20', { customer: ACME }),
    issue('P-21', { customer: ACME }),
  ]
  const all = [...epics, ...stories]
  const manual = (list: string[], extra: Partial<HierarchyOptions> = {}) =>
    build(all, { order: 'manual', manual: list, ...extra })
  const acme = (groups: CustomerGroup[]) => groups.find((g) => g.customer?.id === ACME.id)
  const kids = (groups: CustomerGroup[], key: string) =>
    keys(acme(groups)?.epics.find((e) => e.issue.key === key)?.children ?? [])

  it('orders every level by the list, siblings only', () => {
    const tree = manual(['P-21', 'P-3', 'P-12', 'P-14', 'P-1', 'P-13', 'P-10', 'P-2', 'P-20'])
    expect(keys(acme(tree)?.epics ?? [])).toEqual(['P-3', 'P-1', 'P-2'])
    expect(kids(tree, 'P-1')).toEqual(['P-12', 'P-10', 'P-11'])
    expect(
      keys(
        acme(tree)
          ?.epics.find((e) => e.issue.key === 'P-1')
          ?.children.find((c) => c.issue.key === 'P-11')?.children ?? [],
      ),
    ).toEqual(['P-14', 'P-13'])
    expect(keys(acme(tree)?.noEpic ?? [])).toEqual(['P-21', 'P-20'])
  })

  it('puts an issue the list does not name after the named ones, by key ascending', () => {
    const tree = manual(['P-2', 'P-12'])
    expect(keys(acme(tree)?.epics ?? [])).toEqual(['P-2', 'P-1', 'P-3'])
    expect(kids(tree, 'P-1')).toEqual(['P-12', 'P-10', 'P-11'])
    expect(keys(acme(tree)?.noEpic ?? [])).toEqual(['P-20', 'P-21'])
  })

  it('orders every issue by key ascending when the list is empty or absent', () => {
    expect(kids(manual([]), 'P-1')).toEqual(['P-10', 'P-11', 'P-12'])
    expect(kids(build(all, { order: 'manual' }), 'P-1')).toEqual(['P-10', 'P-11', 'P-12'])
  })

  it('ignores a key naming no loaded issue, and a key listed twice counts at its first place', () => {
    const tree = manual(['P-99', 'P-12', 'P-5', 'P-10', 'P-12', 'P-11'])
    expect(kids(tree, 'P-1')).toEqual(['P-12', 'P-10', 'P-11'])
  })

  it('ignores the direction', () => {
    const list = ['P-3', 'P-1', 'P-2']
    expect(manual(list, { direction: 'desc' })).toEqual(manual(list, { direction: 'asc' }))
  })

  it('keeps the Customer groups in their own order', () => {
    const tree = manual(['P-31', 'P-30', 'P-3', 'P-2', 'P-1'])
    expect(names(tree)).toEqual(['Acme', 'beta'])
    expect(keys(tree[1]?.epics ?? [])).toEqual(['P-31', 'P-30'])
  })

  it('does not read the list under another order', () => {
    const tree = build(all, { order: 'key', manual: ['P-3', 'P-2', 'P-1'] })
    expect(keys(acme(tree)?.epics ?? [])).toEqual(['P-3', 'P-2', 'P-1'])
    const asc = build(all, { order: 'key', direction: 'asc', manual: ['P-3', 'P-2', 'P-1'] })
    expect(keys(acme(asc)?.epics ?? [])).toEqual(['P-1', 'P-2', 'P-3'])
  })

  it('orders the Done children behind a chip by the list too', () => {
    const withDone = [
      ...all,
      issue('P-40', { parent: 'P-1', customer: ACME, status: 'Done' }),
      issue('P-41', { parent: 'P-1', customer: ACME, status: 'Done' }),
    ]
    const epic = build(withDone, { order: 'manual', manual: ['P-41', 'P-40'] })[0]?.epics[0]
    expect(keys(epic?.doneChildren ?? [])).toEqual(['P-41', 'P-40'])
  })

  it('treeOrder seeds a list that rebuilds the tree the groups show', () => {
    const shown = build(all, { order: 'priority', direction: 'asc' })
    expect(treeOrder(shown)).toHaveLength(all.length)
    expect(manual(treeOrder(shown))).toEqual(shown)
  })

  it('siblingKeys names the issues that share a parent, in display order', () => {
    const tree = manual(['P-12', 'P-11', 'P-10'])
    expect(siblingKeys(tree, 'P-10')).toEqual(['P-12', 'P-11', 'P-10'])
    expect(siblingKeys(tree, 'P-14')).toEqual(['P-13', 'P-14'])
    expect(siblingKeys(tree, 'P-2')).toEqual(['P-1', 'P-2', 'P-3'])
    expect(siblingKeys(tree, 'P-30')).toEqual(['P-30', 'P-31'])
    expect(siblingKeys(tree, 'P-21')).toEqual(['P-20', 'P-21'])
    expect(siblingKeys(tree, 'P-404')).toBeUndefined()
  })

  it('sortedByManual puts keys in the list order, then the unnamed ones by key number', () => {
    expect(sortedByManual(['P-10', 'P-9', 'P-2', 'P-1'], ['P-2', 'P-10'])).toEqual([
      'P-2',
      'P-10',
      'P-1',
      'P-9',
    ])
  })

  describe('fitManualOrder', () => {
    const loaded = new Set(['A', 'B'])

    it('keeps a list within the cap whole, loaded or not', () => {
      expect(fitManualOrder(['A', 'GONE', 'B'], loaded)).toEqual(['A', 'GONE', 'B'])
    })

    it('drops the keys of issues no longer loaded once the list passes the cap', () => {
      const long = [
        'A',
        ...Array.from({ length: MANUAL_ORDER_LIMIT }, (_, i) => `GONE-${String(i)}`),
        'B',
      ]
      expect(fitManualOrder(long, loaded)).toEqual(['A', 'B'])
    })

    it('trims the tail when loaded issues alone pass the cap', () => {
      const keys = Array.from({ length: MANUAL_ORDER_LIMIT + 5 }, (_, i) => `P-${String(i)}`)
      const fitted = fitManualOrder(keys, new Set(keys))
      expect(fitted).toHaveLength(MANUAL_ORDER_LIMIT)
      expect(fitted[0]).toBe('P-0')
    })
  })

  describe('moveInManualOrder', () => {
    it.each([
      [['A', 'B', 'C'], 0, 2, ['B', 'C', 'A']],
      [['A', 'B', 'C'], 2, 0, ['C', 'A', 'B']],
      [['A', 'B', 'C'], 1, 1, ['A', 'B', 'C']],
      [['A', 'B', 'C'], 0, 9, ['B', 'C', 'A']],
      [['A', 'B', 'C'], 2, -3, ['C', 'A', 'B']],
    ])('moves %j from %i to %i', (siblings, from, to, expected) => {
      const key = siblings[from] ?? ''
      expect(moveInManualOrder(siblings, siblings, key, to)).toEqual(expected)
    })

    it('leaves a sibling the user cannot see where it sat between the others', () => {
      // H is filtered out of view, so it is not among the siblings on screen.
      expect(moveInManualOrder(['A', 'H', 'B'], ['A', 'B'], 'B', 0)).toEqual(['B', 'H', 'A'])
    })

    it('keeps entries of other parents and names the unnamed siblings after the named ones', () => {
      expect(moveInManualOrder(['X', 'A', 'Y'], ['A', 'U'], 'U', 0)).toEqual(['X', 'U', 'Y', 'A'])
    })

    it('names the whole list from scratch', () => {
      expect(moveInManualOrder([], ['A', 'B', 'C'], 'C', 0)).toEqual(['C', 'A', 'B'])
    })

    it('drops a repeated key and leaves a key outside the siblings alone', () => {
      expect(moveInManualOrder(['A', 'B', 'A'], ['A', 'B'], 'A', 1)).toEqual(['B', 'A'])
      expect(moveInManualOrder(['A', 'B'], ['A', 'B'], 'Z', 0)).toEqual(['A', 'B'])
    })

    it('gives a tree that shows the move and no other sibling list changed', () => {
      const shown = manual(treeOrder(build(all)))
      const siblings = siblingKeys(shown, 'P-12') ?? []
      const next = moveInManualOrder(treeOrder(shown), siblings, 'P-12', 0)
      const moved = manual(next)
      expect(kids(moved, 'P-1')).toEqual([
        'P-12',
        ...kids(shown, 'P-1').filter((k) => k !== 'P-12'),
      ])
      expect(keys(acme(moved)?.epics ?? [])).toEqual(keys(acme(shown)?.epics ?? []))
      expect(keys(acme(moved)?.noEpic ?? [])).toEqual(keys(acme(shown)?.noEpic ?? []))
    })
  })
})

describe('STATUS_ORDER', () => {
  it('runs Opportunity, To Do, In Progress, Review, Hold, Done', () => {
    expect(STATUS_ORDER).toEqual(['Opportunity', 'To Do', 'In Progress', 'Review', 'Hold', 'Done'])
  })
})

describe('childProgress', () => {
  const issues = [
    issue('P-1', { type: 'Epic', customer: ACME }),
    issue('P-2', { parent: 'P-1', customer: ACME }),
    issue('P-3', { parent: 'P-1', customer: ACME, status: 'Done' }),
    issue('P-4', { parent: 'P-1', customer: ACME, status: 'Done' }),
    issue('P-5', { type: 'Subtask', parent: 'P-2', customer: ACME, status: 'Done' }),
    issue('P-6', { type: 'Epic', customer: BETA }),
    issue('P-7', { type: 'Subtask', parent: 'P-99' }),
  ]

  it('counts the direct children of each parent, Done by status category', () => {
    const progress = childProgress(issues)
    expect(progress.get('P-1')).toEqual({ done: 2, total: 3 })
    // A Story's Subtasks count too, and a Subtask of an unloaded parent counts for nobody.
    expect(progress.get('P-2')).toEqual({ done: 1, total: 1 })
    expect(progress.has('P-99')).toBe(false)
    expect(progress.has('P-6')).toBe(false)
  })

  it("agrees with buildHierarchy's children and Done chip when Done shows", () => {
    const epic = build(issues)
      .flatMap((g) => g.epics)
      .find((n) => n.issue.key === 'P-1')
    const total = (epic?.children.length ?? 0) + (epic?.doneCount ?? 0)
    const done = [...(epic?.children ?? []), ...(epic?.doneChildren ?? [])].filter(
      (n) => n.issue.status.category === 'done',
    ).length
    expect(childProgress(issues).get('P-1')).toEqual({ done, total })
  })

  it('still counts the Done children that "Hide done" removes from the Tree', () => {
    const epic = build(issues, { hideDone: true })
      .flatMap((g) => g.epics)
      .find((n) => n.issue.key === 'P-1')
    expect(epic?.doneCount).toBe(0)
    expect(childProgress(issues).get('P-1')).toEqual({ done: 2, total: 3 })
  })

  it('does not count an Epic as the child of another', () => {
    const progress = childProgress([
      issue('P-1', { type: 'Epic' }),
      issue('P-2', { type: 'Epic', parent: 'P-1' }),
    ])
    expect(progress.has('P-1')).toBe(false)
  })

  it('has an entry only for what the loaded issues name', () => {
    expect(childProgress([]).size).toBe(0)
  })
})

describe('customerTotals', () => {
  const issues = [
    issue('P-1', { type: 'Epic', customer: ACME }),
    issue('P-2', { parent: 'P-1', customer: ACME }),
    issue('P-3', { parent: 'P-1', customer: ACME, status: 'Done' }),
    issue('P-4', { customer: TEAM }),
    issue('P-5'),
  ]

  it('counts open and Done issues by their own Customer, Epics included', () => {
    const totals = customerTotals(issues, [ACME, BETA, TEAM])
    expect(totals.find((t) => t.customer.id === ACME.id)).toMatchObject({ open: 2, done: 1 })
    expect(totals.find((t) => t.customer.id === TEAM.id)).toMatchObject({ open: 1, done: 0 })
  })

  it('lists every Customer given, with zeros for one that holds no issue', () => {
    const totals = customerTotals(issues, [ACME, BETA, TEAM])
    expect(totals.find((t) => t.customer.id === BETA.id)).toEqual({
      customer: BETA,
      open: 0,
      done: 0,
    })
  })

  it('adds a Customer only the issues name, and counts an issue with no Customer for none', () => {
    expect(customerTotals(issues, []).map((t) => t.customer.value)).toEqual([
      'Acme',
      'Collibra (Internal team)',
    ])
    expect(customerTotals([issue('P-1', { customer: ACME })], [ACME])).toHaveLength(1)
  })

  it("sorts as the Tree's groups do: ordinary Customers, then the internal ones", () => {
    const names = customerTotals(issues, [TEAM, BETA, ACME, TEMPLATE]).map((t) => t.customer.value)
    expect(names).toEqual([
      'Acme',
      'beta',
      'Collibra (Internal team)',
      'Collibra (Internal template)',
    ])
  })

  it('counts the same issues the Tree holds under each Customer filter', () => {
    const matched = (customer: string) =>
      build(issues, { match: (i) => i.customer?.value === customer })
        .flatMap((g) => g.epics.concat(g.noEpic))
        .flatMap(function flat(n): HierarchyNode[] {
          return [n, ...n.children.flatMap(flat), ...n.doneChildren.flatMap(flat)]
        })
        .filter((n) => !n.contextOnly).length
    const acme = customerTotals(issues, [ACME]).find((t) => t.customer.id === ACME.id)
    expect(matched('Acme')).toBe((acme?.open ?? 0) + (acme?.done ?? 0))
  })
})
