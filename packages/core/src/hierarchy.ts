import { priorityLevel, type IssueOrder } from './display.js'
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
   * `key` (the default) is the original order. The others sort on one field and break ties as `key`
   * does, so a list with no ties on the field is fully ordered by it. Customer groups keep their order.
   */
  order?: IssueOrder | undefined
}

export interface HierarchyNode {
  issue: Issue
  /** Open children, then Done children of a Done parent, in display order. */
  children: HierarchyNode[]
  /** Done children of an open parent, behind the "N done" chip. */
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
const keyNumber = (i: Issue) => Number(i.key.slice(i.key.lastIndexOf('-') + 1))
const byKeyDesc = (a: Issue, b: Issue) => keyNumber(b) - keyNumber(a)

function statusRank(i: Issue): number {
  const rank = STATUS_ORDER.indexOf(i.status.name)
  return rank === -1 ? STATUS_ORDER.length : rank
}

const byStatusThenKey = (a: Issue, b: Issue) => statusRank(a) - statusRank(b) || byKeyDesc(a, b)

const priorityOf = (i: Issue) => priorityLevel(i.priority?.name ?? '')

/** Highest priority first, then the soonest due date with undated last, or the newest update first. */
const FIELD_ORDERS: Record<Exclude<IssueOrder, 'key'>, (a: Issue, b: Issue) => number> = {
  priority: (a, b) => priorityOf(b) - priorityOf(a),
  updated: (a, b) => Date.parse(b.updated) - Date.parse(a.updated),
  due: (a, b) => {
    if (a.dueDate === b.dueDate) return 0
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  },
}

type Compare = (a: Issue, b: Issue) => number

/** The comparators for Epics and for every other list, each with `key`'s tie-break. */
function comparators(order: IssueOrder): { epics: Compare; others: Compare } {
  if (order === 'key') return { epics: byKeyDesc, others: byStatusThenKey }
  const field = FIELD_ORDERS[order]
  return {
    epics: (a, b) => field(a, b) || byKeyDesc(a, b),
    others: (a, b) => field(a, b) || byStatusThenKey(a, b),
  }
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
  const sort = comparators(options.order ?? 'key')
  const byKey = new Map(issues.map((i) => [i.key, i]))
  /** The loaded ancestors of an issue, nearest first. */
  function ancestors(issue: Issue): Issue[] {
    const found: Issue[] = []
    for (let p = byKey.get(issue.parentKey ?? ''); p !== undefined && !found.includes(p);) {
      found.push(p)
      p = byKey.get(p.parentKey ?? '')
    }
    return found
  }
  const context = new Set<string>()
  const keep = new Set<string>(issues.map((i) => i.key))
  // Done ancestors of an open issue: "Hide done" must not hide that issue, so they stay as context.
  const rescued = new Set<string>()

  const filtered = options.assigneeMe || options.match
  const wanted = filtered
    ? issues.filter(
        (i) =>
          (!options.assigneeMe || i.assignee?.accountId === options.accountId) &&
          (options.match?.(i) ?? true),
      )
    : issues
  const matched = new Set(wanted.map((i) => i.key))
  if (filtered) {
    keep.clear()
    for (const key of matched) keep.add(key)
  }
  for (const i of wanted) {
    for (const ancestor of ancestors(i)) {
      if (filtered && !matched.has(ancestor.key)) context.add(ancestor.key)
      if (!isDone(i) && isDone(ancestor)) {
        rescued.add(ancestor.key)
        // With no filter every issue matches, so "Hide done" is what makes the Done ancestor context.
        if (!filtered && options.hideDone) context.add(ancestor.key)
      }
    }
  }
  for (const key of context) keep.add(key)

  const kids = new Map<string, Issue[]>()
  for (const i of issues) {
    if (isEpic(i) || i.parentKey === null || !byKey.has(i.parentKey) || !keep.has(i.key)) continue
    const siblings = kids.get(i.parentKey)
    if (siblings === undefined) kids.set(i.parentKey, [i])
    else siblings.push(i)
  }

  function node(issue: Issue, epic: Issue | null): HierarchyNode {
    const open = !isDone(issue)
    const listed = kids.get(issue.key) ?? []
    // A Done parent shows only as context, so its Done children stay hidden unless rescued.
    const all =
      open || !options.hideDone ? listed : listed.filter((c) => !isDone(c) || rescued.has(c.key))
    const build = (list: Issue[]) =>
      list.sort(sort.others).map((c) => node(c, isEpic(issue) ? issue : null))
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
  const roots = issues.filter((i) => isEpic(i) || i.parentKey === null || !byKey.has(i.parentKey))
  for (const root of roots) {
    const shown =
      keep.has(root.key) && !(options.hideDone && isDone(root) && !rescued.has(root.key))
    if (!shown && options.hideEmptyCustomers) continue
    const g = group(root.customer)
    if (!shown) continue
    ;(isEpic(root) ? g.epics : g.noEpic).push(node(root, null))
  }
  if (!options.hideEmptyCustomers) for (const c of options.customers ?? []) group(c)

  return [...groups.values()]
    .map((g) => ({
      ...g,
      epics: g.epics.sort((a, b) => sort.epics(a.issue, b.issue)),
      noEpic: g.noEpic.sort((a, b) => sort.others(a.issue, b.issue)),
    }))
    .sort(byCustomer)
}

export interface Progress {
  done: number
  total: number
}

/**
 * Done over total of each parent's direct children, by parent key. It counts the children
 * `buildHierarchy` nests under a parent (an Epic is never a child), whatever the toggles and
 * filters hide, so an Epic's `children` and `doneCount` add up to `total`. Done is the status
 * category. A parent with no loaded child has no entry.
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
