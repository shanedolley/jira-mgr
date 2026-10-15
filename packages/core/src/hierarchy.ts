import {
  DEFAULT_ORDER,
  MANUAL_ORDER_LIMIT,
  ORDER_DEFAULT_DIRECTION,
  priorityLevel,
  type IssueOrder,
  type OrderDirection,
} from './display.js'
import type { Issue } from './issue.js'

export type CustomerOption = NonNullable<Issue['customer']>

export interface HierarchyOptions {
  hideDone: boolean
  assigneeMe: boolean
  hideEmptyCustomers: boolean
  /** The signed-in user, matched by "Assignee: me". */
  accountId: string
  /** Every Customer option. With `hideEmptyCustomers` off, the ones with no visible issue still show. */
  customers?: CustomerOption[]
  /**
   * A view's filter predicate (`issueMatcher`). Like "Assignee: me", it keeps the issues it
   * matches plus their ancestors, which show as context.
   */
  match?: ((issue: Issue) => boolean) | undefined
  /**
   * How issues sort among their siblings: Epics, an Epic's children at every depth, and No Epic.
   * `key` (the default) sorts by key number alone. The others sort on one field and break ties by
   * key number, so a list with no ties on the field is fully ordered by it. Customer groups keep
   * their order.
   */
  order?: IssueOrder | undefined
  /** Which way `order` runs; the order's own default (`ORDER_DEFAULT_DIRECTION`) when absent. Key ties break the same way. */
  direction?: OrderDirection | undefined
  /**
   * The issue keys in the order `manual` follows, siblings in the order they appear. An issue the
   * list does not name sits after the named ones, by key ascending; a key naming no loaded issue is
   * ignored. Read only while `order` is `manual`, which ignores `direction`.
   */
  manual?: readonly string[] | undefined
}

export interface HierarchyNode {
  issue: Issue
  /** Open children, then Done children of a Done parent, in display order. */
  children: HierarchyNode[]
  /** Done children of an open parent, behind the "N done" chip. Always empty while `hideDone` is on. */
  doneChildren: HierarchyNode[]
  doneCount: number
  /** True when "Assignee: me" or a view's filters kept the issue only as an ancestor of a matching one. */
  contextOnly: boolean
  /** Set on a direct child of an Epic whose Customer differs from the Epic's. */
  customerMismatch: { own: CustomerOption | null; epic: CustomerOption | null } | null
}

export interface CustomerGroup {
  /** `null` is the "No Customer" group. */
  customer: CustomerOption | null
  epics: HierarchyNode[]
  /** The "No Epic" group: issues with no Epic, and Subtasks whose parent is not loaded. */
  noEpic: HierarchyNode[]
}

/** The statuses in display order (Q21). Any other status sorts after them. */
export const STATUS_ORDER: readonly string[] = [
  'Opportunity',
  'To Do',
  'In Progress',
  'Review',
  'Hold',
  'Done',
]
const INTERNAL_CUSTOMERS = ['Collibra (Internal team)', 'Collibra (Internal template)']

const isEpic = (i: Issue) => i.issueType.hierarchyLevel >= 1
const isDone = (i: Issue) => i.status.category === 'done'
const numberOf = (key: string) => Number(key.slice(key.lastIndexOf('-') + 1))
const keyNumber = (i: Issue) => numberOf(i.key)

function statusRank(i: Issue): number {
  const rank = STATUS_ORDER.indexOf(i.status.name)
  return rank === -1 ? STATUS_ORDER.length : rank
}

const priorityOf = (i: Issue) => priorityLevel(i.priority?.name ?? '')

type Compare = (a: Issue, b: Issue) => number

/** Each order's `asc` comparison: lowest priority, oldest update, soonest due date, first status. */
const FIELD_ORDERS: Record<Exclude<IssueOrder, 'key' | 'manual'>, Compare> = {
  status: (a, b) => statusRank(a) - statusRank(b),
  priority: (a, b) => priorityOf(a) - priorityOf(b),
  updated: (a, b) => Date.parse(a.updated) - Date.parse(b.updated),
  due: (a, b) => (a.dueDate === b.dueDate ? 0 : (a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1),
}

/** Issues an order cannot place sort last in either direction: undated under `due`, an unlisted status. */
const LAST: Partial<Record<IssueOrder, (i: Issue) => boolean>> = {
  due: (i) => i.dueDate === null,
  status: (i) => !STATUS_ORDER.includes(i.status.name),
}

/** Orders keys by their place in `manual`; keys it does not name follow, by key number ascending. */
function manualCompare(manual: readonly string[]): (a: string, b: string) => number {
  const rank = new Map<string, number>()
  manual.forEach((key, index) => rank.has(key) || rank.set(key, index))
  const unnamed = manual.length
  return (a, b) => (rank.get(a) ?? unnamed) - (rank.get(b) ?? unnamed) || numberOf(a) - numberOf(b)
}

/** The keys in the order a Tree under `manual` shows them as siblings. */
export function sortedByManual(keys: readonly string[], manual: readonly string[]): string[] {
  return keys.toSorted(manualCompare(manual))
}

/**
 * One comparator for every list. `asc` is the order's own comparison and `desc` reverses it, but
 * issues the order cannot place stay last. Ties break by key number in the same direction, and
 * `key` is that tie-break alone.
 */
function comparator(
  order: IssueOrder,
  direction: OrderDirection,
  manual: readonly string[],
): Compare {
  const sign = direction === 'asc' ? 1 : -1
  const byKey: Compare = (a, b) => sign * (keyNumber(a) - keyNumber(b))
  if (order === 'key') return byKey
  if (order === 'manual') {
    const byManual = manualCompare(manual)
    return (a, b) => byManual(a.key, b.key)
  }
  const field = FIELD_ORDERS[order]
  const unplaced = LAST[order]
  return (a, b) =>
    (unplaced ? Number(unplaced(a)) - Number(unplaced(b)) : 0) || sign * field(a, b) || byKey(a, b)
}

/** Ordinary Customers first, then No Customer, then the internal ones. */
function customerRank(c: CustomerOption | null): number {
  if (c === null) return 1
  return INTERNAL_CUSTOMERS.includes(c.value) ? 2 : 0
}

function byCustomer(
  a: { customer: CustomerOption | null },
  b: { customer: CustomerOption | null },
): number {
  return (
    customerRank(a.customer) - customerRank(b.customer) ||
    (a.customer?.value ?? '').localeCompare(b.customer?.value ?? '', 'en', { sensitivity: 'base' })
  )
}

/**
 * Builds the Customer, Epic, issue, Subtask tree. Pure and serialisable. Nothing in the input
 * changes.
 */
export function buildHierarchy(issues: Issue[], options: HierarchyOptions): CustomerGroup[] {
  const order = options.order ?? DEFAULT_ORDER
  const sort = comparator(
    order,
    options.direction ?? ORDER_DEFAULT_DIRECTION[order],
    options.manual ?? [],
  )
  const everyKey = new Map(issues.map((i) => [i.key, i]))
  // "Hide done" builds from the open issues alone, so no Done issue is a row, context or chip.
  const loaded = options.hideDone ? issues.filter((i) => !isDone(i)) : issues
  const byKey = new Map(loaded.map((i) => [i.key, i]))
  /** The key of an issue's parent. With Done hidden, an issue under a Done parent takes the nearest open ancestor. */
  function parentOf(issue: Issue): string | null {
    let key = issue.parentKey
    for (let hops = 0; options.hideDone && hops < issues.length; hops++) {
      const p = everyKey.get(key ?? '')
      if (p === undefined || !isDone(p)) break
      key = p.parentKey
    }
    return key
  }
  /** The loaded ancestors of an issue, nearest first. */
  function ancestors(issue: Issue): Issue[] {
    const found: Issue[] = []
    for (let p = byKey.get(parentOf(issue) ?? ''); p !== undefined && !found.includes(p);) {
      found.push(p)
      p = byKey.get(parentOf(p) ?? '')
    }
    return found
  }
  const context = new Set<string>()
  const keep = new Set<string>(loaded.map((i) => i.key))

  const filtered = options.assigneeMe || options.match
  const wanted = filtered
    ? loaded.filter(
        (i) =>
          (!options.assigneeMe || i.assignee?.accountId === options.accountId) &&
          (options.match?.(i) ?? true),
      )
    : loaded
  const matched = new Set(wanted.map((i) => i.key))
  if (filtered) {
    keep.clear()
    for (const key of matched) keep.add(key)
  }
  for (const i of wanted) {
    for (const ancestor of ancestors(i)) {
      if (filtered && !matched.has(ancestor.key)) context.add(ancestor.key)
    }
  }
  for (const key of context) keep.add(key)

  const kids = new Map<string, Issue[]>()
  for (const i of loaded) {
    const parent = parentOf(i)
    if (isEpic(i) || parent === null || !byKey.has(parent) || !keep.has(i.key)) continue
    const siblings = kids.get(parent)
    if (siblings === undefined) kids.set(parent, [i])
    else siblings.push(i)
  }

  function node(issue: Issue, epic: Issue | null): HierarchyNode {
    const open = !isDone(issue)
    const all = kids.get(issue.key) ?? []
    const build = (list: Issue[]) =>
      list.sort(sort).map((c) => node(c, isEpic(issue) ? issue : null))
    const doneChildren = open ? build(all.filter(isDone)) : []
    const children = build(open ? all.filter((c) => !isDone(c)) : all)
    const own = issue.customer
    const mismatch = epic !== null && (own?.id ?? null) !== (epic.customer?.id ?? null)
    return {
      issue,
      children,
      doneChildren,
      doneCount: doneChildren.length,
      contextOnly: context.has(issue.key),
      customerMismatch: mismatch ? { own, epic: epic.customer } : null,
    }
  }

  const groups = new Map<string, CustomerGroup>()
  const group = (customer: CustomerOption | null) => {
    const id = customer?.id ?? ''
    const found = groups.get(id)
    if (found !== undefined) return found
    const created: CustomerGroup = { customer, epics: [], noEpic: [] }
    groups.set(id, created)
    return created
  }

  // A root is an Epic, or an issue whose parent is not loaded.
  const roots = loaded.filter((i) => {
    const parent = parentOf(i)
    return isEpic(i) || parent === null || !byKey.has(parent)
  })
  for (const root of roots) {
    const shown = keep.has(root.key)
    if (!shown && options.hideEmptyCustomers) continue
    const g = group(root.customer)
    if (!shown) continue
    ;(isEpic(root) ? g.epics : g.noEpic).push(node(root, null))
  }
  if (!options.hideEmptyCustomers) for (const c of options.customers ?? []) group(c)

  return [...groups.values()]
    .map((g) => ({
      ...g,
      epics: g.epics.sort((a, b) => sort(a.issue, b.issue)),
      noEpic: g.noEpic.sort((a, b) => sort(a.issue, b.issue)),
    }))
    .sort(byCustomer)
}

/**
 * Every issue key the groups show, depth first in display order, Done children behind a chip
 * included. It seeds a manual order from the order on screen: building again with this list as
 * `manual` gives the same tree, since each sibling list keeps its relative order.
 */
export function treeOrder(groups: readonly CustomerGroup[]): string[] {
  const keys: string[] = []
  const walk = (node: HierarchyNode) => {
    keys.push(node.issue.key)
    node.children.forEach(walk)
    node.doneChildren.forEach(walk)
  }
  for (const group of groups) {
    group.epics.forEach(walk)
    group.noEpic.forEach(walk)
  }
  return keys
}

/**
 * The keys of the issues that share a parent with `key` (itself included), in display order: the
 * Epics of its Customer, the issues of its No Epic group, or the children (or Done children) of
 * its parent. `undefined` when no group shows the issue.
 */
export function siblingKeys(groups: readonly CustomerGroup[], key: string): string[] | undefined {
  const keysOf = (nodes: readonly HierarchyNode[]) => nodes.map((n) => n.issue.key)
  const find = (nodes: readonly HierarchyNode[]): string[] | undefined => {
    if (nodes.some((n) => n.issue.key === key)) return keysOf(nodes)
    for (const node of nodes) {
      const found = find(node.children) ?? find(node.doneChildren)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const group of groups) {
    const found = find(group.epics) ?? find(group.noEpic)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * The manual order after `key` moves to `toIndex` among `siblings` (its siblings in display order,
 * itself included; `toIndex` is clamped). Only the siblings change places: they take the slots the
 * siblings held in `manual`, so an unseen sibling keeps its place between them, and any sibling the
 * list did not name yet follows the others. The list is deduplicated. Unchanged when `key` is not
 * among `siblings`.
 */
export function moveInManualOrder(
  manual: readonly string[],
  siblings: readonly string[],
  key: string,
  toIndex: number,
): string[] {
  const from = siblings.indexOf(key)
  const list = [...new Set(manual)]
  if (from < 0) return list
  const to = Math.min(siblings.length - 1, Math.max(0, toIndex))
  const moved = siblings.toSpliced(from, 1).toSpliced(to, 0, key)
  const shared = new Set(siblings)
  let next = 0
  const placed = list.flatMap((k) => {
    if (!shared.has(k)) return [k]
    const replacement = moved[next++]
    return replacement === undefined ? [] : [replacement]
  })
  return [...placed, ...moved.slice(next)]
}

/**
 * `manual` as it can be saved: a list within `MANUAL_ORDER_LIMIT` is kept whole. A longer one drops
 * the keys of issues no longer loaded, since those only pile up, then its tail if it is still long.
 */
export function fitManualOrder(manual: readonly string[], loaded: ReadonlySet<string>): string[] {
  if (manual.length <= MANUAL_ORDER_LIMIT) return [...manual]
  return manual.filter((key) => loaded.has(key)).slice(0, MANUAL_ORDER_LIMIT)
}

export interface Progress {
  done: number
  total: number
}

/**
 * Done over total of each parent's direct children, by parent key. It counts the children
 * `buildHierarchy` nests under a parent (an Epic is never a child), whatever the toggles and
 * filters hide. With `hideDone` off and no filter, an Epic's `children` and `doneCount` add up to
 * `total`; with `hideDone` on the Tree holds fewer, since Done children leave it. Done is the
 * status category. A parent with no loaded child has no entry.
 */
export function childProgress(issues: readonly Issue[]): Map<string, Progress> {
  const byKey = new Map(issues.map((i) => [i.key, i]))
  const progress = new Map<string, Progress>()
  for (const i of issues) {
    if (isEpic(i) || i.parentKey === null || !byKey.has(i.parentKey)) continue
    const entry = progress.get(i.parentKey) ?? { done: 0, total: 0 }
    entry.total += 1
    if (isDone(i)) entry.done += 1
    progress.set(i.parentKey, entry)
  }
  return progress
}

export interface CustomerTotals {
  customer: CustomerOption
  open: number
  done: number
}

/**
 * The open and Done issues of each Customer, by the issue's own Customer, Epics included. An
 * issue with no Customer counts for none. Every Customer in `customers` has a row, with zeros when
 * it holds no issue, and a Customer only the issues name has one too. The rows sort as the Tree's
 * groups do.
 */
export function customerTotals(
  issues: readonly Issue[],
  customers: readonly CustomerOption[],
): CustomerTotals[] {
  const rows = new Map<string, CustomerTotals>()
  const row = (customer: CustomerOption) => {
    const found = rows.get(customer.id)
    if (found !== undefined) return found
    const created = { customer, open: 0, done: 0 }
    rows.set(customer.id, created)
    return created
  }
  for (const c of customers) row(c)
  for (const i of issues) if (i.customer !== null) row(i.customer)[isDone(i) ? 'done' : 'open'] += 1
  return [...rows.values()].sort(byCustomer)
}
