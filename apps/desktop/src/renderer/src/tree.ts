import type { Issue } from '@jira-mgr/core'
import type { CustomerGroup, CustomerOption, HierarchyNode } from '@jira-mgr/core/hierarchy'

/** Every row has this height, since summaries truncate to one line and the rest sits inline. */
export const ROW_HEIGHT = 32
/** A Customer group header is taller than a row, and sits below a gap that the previous group's last row leaves. */
export const HEADER_HEIGHT = 36
export const HEADER_GAP = 8
/** Rows rendered beyond the window on each side, so a fast scroll never shows a gap. */
export const OVERSCAN = 10

/**
 * The input to `buildHierarchy`: unresolved issues, then Done ones. An issue resolved between the
 * two loads, or reopened since Done last loaded, is in both. The copy with the later `updated`
 * wins, the unresolved one on a tie, since a duplicate key would duplicate a root row.
 */
export function mergeIssues(unresolved: readonly Issue[], done: readonly Issue[]): Issue[] {
  const merged = new Map<string, Issue>()
  for (const issue of unresolved) merged.set(issue.key, issue)
  for (const issue of done) {
    const held = merged.get(issue.key)
    if (held === undefined || Date.parse(issue.updated) > Date.parse(held.updated)) {
      merged.set(issue.key, issue)
    }
  }
  return [...merged.values()]
}

interface RowBase {
  /** Stable across refetches and toggles: an issue appears once in the Tree, a Customer once at the top. */
  id: string
  /** 1 for a Customer header, then one more per nesting step. */
  level: number
  parentId: string | null
  expandable: boolean
  /** Always `false` when not expandable. */
  expanded: boolean
  setSize: number
  posInSet: number
}

/** A Customer group header (`c:<option id>` or `c:none`). */
export interface CustomerRow extends RowBase {
  kind: 'customer'
  customer: CustomerOption | null
  /** Issues in the group, context included and issues behind a chip excluded. */
  count: number
}

/** A Customer's No Epic header (`n:<option id>` or `n:none`). */
export interface NoEpicRow extends RowBase {
  kind: 'noEpic'
  customer: CustomerOption | null
  count: number
}

/** One issue (`i:<key>`). */
export interface IssueRow extends RowBase {
  kind: 'issue'
  node: HierarchyNode
  /** Issues below this one, context included and issues behind a chip excluded. */
  count: number
}

/** The "N done" chip of an open parent (`d:<parent key>`). */
export interface ChipRow extends RowBase {
  kind: 'chip'
  parentKey: string
  doneCount: number
}

export type TreeRow = CustomerRow | NoEpicRow | IssueRow | ChipRow

export interface Expansion {
  /** Row ids collapsed. Everything starts expanded. */
  collapsed: ReadonlySet<string>
  /** Chip ids revealed. Every chip starts hidden. */
  revealed: ReadonlySet<string>
}

/** The issues in a node's subtree, itself included, behind no chip. */
function subtreeSize(node: HierarchyNode): number {
  let size = 1
  for (const child of node.children) size += subtreeSize(child)
  return size
}

const customerId = (customer: CustomerOption | null) => customer?.id ?? 'none'

/**
 * The visible rows, in order: each Customer header; its Epics, each followed by its children and
 * then its Done chip; then its No Epic header and those issues. A subtree and a chip appear only
 * while their parent is expanded, and a chip's Done children only while the chip is revealed.
 * Pure: the grouping, sorting and Done rules all come from `buildHierarchy`.
 */
export function flattenTree(groups: readonly CustomerGroup[], expansion: Expansion): TreeRow[] {
  const rows: TreeRow[] = []

  function addNode(
    node: HierarchyNode,
    level: number,
    parentId: string | null,
    posInSet: number,
    setSize: number,
  ) {
    const id = `i:${node.issue.key}`
    const hasChip = node.doneCount > 0
    const expandable = node.children.length > 0 || hasChip
    const expanded = expandable && !expansion.collapsed.has(id)
    rows.push({
      kind: 'issue',
      id,
      level,
      parentId,
      expandable,
      expanded,
      setSize,
      posInSet,
      node,
      count: subtreeSize(node) - 1,
    })
    if (!expanded) return
    const siblings = node.children.length + (hasChip ? 1 : 0)
    node.children.forEach((child, index) => {
      addNode(child, level + 1, id, index + 1, siblings)
    })
    if (hasChip) {
      const chipId = `d:${node.issue.key}`
      const chipExpanded = expansion.revealed.has(chipId)
      rows.push({
        kind: 'chip',
        id: chipId,
        level: level + 1,
        parentId: id,
        expandable: true,
        expanded: chipExpanded,
        setSize: siblings,
        posInSet: siblings,
        parentKey: node.issue.key,
        doneCount: node.doneCount,
      })
      if (chipExpanded) {
        node.doneChildren.forEach((child, index) => {
          addNode(child, level + 2, chipId, index + 1, node.doneChildren.length)
        })
      }
    }
  }

  groups.forEach((group, groupIndex) => {
    const id = `c:${customerId(group.customer)}`
    const noEpicId = `n:${customerId(group.customer)}`
    const hasNoEpic = group.noEpic.length > 0
    const count =
      group.epics.reduce((sum, node) => sum + subtreeSize(node), 0) +
      group.noEpic.reduce((sum, node) => sum + subtreeSize(node), 0)
    const expandable = group.epics.length > 0 || hasNoEpic
    const expanded = expandable && !expansion.collapsed.has(id)
    rows.push({
      kind: 'customer',
      id,
      level: 1,
      parentId: null,
      expandable,
      expanded,
      setSize: groups.length,
      posInSet: groupIndex + 1,
      customer: group.customer,
      count,
    })
    if (!expanded) return
    const siblings = group.epics.length + (hasNoEpic ? 1 : 0)
    group.epics.forEach((epic, index) => {
      addNode(epic, 2, id, index + 1, siblings)
    })
    if (hasNoEpic) {
      const noEpicExpanded = !expansion.collapsed.has(noEpicId)
      rows.push({
        kind: 'noEpic',
        id: noEpicId,
        level: 2,
        parentId: id,
        expandable: true,
        expanded: noEpicExpanded,
        setSize: siblings,
        posInSet: siblings,
        customer: group.customer,
        count: group.noEpic.reduce((sum, node) => sum + subtreeSize(node), 0),
      })
      if (noEpicExpanded) {
        group.noEpic.forEach((node, index) => {
          addNode(node, 3, noEpicId, index + 1, group.noEpic.length)
        })
      }
    }
  })
  return rows
}

/** Every row id that can expand, shown or not, for Collapse all. */
export function expandableIds(groups: readonly CustomerGroup[]): string[] {
  const ids: string[] = []
  function walk(node: HierarchyNode) {
    if (node.children.length > 0 || node.doneCount > 0) ids.push(`i:${node.issue.key}`)
    node.children.forEach(walk)
    node.doneChildren.forEach(walk)
  }
  for (const group of groups) {
    const key = customerId(group.customer)
    if (group.epics.length > 0 || group.noEpic.length > 0) ids.push(`c:${key}`)
    if (group.noEpic.length > 0) ids.push(`n:${key}`)
    group.epics.forEach(walk)
    group.noEpic.forEach(walk)
  }
  return ids
}

/** Every node in the Tree by issue key, including the Done children behind a chip. */
export function indexNodes(groups: readonly CustomerGroup[]): Map<string, HierarchyNode> {
  const nodes = new Map<string, HierarchyNode>()
  function walk(node: HierarchyNode) {
    nodes.set(node.issue.key, node)
    node.children.forEach(walk)
    node.doneChildren.forEach(walk)
  }
  for (const group of groups) {
    group.epics.forEach(walk)
    group.noEpic.forEach(walk)
  }
  return nodes
}

/**
 * The row ids above an issue, nearest first, found with every group expanded: the ancestors a
 * newly created issue needs open before its row can show. Empty when no row shows the issue.
 */
export function ancestorIds(
  groups: readonly CustomerGroup[],
  revealed: ReadonlySet<string>,
  key: string,
): string[] {
  const rows = flattenTree(groups, { collapsed: new Set(), revealed })
  const ids: string[] = []
  for (let row = rows.find((r) => r.id === `i:${key}`); row?.parentId != null;) {
    const parentId: string = row.parentId
    ids.push(parentId)
    row = rows.find((r) => r.id === parentId)
  }
  return ids
}

/** The issues shown in the Tree, for the "N issues shown" announcement. */
export function issuesShown(rows: readonly TreeRow[]): number {
  return rows.reduce((sum, row) => sum + (row.kind === 'customer' ? row.count : 0), 0)
}

export interface TreeState {
  activeId: string | null
  collapsed: ReadonlySet<string>
  revealed: ReadonlySet<string>
  peekOpen: boolean
  /** The keys of the checked issues, which a bulk action applies to. Only checkable rows hold one. */
  checked: ReadonlySet<string>
  /** The issue a Shift+click range starts from: the last one checked or unchecked. */
  anchor: string | null
}

export interface KeyInput {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

export interface MoveResult extends TreeState {
  /** Enter on an issue row: the Shell opens the active issue's full page. */
  openPage: boolean
}

export interface MoveContext {
  /** Rows in one window height, for PageDown and PageUp. */
  pageSize: number
  /** Every expandable row id, for Collapse all. */
  expandable: readonly string[]
}

/** An issue row a bulk action can take: not a header, a chip or an ancestor shown only as context. */
const checkable = (row: TreeRow | undefined): row is IssueRow =>
  row?.kind === 'issue' && !row.node.contextOnly

/** The keys of the checkable rows from `fromId` to `toId` inclusive, whichever comes first. */
function keysBetween(rows: readonly TreeRow[], fromId: string, toId: string): string[] {
  const from = rows.findIndex((r) => r.id === fromId)
  const to = rows.findIndex((r) => r.id === toId)
  if (from < 0 || to < 0) return []
  return rows
    .slice(Math.min(from, to), Math.max(from, to) + 1)
    .filter(checkable)
    .map((r) => r.node.issue.key)
}

/** The state with `keys` checked as well, the anchor kept or, with none yet, set to `anchor`. */
function checkMore(state: TreeState, keys: readonly string[], anchor: string | null): TreeState {
  return { ...state, checked: new Set([...state.checked, ...keys]), anchor: state.anchor ?? anchor }
}

/** The state with `key` checked or unchecked, which also becomes the anchor. */
function toggleChecked(state: TreeState, key: string): TreeState {
  const checked = new Set(state.checked)
  if (!checked.delete(key)) checked.add(key)
  return { ...state, checked, anchor: key }
}

/**
 * The checked set and anchor limited to the rows shown, so a collapse, a filter or a move to Done
 * under "Hide done" never leaves an issue checked that the user cannot see. The same state when
 * nothing needed dropping, so a caller can tell by identity.
 */
export function pruneChecked<T extends Pick<TreeState, 'checked' | 'anchor'>>(
  rows: readonly TreeRow[],
  state: T,
): T {
  if (state.checked.size === 0 && state.anchor === null) return state
  const shown = new Set(rows.filter(checkable).map((r) => r.node.issue.key))
  const checked = new Set([...state.checked].filter((key) => shown.has(key)))
  const anchor = state.anchor !== null && shown.has(state.anchor) ? state.anchor : null
  return checked.size === state.checked.size && anchor === state.anchor
    ? state
    : { ...state, checked, anchor }
}

const without = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set)
  next.delete(id)
  return next
}
const withId = (set: ReadonlySet<string>, id: string) => new Set(set).add(id)

/** Opens a row: removes it from `collapsed`, or reveals a chip. */
function expand(row: TreeRow, state: TreeState): TreeState {
  return row.kind === 'chip'
    ? { ...state, revealed: withId(state.revealed, row.id) }
    : { ...state, collapsed: without(state.collapsed, row.id) }
}

/** Closes a row: adds it to `collapsed`, or hides a chip. */
function collapse(row: TreeRow, state: TreeState): TreeState {
  return row.kind === 'chip'
    ? { ...state, revealed: without(state.revealed, row.id) }
    : { ...state, collapsed: withId(state.collapsed, row.id) }
}

function toggle(row: TreeRow, state: TreeState): TreeState {
  return row.expanded ? collapse(row, state) : expand(row, state)
}

/** The Customer header above a row. */
function customerOf(rows: readonly TreeRow[], row: TreeRow): TreeRow {
  let found = row
  for (let parent = row; parent.parentId !== null;) {
    const next = rows.find((r) => r.id === parent.parentId)
    if (next === undefined) break
    found = next
    parent = next
  }
  return found
}

/**
 * What a key does to the Tree: the next active row, collapsed and revealed sets and Peek state,
 * or `null` for a key the Tree does not handle. `J` and `K` match in either case; every other
 * single letter belongs to D7. A key pressed with Cmd, Ctrl or Alt is never handled, so `Cmd+K`
 * and `Cmd+Z` pass through. Pure, so the table of keys is tested without a DOM.
 */
export function moveActive(
  rows: readonly TreeRow[],
  state: TreeState,
  input: KeyInput,
  context: MoveContext,
): MoveResult | null {
  const selectAll =
    (input.metaKey || input.ctrlKey) && !input.altKey && !input.shiftKey && /^a$/i.test(input.key)
  if (!selectAll && (input.metaKey || input.ctrlKey || input.altKey)) return null
  if (rows.length === 0) return null
  const index = rows.findIndex((r) => r.id === state.activeId)
  const row = rows[index]
  const last = rows.length - 1
  const to = (target: number): MoveResult => ({
    ...state,
    activeId: rows[Math.min(last, Math.max(0, target))]?.id ?? null,
    openPage: false,
  })
  const stay = (next: TreeState = state): MoveResult => ({ ...next, openPage: false })

  if (selectAll) {
    const keys = rows.filter(checkable).map((r) => r.node.issue.key)
    return stay(checkMore(state, keys, keys[0] ?? null))
  }
  // Shift with Up or Down moves as the arrow does and checks the rows it crosses.
  if (
    input.shiftKey &&
    row !== undefined &&
    (input.key === 'ArrowDown' || input.key === 'ArrowUp')
  ) {
    const moved = to(index + (input.key === 'ArrowDown' ? 1 : -1))
    const keys = keysBetween(rows, row.id, moved.activeId ?? row.id)
    return {
      ...checkMore(moved, keys, checkable(row) ? row.node.issue.key : null),
      openPage: false,
    }
  }

  switch (input.key) {
    case 'j':
    case 'J':
    case 'ArrowDown':
      return to(index + 1)
    case 'k':
    case 'K':
    case 'ArrowUp':
      return to(row === undefined ? 0 : index - 1)
    case 'PageDown':
      return to(index + context.pageSize)
    case 'PageUp':
      return to(index - context.pageSize)
    case 'Home':
      return to(0)
    case 'End':
      return to(last)
    case 'ArrowRight': {
      if (input.shiftKey) return stay({ ...state, collapsed: new Set() })
      if (row === undefined) return to(0)
      if (!row.expandable) return stay()
      if (!row.expanded) return stay(expand(row, state))
      return to(index + 1)
    }
    case 'ArrowLeft': {
      if (input.shiftKey) {
        return stay({
          ...state,
          activeId: row === undefined ? (rows[0]?.id ?? null) : customerOf(rows, row).id,
          collapsed: new Set(context.expandable),
          revealed: new Set(),
        })
      }
      if (row === undefined) return to(0)
      if (row.expandable && row.expanded) return stay(collapse(row, state))
      if (row.parentId === null) return stay()
      return stay({ ...state, activeId: row.parentId })
    }
    case 'Enter': {
      if (row === undefined) return null
      if (row.kind !== 'issue') return stay(toggle(row, state))
      return { ...state, openPage: true }
    }
    case ' ': {
      if (row?.kind !== 'issue') return stay()
      return stay({ ...state, peekOpen: !state.peekOpen })
    }
    case 'x':
    case 'X':
      return checkable(row) ? stay(toggleChecked(state, row.node.issue.key)) : stay()
    case 'Escape':
      // The checked issues go first, and a second Esc closes the Peek.
      if (state.checked.size > 0) return stay({ ...state, checked: new Set(), anchor: null })
      return state.peekOpen ? stay({ ...state, peekOpen: false }) : null
    default:
      return null
  }
}

/**
 * A click on a row: the row becomes active. A click on its chevron expands or collapses it;
 * elsewhere it opens an issue row in the Peek and toggles a header or chip. With `select`, a click
 * on a checkable issue row checks it instead: `toggle` flips it (its checkbox) and `range` adds
 * every checkable row from the anchor to it (Shift+click), the anchor being the active issue when
 * none is set. Neither opens the Peek.
 */
export function clickRow(
  rows: readonly TreeRow[],
  state: TreeState,
  id: string,
  onChevron: boolean,
  select?: 'toggle' | 'range',
): TreeState {
  const row = rows.find((r) => r.id === id)
  if (row === undefined) return state
  const active = { ...state, activeId: id }
  if (select !== undefined && checkable(row)) {
    if (select === 'toggle') return toggleChecked(active, row.node.issue.key)
    const current = rows.find((r) => r.id === state.activeId)
    const from = state.anchor ?? (checkable(current) ? current.node.issue.key : row.node.issue.key)
    return checkMore(active, keysBetween(rows, `i:${from}`, id), from)
  }
  if (onChevron) return row.expandable ? toggle(row, active) : active
  if (row.kind === 'issue') return { ...active, peekOpen: true }
  return row.expandable ? toggle(row, active) : active
}

/** Where each row starts and how tall the list is. A header's slot holds its gap above it. */
export interface RowLayout {
  /** The top of each row's slot, in pixels from the top of the list. */
  tops: readonly number[]
  total: number
}

/** The layout of rows whose slots have these heights, top to bottom. */
export function layoutOf(slots: readonly number[]): RowLayout {
  const tops: number[] = []
  let total = 0
  for (const slot of slots) {
    tops.push(total)
    total += slot
  }
  return { tops, total }
}

/** Every row takes `ROW_HEIGHT`, a Customer header `HEADER_GAP` plus `HEADER_HEIGHT`. */
export const layoutRows = (rows: readonly TreeRow[]): RowLayout =>
  layoutOf(rows.map((r) => (r.kind === 'customer' ? HEADER_GAP + HEADER_HEIGHT : ROW_HEIGHT)))

/** The index of the row whose slot holds `y`, clamped to the list. -1 when there are no rows. */
export function rowAtOffset(layout: RowLayout, y: number): number {
  let low = 0
  let high = layout.tops.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if ((layout.tops[mid] ?? 0) <= y) low = mid
    else high = mid - 1
  }
  return layout.tops.length === 0 ? -1 : low
}

/**
 * The indices to render: those in view plus `OVERSCAN` rows each side, and the active row
 * wherever it is, so `aria-activedescendant` never points at a missing element. Sorted.
 */
export function windowRange(
  layout: RowLayout,
  scrollTop: number,
  height: number,
  activeIndex: number,
  overscan: number = OVERSCAN,
): number[] {
  const count = layout.tops.length
  if (count === 0) return []
  const first = Math.max(0, rowAtOffset(layout, scrollTop) - overscan)
  // A row that starts exactly at the bottom edge is out of view, so the last visible one ends there.
  const last = Math.min(count - 1, rowAtOffset(layout, scrollTop + height - 1) + overscan)
  const indices: number[] = []
  for (let i = first; i <= last; i++) indices.push(i)
  if (activeIndex >= 0 && activeIndex < count && (activeIndex < first || activeIndex > last)) {
    indices.push(activeIndex)
    indices.sort((a, b) => a - b)
  }
  return indices
}

/**
 * The active row after a rebuild removed `id`: the next surviving sibling, then the nearest
 * ancestor still in `rows`, then the row now at the old index. `id` itself when it survived.
 */
export function fallbackRow(
  previousRows: readonly TreeRow[],
  rows: readonly TreeRow[],
  id: string | null,
): string | null {
  const first = rows[0]
  if (first === undefined) return null
  if (id === null) return first.id
  const surviving = new Set(rows.map((r) => r.id))
  if (surviving.has(id)) return id
  const oldIndex = previousRows.findIndex((r) => r.id === id)
  const old = previousRows[oldIndex]
  if (old === undefined) return first.id

  for (const r of previousRows.slice(oldIndex + 1)) {
    if (r.parentId === old.parentId && surviving.has(r.id)) return r.id
  }
  for (let parent = old.parentId; parent !== null;) {
    if (surviving.has(parent)) return parent
    parent = previousRows.find((r) => r.id === parent)?.parentId ?? null
  }
  return (rows[Math.min(oldIndex, rows.length - 1)] ?? first).id
}
