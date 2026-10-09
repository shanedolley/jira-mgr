import type { Issue } from '@jira-mgr/core'
import { buildHierarchy, type CustomerGroup, type HierarchyOptions } from '@jira-mgr/core/hierarchy'
import { describe, expect, it } from 'vitest'

import {
  clickRow,
  expandableIds,
  fallbackRow,
  flattenTree,
  indexNodes,
  issuesShown,
  mergeIssues,
  moveActive,
  windowRange,
  type KeyInput,
  type MoveContext,
  type TreeRow,
  type TreeState,
} from './tree'

const ACME = { id: '1', value: 'Acme' }
const BETA = { id: '2', value: 'Beta Ltd' }
const EMPTY = { id: '3', value: 'Zeta' }

const TYPES = {
  Epic: { id: '1', name: 'Epic', subtask: false, hierarchyLevel: 1 },
  Story: { id: '2', name: 'Story', subtask: false, hierarchyLevel: 0 },
  Subtask: { id: '3', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
}

interface Spec {
  type?: keyof typeof TYPES
  status?: string
  parent?: string
  customer?: { id: string; value: string }
  updated?: string
}

function issue(key: string, spec: Spec = {}): Issue {
  const status = spec.status ?? 'To Do'
  return {
    id: key,
    key,
    summary: `Summary of ${key}`,
    issueType: TYPES[spec.type ?? 'Story'],
    status: { id: status, name: status, category: status === 'Done' ? 'done' : 'new' },
    resolution: null,
    parentKey: spec.parent ?? null,
    assignee: null,
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
    updated: spec.updated ?? '2026-01-01T00:00:00.000Z',
  }
}

const OPTIONS: HierarchyOptions = {
  hideDone: false,
  assigneeMe: false,
  hideEmptyCustomers: true,
  accountId: 'me',
}
const groupsOf = (issues: Issue[], options: Partial<HierarchyOptions> = {}): CustomerGroup[] =>
  buildHierarchy(issues, { ...OPTIONS, ...options })

const NONE = { collapsed: new Set<string>(), revealed: new Set<string>() }
const ids = (rows: TreeRow[]) => rows.map((r) => r.id)

/** Acme: Epic P-1 with Story P-2 (Subtask P-3), In Progress Story P-4 and a Done Story P-5; a No Epic Story P-6. */
const SAMPLE = [
  issue('P-1', { type: 'Epic', customer: ACME }),
  issue('P-2', { parent: 'P-1', customer: ACME }),
  issue('P-3', { type: 'Subtask', parent: 'P-2', customer: ACME }),
  issue('P-4', { parent: 'P-1', customer: ACME, status: 'In Progress' }),
  issue('P-5', { parent: 'P-1', customer: ACME, status: 'Done' }),
  issue('P-6', { customer: ACME }),
]

describe('mergeIssues', () => {
  it('keeps one copy of an issue both phases hold, the later updated', () => {
    const stale = issue('P-1', { updated: '2026-01-01T00:00:00.000Z' })
    const fresh = issue('P-1', { status: 'Done', updated: '2026-01-02T00:00:00.000Z' })

    expect(mergeIssues([stale], [fresh])).toEqual([fresh])
    // A reopened issue: Done last loaded earlier, so the unresolved copy is newer.
    expect(mergeIssues([fresh], [stale])).toEqual([fresh])
    expect(mergeIssues([stale], [fresh])).toHaveLength(1)
  })

  it('keeps the unresolved copy when both have the same updated', () => {
    const unresolved = issue('P-1', { status: 'In Progress' })
    const done = issue('P-1', { status: 'Done' })

    expect(mergeIssues([unresolved], [done])).toEqual([unresolved])
  })

  it('lists unresolved issues, then the Done ones', () => {
    const merged = mergeIssues([issue('P-2'), issue('P-1')], [issue('P-9', { status: 'Done' })])

    expect(merged.map((i) => i.key)).toEqual(['P-2', 'P-1', 'P-9'])
  })
})

describe('flattenTree', () => {
  it('lists Customer, Epic, child and Subtask rows in tree order at levels 1 to 4', () => {
    const rows = flattenTree(groupsOf(SAMPLE), NONE)

    expect(rows.map((r) => [r.id, r.level])).toEqual([
      ['c:1', 1],
      ['i:P-1', 2],
      ['i:P-2', 3],
      ['i:P-3', 4],
      ['i:P-4', 3],
      ['d:P-1', 3],
      ['n:1', 2],
      ['i:P-6', 3],
    ])
  })

  it("puts the No Epic header after a Customer's Epics at level 2", () => {
    const rows = flattenTree(groupsOf(SAMPLE), NONE)
    const noEpic = rows.find((r) => r.kind === 'noEpic')

    expect(noEpic).toMatchObject({ id: 'n:1', level: 2, parentId: 'c:1', count: 1 })
    expect(rows.findIndex((r) => r.id === 'n:1')).toBeGreaterThan(
      rows.findIndex((r) => r.id === 'i:P-1'),
    )
  })

  it('keys a Customer-less group and its No Epic header as none', () => {
    const rows = flattenTree(groupsOf([issue('P-1')]), NONE)

    expect(ids(rows)).toEqual(['c:none', 'n:none', 'i:P-1'])
  })

  it("hides a collapsed Customer's rows and a collapsed issue's subtree", () => {
    const groups = groupsOf(SAMPLE)

    expect(ids(flattenTree(groups, { ...NONE, collapsed: new Set(['c:1']) }))).toEqual(['c:1'])
    const noStory = flattenTree(groups, { ...NONE, collapsed: new Set(['i:P-2']) })
    expect(ids(noStory)).not.toContain('i:P-3')
    expect(ids(noStory)).toContain('i:P-4')
    expect(noStory.find((r) => r.id === 'i:P-2')).toMatchObject({
      expandable: true,
      expanded: false,
    })
    // A collapsed No Epic header hides its issues.
    const noEpic = flattenTree(groups, { ...NONE, collapsed: new Set(['n:1']) })
    expect(ids(noEpic)).toContain('n:1')
    expect(ids(noEpic)).not.toContain('i:P-6')
    // A collapsed Epic hides its chip too.
    expect(ids(flattenTree(groups, { ...NONE, collapsed: new Set(['i:P-1']) }))).not.toContain(
      'd:P-1',
    )
  })

  it("adds an N done chip after an open parent's children", () => {
    const rows = flattenTree(groupsOf(SAMPLE), NONE)
    const chip = rows.find((r) => r.kind === 'chip')

    expect(chip).toMatchObject({
      id: 'd:P-1',
      parentId: 'i:P-1',
      parentKey: 'P-1',
      doneCount: 1,
      expandable: true,
      expanded: false,
    })
    // After the last child's subtree, not before it.
    expect(ids(rows).indexOf('d:P-1')).toBeGreaterThan(ids(rows).indexOf('i:P-3'))
  })

  it('lists Done children under a revealed chip, one level down', () => {
    const rows = flattenTree(groupsOf(SAMPLE), { ...NONE, revealed: new Set(['d:P-1']) })
    const chip = rows.find((r) => r.id === 'd:P-1')
    const done = rows.find((r) => r.id === 'i:P-5')

    expect(chip).toMatchObject({ expanded: true, level: 3 })
    expect(done).toMatchObject({ level: 4, parentId: 'd:P-1' })
    expect(ids(rows).indexOf('i:P-5')).toBe(ids(rows).indexOf('d:P-1') + 1)
  })

  it('gives an empty Customer group a header that cannot expand', () => {
    const groups = groupsOf(SAMPLE, { hideEmptyCustomers: false, customers: [ACME, EMPTY] })
    const empty = flattenTree(groups, NONE).find((r) => r.id === 'c:3')

    expect(empty).toMatchObject({ kind: 'customer', expandable: false, expanded: false, count: 0 })
  })

  it('numbers siblings with setSize and posInSet, chips included', () => {
    const rows = flattenTree(groupsOf(SAMPLE), NONE)
    const at = (id: string) => rows.find((r) => r.id === id)

    // Under Epic P-1: P-2 (To Do), P-4 (In Progress), then the chip.
    expect([at('i:P-2'), at('i:P-4'), at('d:P-1')].map((r) => [r?.posInSet, r?.setSize])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    // Under Acme: the Epic, then the No Epic header.
    expect([at('i:P-1'), at('n:1')].map((r) => [r?.posInSet, r?.setSize])).toEqual([
      [1, 2],
      [2, 2],
    ])
    expect([at('c:1')].map((r) => [r?.posInSet, r?.setSize])).toEqual([[1, 1]])
  })

  it('numbers Customers among the top-level siblings', () => {
    const rows = flattenTree(
      groupsOf([issue('P-1', { customer: ACME }), issue('P-2', { customer: BETA })]),
      NONE,
    )

    expect(
      rows.filter((r) => r.kind === 'customer').map((r) => [r.id, r.posInSet, r.setSize]),
    ).toEqual([
      ['c:1', 1, 2],
      ['c:2', 2, 2],
    ])
  })

  it('gives each row its parentId and expandable flag', () => {
    const rows = flattenTree(groupsOf(SAMPLE), NONE)

    expect(rows.map((r) => [r.id, r.parentId, r.expandable])).toEqual([
      ['c:1', null, true],
      ['i:P-1', 'c:1', true],
      ['i:P-2', 'i:P-1', true],
      ['i:P-3', 'i:P-2', false],
      ['i:P-4', 'i:P-1', false],
      ['d:P-1', 'i:P-1', true],
      ['n:1', 'c:1', true],
      ['i:P-6', 'n:1', false],
    ])
  })

  it("counts a subtree's issues, context included and chips excluded", () => {
    const rows = flattenTree(groupsOf(SAMPLE), NONE)
    const count = (id: string) => {
      const row = rows.find((r) => r.id === id)
      return row !== undefined && 'count' in row ? row.count : undefined
    }

    // P-1 holds P-4, P-2 and P-3; Done P-5 sits behind the chip.
    expect(count('i:P-1')).toBe(3)
    expect(count('c:1')).toBe(5)
    expect(count('n:1')).toBe(1)
    expect(issuesShown(rows)).toBe(5)

    // A context-only Epic still counts.
    const mine = groupsOf(
      [
        issue('P-1', { type: 'Epic', customer: ACME }),
        {
          ...issue('P-2', { parent: 'P-1', customer: ACME }),
          assignee: {
            accountId: 'me',
            displayName: 'Me',
            avatarUrl: null,
          },
        },
      ],
      { assigneeMe: true },
    )
    expect(flattenTree(mine, NONE).find((r) => r.id === 'c:1')).toMatchObject({ count: 2 })
  })

  it('carries contextOnly and the mismatch onto the row', () => {
    const issues = [
      issue('P-1', { type: 'Epic', customer: ACME }),
      issue('P-2', { parent: 'P-1', customer: BETA }),
      issue('P-3', { parent: 'P-1', customer: ACME }),
    ]
    const match = (i: Issue) => i.key === 'P-2'
    const rows = flattenTree(groupsOf(issues, { match }), NONE)
    const issueRow = (key: string) => {
      const row = rows.find((r) => r.id === `i:${key}`)
      if (row?.kind !== 'issue') throw new Error(`No issue row for ${key}`)
      return row
    }

    expect(issueRow('P-1').node.contextOnly).toBe(true)
    expect(issueRow('P-2').node.contextOnly).toBe(false)
    expect(issueRow('P-2').node.customerMismatch).toEqual({ own: BETA, epic: ACME })
    expect(ids(rows)).not.toContain('i:P-3')
  })

  it('lists a Done Epic kept as context for its open child', () => {
    const issues = [
      issue('P-1', { type: 'Epic', status: 'Done', customer: ACME }),
      issue('P-2', { parent: 'P-1', customer: ACME }),
    ]
    const rows = flattenTree(groupsOf(issues, { hideDone: true }), NONE)

    expect(ids(rows)).toEqual(['c:1', 'i:P-1', 'i:P-2'])
  })

  it('keeps ids stable when the same issues are rebuilt', () => {
    expect(ids(flattenTree(groupsOf(SAMPLE), NONE))).toEqual(
      ids(flattenTree(groupsOf([...SAMPLE].reverse()), NONE)),
    )
  })
})

describe('indexNodes', () => {
  it('finds every issue in the Tree, Done children behind a chip included', () => {
    const nodes = indexNodes(groupsOf(SAMPLE))

    expect([...nodes.keys()].sort()).toEqual(['P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6'])
    expect(nodes.get('P-5')?.issue.status.name).toBe('Done')
  })

  it('leaves out an issue the filters removed', () => {
    const nodes = indexNodes(groupsOf(SAMPLE, { match: (i) => i.key === 'P-6' }))

    expect([...nodes.keys()]).toEqual(['P-6'])
  })
})

describe('expandableIds', () => {
  it('lists every expandable row, shown or not', () => {
    const list = expandableIds(groupsOf(SAMPLE))

    expect([...list].sort()).toEqual(['c:1', 'i:P-1', 'i:P-2', 'n:1'])
  })
})

const NO_KEYS = { shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }
const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ...NO_KEYS,
  ...extra,
})
const state = (activeId: string | null, extra: Partial<TreeState> = {}): TreeState => ({
  activeId,
  collapsed: new Set(),
  revealed: new Set(),
  peekOpen: false,
  ...extra,
})

describe('moveActive', () => {
  const groups = groupsOf(SAMPLE)
  const rows = flattenTree(groups, NONE)
  const context: MoveContext = { pageSize: 3, expandable: expandableIds(groups) }
  // The rows always match the state, as in the Shell, which flattens from the same sets.
  const move = (active: string | null, input: KeyInput, extra: Partial<TreeState> = {}) =>
    moveActive(
      flattenTree(groups, {
        collapsed: extra.collapsed ?? new Set(),
        revealed: extra.revealed ?? new Set(),
      }),
      state(active, extra),
      input,
      context,
    )

  it('J and ArrowDown move down, K and ArrowUp move up, stopping at the ends', () => {
    expect(move('c:1', press('j'))?.activeId).toBe('i:P-1')
    expect(move('c:1', press('ArrowDown'))?.activeId).toBe('i:P-1')
    expect(move('i:P-1', press('k'))?.activeId).toBe('c:1')
    expect(move('i:P-1', press('ArrowUp'))?.activeId).toBe('c:1')
    expect(move('c:1', press('k'))?.activeId).toBe('c:1')
    expect(move('i:P-6', press('j'))?.activeId).toBe('i:P-6')
  })

  it('starts at the first row when nothing is active', () => {
    expect(move(null, press('j'))?.activeId).toBe('c:1')
    expect(move(null, press('k'))?.activeId).toBe('c:1')
  })

  it('Shift+J and Caps Lock J move like J', () => {
    expect(move('c:1', press('J', { shiftKey: true }))?.activeId).toBe('i:P-1')
    expect(move('c:1', press('J'))?.activeId).toBe('i:P-1')
    expect(move('i:P-1', press('K', { shiftKey: true }))?.activeId).toBe('c:1')
  })

  it('PageDown and PageUp move one window height', () => {
    expect(move('c:1', press('PageDown'))?.activeId).toBe(rows[3]?.id)
    expect(move(rows[5]?.id ?? null, press('PageUp'))?.activeId).toBe(rows[2]?.id)
    expect(move('i:P-6', press('PageDown'))?.activeId).toBe('i:P-6')
  })

  it('ArrowRight expands a collapsed row, then moves to its first child', () => {
    const collapsed = { collapsed: new Set(['i:P-1']) }
    const opened = move('i:P-1', press('ArrowRight'), collapsed)
    expect(opened?.activeId).toBe('i:P-1')
    expect([...(opened?.collapsed ?? [])]).toEqual([])

    expect(move('i:P-1', press('ArrowRight'))?.activeId).toBe('i:P-2')
    // A leaf stays put.
    expect(move('i:P-4', press('ArrowRight'))?.activeId).toBe('i:P-4')
  })

  it('ArrowRight reveals a chip, then moves into its Done children', () => {
    const revealed = move('d:P-1', press('ArrowRight'))
    expect([...(revealed?.revealed ?? [])]).toEqual(['d:P-1'])

    const open = flattenTree(groups, { ...NONE, revealed: new Set(['d:P-1']) })
    const next = moveActive(
      open,
      state('d:P-1', { revealed: new Set(['d:P-1']) }),
      press('ArrowRight'),
      context,
    )
    expect(next?.activeId).toBe('i:P-5')
  })

  it('ArrowLeft collapses an expanded row, then moves to its parent', () => {
    const closed = move('i:P-1', press('ArrowLeft'))
    expect([...(closed?.collapsed ?? [])]).toEqual(['i:P-1'])
    expect(closed?.activeId).toBe('i:P-1')

    expect(move('i:P-4', press('ArrowLeft'))?.activeId).toBe('i:P-1')
    expect(move('i:P-1', press('ArrowLeft'), { collapsed: new Set(['i:P-1']) })?.activeId).toBe(
      'c:1',
    )
    expect(move('c:1', press('ArrowLeft'), { collapsed: new Set(['c:1']) })?.activeId).toBe('c:1')
  })

  it('ArrowLeft hides a revealed chip', () => {
    const open = flattenTree(groups, { ...NONE, revealed: new Set(['d:P-1']) })
    const result = moveActive(
      open,
      state('d:P-1', { revealed: new Set(['d:P-1']) }),
      press('ArrowLeft'),
      context,
    )

    expect([...(result?.revealed ?? [])]).toEqual([])
    expect(result?.activeId).toBe('d:P-1')
  })

  it('Shift+ArrowLeft collapses all and activates the Customer header; Shift+ArrowRight expands all', () => {
    const closed = move('i:P-3', press('ArrowLeft', { shiftKey: true }), {
      revealed: new Set(['d:P-1']),
    })
    expect(closed?.activeId).toBe('c:1')
    expect([...(closed?.collapsed ?? [])].sort()).toEqual(['c:1', 'i:P-1', 'i:P-2', 'n:1'])
    expect([...(closed?.revealed ?? [])]).toEqual([])

    const opened = move('c:1', press('ArrowRight', { shiftKey: true }), {
      collapsed: new Set(['c:1', 'i:P-1']),
    })
    expect([...(opened?.collapsed ?? [])]).toEqual([])
    expect(opened?.activeId).toBe('c:1')
  })

  it('Home and End move to the first and last row', () => {
    expect(move('i:P-2', press('Home'))?.activeId).toBe('c:1')
    expect(move('i:P-2', press('End'))?.activeId).toBe('i:P-6')
  })

  it('Enter toggles a header or chip and opens an issue', () => {
    const header = move('c:1', press('Enter'))
    expect([...(header?.collapsed ?? [])]).toEqual(['c:1'])
    expect(header?.peekOpen).toBe(false)

    const chip = move('d:P-1', press('Enter'))
    expect([...(chip?.revealed ?? [])]).toEqual(['d:P-1'])

    const issueRow = move('i:P-4', press('Enter'))
    expect(issueRow).toMatchObject({ peekOpen: true, focusPeek: false })
    // With the Peek open, Enter moves focus into it.
    expect(move('i:P-4', press('Enter'), { peekOpen: true })).toMatchObject({
      peekOpen: true,
      focusPeek: true,
    })
  })

  it('Space toggles the Peek on an issue row only', () => {
    expect(move('i:P-4', press(' '))?.peekOpen).toBe(true)
    expect(move('i:P-4', press(' '), { peekOpen: true })?.peekOpen).toBe(false)
    // Handled, so the Tree stops the container from scrolling, but it changes nothing.
    expect(move('c:1', press(' '))).toMatchObject({ peekOpen: false, activeId: 'c:1' })
    expect(move('d:P-1', press(' '), { peekOpen: true })).toMatchObject({ peekOpen: true })
  })

  it('Esc closes the Peek, and is left alone when it is closed', () => {
    expect(move('i:P-4', press('Escape'), { peekOpen: true })?.peekOpen).toBe(false)
    expect(move('c:1', press('Escape'), { peekOpen: true })?.peekOpen).toBe(false)
    expect(move('i:P-4', press('Escape'))).toBeNull()
  })

  it('ignores keys pressed with Cmd, Ctrl or Alt', () => {
    for (const key of ['j', 'k', 'z', 'ArrowDown', 'Enter', ' ', 'Escape']) {
      expect(move('i:P-1', press(key, { metaKey: true }))).toBeNull()
      expect(move('i:P-1', press(key, { ctrlKey: true }))).toBeNull()
      expect(move('i:P-1', press(key, { altKey: true }))).toBeNull()
    }
  })

  it('leaves every other key unhandled', () => {
    for (const key of ['c', 's', 'a', 'l', 'p', 'e', 't', 'x', 'C', 'Tab', 'Backspace', '/', '?']) {
      expect(move('i:P-1', press(key))).toBeNull()
    }
  })

  it('handles nothing when there are no rows', () => {
    expect(moveActive([], state(null), press('j'), context)).toBeNull()
  })
})

describe('clickRow', () => {
  const rows = flattenTree(groupsOf(SAMPLE), NONE)

  it('opens an issue row in the Peek and makes it active', () => {
    expect(clickRow(rows, state(null), 'i:P-4', false)).toMatchObject({
      activeId: 'i:P-4',
      peekOpen: true,
    })
  })

  it('toggles a header or chip, and an issue only by its chevron', () => {
    const header = clickRow(rows, state(null), 'c:1', false)
    expect([...header.collapsed]).toEqual(['c:1'])
    const chip = clickRow(rows, state(null), 'd:P-1', false)
    expect([...chip.revealed]).toEqual(['d:P-1'])

    const chevron = clickRow(rows, state(null), 'i:P-2', true)
    expect([...chevron.collapsed]).toEqual(['i:P-2'])
    expect(chevron.peekOpen).toBe(false)
  })

  it('makes a leaf active when its chevron is clicked, with nothing to toggle', () => {
    const result = clickRow(rows, state(null), 'i:P-4', true)

    expect(result).toMatchObject({ activeId: 'i:P-4', peekOpen: false })
    expect([...result.collapsed]).toEqual([])
  })
})

describe('windowRange', () => {
  const range = (scrollTop: number, height: number, count: number, active = -1) =>
    windowRange(scrollTop, height, count, active)

  it('covers the visible rows plus overscan, clamped at both ends', () => {
    // 320 px is 10 rows. At the top, rows 0 to 19: 10 visible and 10 overscan below.
    expect(range(0, 320, 1000)).toEqual(Array.from({ length: 20 }, (_, i) => i))
    // Scrolled to row 100: rows 90 to 119.
    expect(range(3200, 320, 1000)).toEqual(Array.from({ length: 30 }, (_, i) => 90 + i))
    // At the bottom the window stops at the last row.
    const bottom = range(999 * 32 - 320 + 32, 320, 1000)
    expect(bottom.at(-1)).toBe(999)
    expect(range(0, 320, 5)).toEqual([0, 1, 2, 3, 4])
    expect(range(0, 320, 0)).toEqual([])
  })

  it('renders a bounded number of rows however many there are', () => {
    // 800 px is 25 rows, plus 10 of overscan below at the top.
    expect(range(0, 800, 3200)).toHaveLength(35)
    expect(range(32 * 1500, 800, 3200)).toHaveLength(45)
    expect(range(0, 800, 30)).toHaveLength(30)
  })

  it('includes an active row outside the window', () => {
    const indices = range(0, 320, 1000, 500)

    expect(indices.at(-1)).toBe(500)
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
    expect(indices).toHaveLength(21)
    expect(range(32 * 500, 320, 1000, 2)[0]).toBe(2)
  })

  it('does not repeat an active row already in the window', () => {
    expect(range(0, 320, 1000, 3)).toHaveLength(20)
  })
})

describe('fallbackRow', () => {
  const previous = flattenTree(groupsOf(SAMPLE), NONE)
  const without = (...removed: string[]) => previous.filter((r) => !removed.includes(r.id))

  it('keeps the active row when it survived', () => {
    expect(fallbackRow(previous, previous, 'i:P-2')).toBe('i:P-2')
  })

  it('picks the next surviving sibling, then the nearest surviving ancestor, then the old index', () => {
    // P-2 vanished with its Subtask: its next sibling under P-1 is P-4.
    expect(fallbackRow(previous, without('i:P-2', 'i:P-3'), 'i:P-2')).toBe('i:P-4')
    // P-4 is last before the chip, which is a sibling too.
    expect(fallbackRow(previous, without('i:P-4'), 'i:P-4')).toBe('d:P-1')
    // No sibling follows the chip: the ancestor P-1.
    expect(fallbackRow(previous, without('d:P-1'), 'd:P-1')).toBe('i:P-1')
    // The only child went: its parent.
    expect(fallbackRow(previous, without('i:P-3'), 'i:P-3')).toBe('i:P-2')
    // The whole Epic subtree went, so the chain of parents ends at the Customer.
    const gone = ['i:P-1', 'i:P-4', 'i:P-2', 'i:P-3', 'd:P-1']
    expect(fallbackRow(previous, without(...gone), 'i:P-3')).toBe('c:1')
    // Neither a sibling nor an ancestor survives: the row now at the old index.
    const alone = previous.filter((r) => r.id === 'i:P-6')
    expect(fallbackRow(previous, alone, 'i:P-3')).toBe('i:P-6')
  })

  it('starts at the first row when nothing was active, and at none when nothing remains', () => {
    expect(fallbackRow(previous, previous, null)).toBe('c:1')
    expect(fallbackRow(previous, [], 'i:P-2')).toBeNull()
  })
})
