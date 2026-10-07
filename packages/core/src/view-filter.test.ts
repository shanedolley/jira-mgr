import { describe, expect, it } from 'vitest'

import { loadFixture } from '../test/msw.js'
import { buildHierarchy, type CustomerGroup, type HierarchyNode } from './hierarchy.js'
import { issueSchema, type Issue } from './issue.js'
import type { SavedView } from './state.js'
import { applyViewToggles, filterIssues, issueMatcher, type ViewFilters } from './view-filter.js'

const ME = 'acc-me'
const ctx = { accountId: ME }

interface Spec {
  summary?: string
  type?: string
  status?: string
  assignee?: string
  labels?: string[]
  sprints?: { id: number; name: string; state: string }[]
  parent?: string
}

function issue(key: string, spec: Spec = {}): Issue {
  const status = spec.status ?? 'To Do'
  const type = spec.type ?? 'Story'
  return {
    id: key,
    key,
    summary: spec.summary ?? 'Summary',
    issueType: {
      id: `t-${type}`,
      name: type,
      subtask: false,
      hierarchyLevel: type === 'Epic' ? 1 : 0,
    },
    status: { id: `s-${status}`, name: status, category: status === 'Done' ? 'done' : 'new' },
    resolution: null,
    parentKey: spec.parent ?? null,
    assignee: spec.assignee
      ? { accountId: spec.assignee, displayName: spec.assignee, avatarUrl: null }
      : null,
    labels: spec.labels ?? [],
    priority: null,
    customer: null,
    engagement: null,
    sprints: spec.sprints ?? [],
    startDate: null,
    dueDate: null,
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null,
    timeRemainingHours: null,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
  }
}

const keys = (issues: Issue[]) => issues.map((i) => i.key)
const filter = (issues: Issue[], filters: ViewFilters) => keys(filterIssues(issues, filters, ctx))

const ACTIVE = { id: 1, name: 'Sprint 1', state: 'active' }
const FUTURE = { id: 2, name: 'Sprint 2', state: 'future' }
const CLOSED = { id: 3, name: 'Sprint 0', state: 'closed' }

describe('issueMatcher', () => {
  it('selects everything when no filter is set', () => {
    const all = [issue('P-1'), issue('P-2', { assignee: 'x' })]
    expect(issueMatcher({}, ctx)).toBeUndefined()
    expect(issueMatcher({ assignee: [], status: [], text: '  ' }, ctx)).toBeUndefined()
    expect(filter(all, {})).toEqual(['P-1', 'P-2'])
    expect(filter(all, { label: [], sprint: [], text: '' })).toEqual(['P-1', 'P-2'])
  })

  describe('assignee', () => {
    const all = [
      issue('P-1', { assignee: ME }),
      issue('P-2', { assignee: 'other' }),
      issue('P-3'),
      issue('P-4', { assignee: 'third' }),
    ]

    it('matches an accountId', () => {
      expect(filter(all, { assignee: ['other'] })).toEqual(['P-2'])
    })

    it('matches "me" as the signed-in user', () => {
      expect(filter(all, { assignee: ['me'] })).toEqual(['P-1'])
      expect(keys(filterIssues(all, { assignee: ['me'] }, { accountId: 'other' }))).toEqual(['P-2'])
    })

    it('matches "unassigned"', () => {
      expect(filter(all, { assignee: ['unassigned'] })).toEqual(['P-3'])
    })

    it('reads "me" and "unassigned" in any case', () => {
      expect(filter(all, { assignee: ['Me'] })).toEqual(['P-1'])
      expect(filter(all, { assignee: ['UNASSIGNED'] })).toEqual(['P-3'])
    })

    it('ORs the values', () => {
      expect(filter(all, { assignee: ['me', 'unassigned', 'third'] })).toEqual([
        'P-1',
        'P-3',
        'P-4',
      ])
    })
  })

  describe('status and type', () => {
    const all = [
      issue('P-1', { status: 'In Progress', type: 'Bug' }),
      issue('P-2', { status: 'To Do', type: 'Story' }),
      issue('P-3', { status: 'Done', type: 'Epic' }),
    ]

    it('matches a status by name in any case, or by id', () => {
      expect(filter(all, { status: ['in progress'] })).toEqual(['P-1'])
      expect(filter(all, { status: ['s-Done'] })).toEqual(['P-3'])
      expect(filter(all, { status: ['to do', 'DONE'] })).toEqual(['P-2', 'P-3'])
    })

    it('matches a type by name in any case, or by id', () => {
      expect(filter(all, { type: ['BUG'] })).toEqual(['P-1'])
      expect(filter(all, { type: ['t-Epic'] })).toEqual(['P-3'])
      expect(filter(all, { type: ['story', 'epic'] })).toEqual(['P-2', 'P-3'])
    })
  })

  describe('label', () => {
    const all = [
      issue('P-1', { labels: ['a', 'b'] }),
      issue('P-2', { labels: ['c'] }),
      issue('P-3', { labels: ['A'] }),
      issue('P-4'),
    ]

    it('matches any of the issue labels, exactly', () => {
      expect(filter(all, { label: ['b'] })).toEqual(['P-1'])
      expect(filter(all, { label: ['b', 'c'] })).toEqual(['P-1', 'P-2'])
      expect(filter(all, { label: ['a'] })).toEqual(['P-1'])
    })
  })

  describe('sprint', () => {
    const all = [
      issue('P-1', { sprints: [ACTIVE] }),
      issue('P-2', { sprints: [FUTURE] }),
      issue('P-3', { sprints: [CLOSED] }),
      issue('P-4', { sprints: [CLOSED, ACTIVE] }),
      issue('P-5'),
    ]

    it('matches "current" to any active sprint only', () => {
      expect(filter(all, { sprint: ['current'] })).toEqual(['P-1', 'P-4'])
    })

    it('matches a sprint by id or by name in any case', () => {
      expect(filter(all, { sprint: ['2'] })).toEqual(['P-2'])
      expect(filter(all, { sprint: ['sprint 0'] })).toEqual(['P-3', 'P-4'])
    })

    it('reads "current" in any case, and it beats a sprint named "Current"', () => {
      const named = issue('P-6', { sprints: [{ id: 9, name: 'Current', state: 'closed' }] })
      expect(filter([...all, named], { sprint: ['Current'] })).toEqual(['P-1', 'P-4'])
    })

    it('ORs ids, names and "current"', () => {
      expect(filter(all, { sprint: ['current', '2', 'Sprint 0'] })).toEqual([
        'P-1',
        'P-2',
        'P-3',
        'P-4',
      ])
    })
  })

  describe('text', () => {
    const all = [
      issue('PSAPAC-12', { summary: 'Fix login' }),
      issue('PSAPAC-34', { summary: 'Add LOGIN page' }),
      issue('PSAPAC-56', { summary: 'Unrelated' }),
    ]

    it('matches the summary in any case', () => {
      expect(filter(all, { text: 'login' })).toEqual(['PSAPAC-12', 'PSAPAC-34'])
    })

    it('matches the key in any case', () => {
      expect(filter(all, { text: 'psapac-34' })).toEqual(['PSAPAC-34'])
      expect(filter(all, { text: '-5' })).toEqual(['PSAPAC-56'])
    })

    it('trims the text, and a blank text filters nothing', () => {
      expect(filter(all, { text: '  Fix login \n' })).toEqual(['PSAPAC-12'])
      expect(filter(all, { text: ' \t ' })).toHaveLength(3)
    })
  })

  it('ANDs fields and ORs values within each', () => {
    const all = [
      issue('P-1', { assignee: ME, status: 'To Do', summary: 'login' }),
      issue('P-2', { assignee: ME, status: 'Done', summary: 'login' }),
      issue('P-3', { assignee: 'other', status: 'To Do', summary: 'login' }),
      issue('P-4', { assignee: ME, status: 'To Do', summary: 'other' }),
      issue('P-5', { assignee: ME, status: 'In Progress', summary: 'login' }),
    ]
    expect(
      filter(all, { assignee: ['me'], status: ['To Do', 'In Progress'], text: 'login' }),
    ).toEqual(['P-1', 'P-5'])
  })
})

describe('applyViewToggles', () => {
  it("lets the view's toggles win over the settings'", () => {
    const view: SavedView = {
      id: 'v',
      name: 'V',
      filters: {},
      toggles: { hideDone: false, assigneeMe: true, hideEmptyCustomers: false },
    }
    expect(
      applyViewToggles({ hideDone: true, assigneeMe: false, hideEmptyCustomers: true }, view),
    ).toEqual(view.toggles)
  })
})

describe('with buildHierarchy', () => {
  const tree = (issues: Issue[], filters: ViewFilters, hideDone = false) =>
    buildHierarchy(issues, {
      hideDone,
      assigneeMe: false,
      hideEmptyCustomers: true,
      accountId: ME,
      match: issueMatcher(filters, ctx),
    })
  const walk = (nodes: HierarchyNode[]): string[] =>
    nodes.flatMap((n) => [n.issue.key, ...walk(n.children), ...walk(n.doneChildren)])
  const placed = (groups: CustomerGroup[]) => groups.flatMap((g) => walk([...g.epics, ...g.noEpic]))

  it('keeps the Epic of a matching Story as context', () => {
    const issues = [
      issue('P-1', { type: 'Epic' }),
      issue('P-2', { parent: 'P-1', labels: ['x'] }),
      issue('P-3', { parent: 'P-1' }),
    ]
    const groups = tree(issues, { label: ['x'] })
    expect(placed(groups)).toEqual(['P-1', 'P-2'])
    expect(groups[0]?.epics[0]?.contextOnly).toBe(true)
    expect(groups[0]?.epics[0]?.children[0]?.contextOnly).toBe(false)
  })

  it('keeps a Done Epic as context for a matching open child without "Assignee: me"', () => {
    const issues = [
      issue('P-1', { type: 'Epic', status: 'Done' }),
      issue('P-2', { parent: 'P-1', labels: ['x'] }),
    ]
    const groups = tree(issues, { label: ['x'] }, true)
    expect(placed(groups)).toEqual(['P-1', 'P-2'])
    expect(groups[0]?.epics[0]?.contextOnly).toBe(true)
  })

  it('changes nothing when the filters are empty', () => {
    const issues = [issue('P-1', { type: 'Epic', status: 'Done' }), issue('P-2', { parent: 'P-1' })]
    expect(tree(issues, {}, true)).toEqual(
      buildHierarchy(issues, {
        hideDone: true,
        assigneeMe: false,
        hideEmptyCustomers: true,
        accountId: ME,
      }),
    )
  })

  it('combines with "Assignee: me"', () => {
    const issues = [
      issue('P-1', { assignee: ME, labels: ['x'] }),
      issue('P-2', { assignee: ME }),
      issue('P-3', { labels: ['x'] }),
    ]
    const groups = buildHierarchy(issues, {
      hideDone: false,
      assigneeMe: true,
      hideEmptyCustomers: true,
      accountId: ME,
      match: issueMatcher({ label: ['x'] }, ctx),
    })
    expect(placed(groups)).toEqual(['P-1'])
  })
})

describe('recorded fixtures', () => {
  const IDS = {
    customer: 'customfield_14849',
    engagement: 'customfield_14850',
    sprint: 'customfield_10600',
    startDate: 'customfield_13808',
    timeRemaining: 'customfield_21785',
  }
  const all = [
    ...new Map(
      ['search-unresolved-1', 'search-unresolved-2', 'search-done-1', 'search-done-2']
        .flatMap((name) => (loadFixture(name) as unknown as { issues: unknown[] }).issues)
        .map((raw) => issueSchema(IDS).parse(raw))
        .map((i) => [i.key, i]),
    ).values(),
  ]
  const owner = '712020:e741f0cf-583b-48aa-8b81-6bc8e44cd370'

  it('selects everything with no filter', () => {
    expect(filterIssues(all, {}, ctx)).toEqual(all)
  })

  it('finds the issues in the active sprint, and none that are not', () => {
    const current = filterIssues(all, { sprint: ['current'] }, ctx)
    expect(current.length).toBeGreaterThan(0)
    expect(current.length).toBeLessThan(all.length)
    expect(current.every((i) => i.sprints.some((s) => s.state === 'active'))).toBe(true)
    expect(
      all
        .filter((i) => !current.includes(i))
        .some((i) => i.sprints.some((s) => s.state === 'active')),
    ).toBe(false)
  })

  it('matches "me" as a recorded accountId and splits the rest from "unassigned"', () => {
    const mine = filterIssues(all, { assignee: ['me'] }, { accountId: owner })
    expect(mine.length).toBeGreaterThan(0)
    expect(mine).toEqual(filterIssues(all, { assignee: [owner] }, ctx))
    const split = [
      ...mine,
      ...filterIssues(all, { assignee: ['unassigned'] }, ctx),
      ...all.filter((i) => i.assignee !== null && i.assignee.accountId !== owner),
    ]
    expect(split.map((i) => i.key).toSorted()).toEqual(all.map((i) => i.key).toSorted())
  })

  it('narrows by status and type, case-insensitively, and ANDs them', () => {
    const done = filterIssues(all, { status: ['done'] }, ctx)
    const epics = filterIssues(all, { type: ['EPIC'] }, ctx)
    expect(done.length).toBeGreaterThan(0)
    expect(epics.length).toBeGreaterThan(0)
    expect(done.every((i) => i.status.name === 'Done')).toBe(true)
    expect(epics.every((i) => i.issueType.name === 'Epic')).toBe(true)
    expect(keys(filterIssues(all, { status: ['done'], type: ['epic'] }, ctx))).toEqual(
      keys(done.filter((i) => epics.includes(i))),
    )
  })

  it('finds a recorded issue by key and by a summary word', () => {
    const first = all.find((i) => /\w/.test(i.summary))
    if (first === undefined) throw new Error('No recorded issue has a summary.')
    const word = first.summary.trim().split(/\s+/)[0] ?? ''
    expect(filterIssues(all, { text: ` ${first.key.toLowerCase()} ` }, ctx)).toContain(first)
    expect(filterIssues(all, { text: word.toUpperCase() }, ctx)).toContain(first)
  })

  it('keeps every filtered issue placed once in the hierarchy', () => {
    const groups = buildHierarchy(all, {
      hideDone: false,
      assigneeMe: false,
      hideEmptyCustomers: true,
      accountId: owner,
      match: issueMatcher({ sprint: ['current'] }, ctx),
    })
    const walk = (nodes: HierarchyNode[]): HierarchyNode[] =>
      nodes.flatMap((n) => [n, ...walk(n.children), ...walk(n.doneChildren)])
    const nodes = groups.flatMap((g) => walk([...g.epics, ...g.noEpic]))
    const matched = filterIssues(all, { sprint: ['current'] }, ctx)
    expect(
      nodes
        .filter((n) => !n.contextOnly)
        .map((n) => n.issue.key)
        .toSorted(),
    ).toEqual(keys(matched).toSorted())
  })
})
