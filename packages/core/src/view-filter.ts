import type { Issue } from './issue.js'
import type { SavedView, Settings } from './state.js'

/** The filter fields that take a list of values: alternatives within a field, and also the fields `not` can exclude. */
export const FILTER_LIST_FIELDS = [
  'assignee',
  'status',
  'statusType',
  'priority',
  'type',
  'label',
  'customer',
  'engagement',
  'epic',
  'creator',
  'sprint',
  'relations',
] as const

export type FilterListField = (typeof FILTER_LIST_FIELDS)[number]

/** A window around today. `overdue` also needs the issue open, so only Due date takes it. */
export const DATE_WINDOWS = ['today', 'last-7-days', 'last-30-days', 'next-7-days'] as const

export const DATE_FIELDS = ['due', 'created', 'updated'] as const

export type DateField = (typeof DATE_FIELDS)[number]

export type ViewFilters = SavedView['filters']

export interface FilterContext {
  /** The signed-in user, matched by the assignee and creator value `me`. */
  accountId: string
  /**
   * The loaded issues, which `epic` reads to climb from a Subtask to its Epic. May still be filling
   * while it is read, as the CLI pages: an ancestor not yet loaded just does not match yet.
   */
  issues?: readonly Issue[]
  /** What "today" means for the date filters. Defaults to now, in the local time zone. */
  now?: Date
}

type Matcher = (issue: Issue) => boolean

const lower = (text: string) => text.toLowerCase()

/** Builds the matcher for one field. An absent or empty list filters nothing. */
function anyOf(values: string[] | undefined, match: (value: string) => Matcher): Matcher | null {
  if (values === undefined || values.length === 0) return null
  const matchers = values.map(match)
  return (issue) => matchers.some((m) => m(issue))
}

/** True when the filters, `not` included, hold the value `me`, which needs the signed-in user. */
export function filtersNeedMe(filters: ViewFilters): boolean {
  return [filters, filters.not ?? {}].some((side) =>
    [side.assignee, side.creator].some((values) => (values ?? []).some((v) => lower(v) === 'me')),
  )
}

/** The local day of a date, as `YYYY-MM-DD`. */
export const dayKey = (d: Date) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0'))
    .join('-')

/** The window as first and last local day, relative to today. */
const WINDOWS: Record<(typeof DATE_WINDOWS)[number], [number, number]> = {
  today: [0, 0],
  'last-7-days': [-6, 0],
  'last-30-days': [-29, 0],
  'next-7-days': [0, 6],
}

/** The local day of a due date (`2026-10-11`) or of a Jira timestamp. */
const dayOf = (text: string) => (text.length === 10 ? text : dayKey(new Date(text)))

function dateMatcher(
  field: DateField,
  preset: NonNullable<ViewFilters['dates']>[DateField],
  now: Date,
): Matcher | null {
  if (preset === undefined) return null
  const today = dayKey(now)
  const get = (issue: Issue) =>
    field === 'due' ? issue.dueDate : field === 'created' ? issue.created : issue.updated
  if (preset === 'overdue') {
    return (issue) => {
      const due = get(issue)
      return issue.status.category !== 'done' && due !== null && dayOf(due) < today
    }
  }
  const [from, to] = WINDOWS[preset]
  const at = (offset: number) =>
    dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset))
  const first = at(from)
  const last = at(to)
  return (issue) => {
    const value = get(issue)
    if (value === null) return false
    const day = dayOf(value)
    return day >= first && day <= last
  }
}

const sameOption =
  (pick: (issue: Issue) => { id: string; value: string } | null) =>
  (v: string) =>
  (issue: Issue) => {
    const option = pick(issue)
    return option !== null && (option.id === v || lower(option.value) === lower(v))
  }

/** The key of the issue and of each ancestor loaded so far, nearest first. */
function lineage(issue: Issue, byKey: ReadonlyMap<string, Issue>): string[] {
  const keys = [issue.key]
  for (
    let key = issue.parentKey;
    key !== null && !keys.includes(key);
    key = byKey.get(key)?.parentKey ?? null
  ) {
    keys.push(key)
  }
  return keys
}

/** One matcher per value of each list field. A value that matches nothing selects nothing. */
function valueMatchers(context: FilterContext): Record<FilterListField, (v: string) => Matcher> {
  // The index grows with `context.issues`, so a caller that pages in issues sees the new ones.
  const byKey = new Map<string, Issue>()
  let indexed = 0
  const index = () => {
    const held = context.issues ?? []
    for (; indexed < held.length; indexed++) {
      const issue = held[indexed]
      if (issue !== undefined) byKey.set(issue.key, issue)
    }
    return byKey
  }
  const person = (pick: (issue: Issue) => { accountId: string } | null) => (v: string) => {
    const keyword = lower(v)
    return (issue: Issue) => {
      const who = pick(issue)
      if (keyword === 'unassigned') return who === null
      return who?.accountId === (keyword === 'me' ? context.accountId : v)
    }
  }
  const byIdOrName =
    (pick: (issue: Issue) => { id: string; name: string } | null) =>
    (v: string) =>
    (issue: Issue) => {
      const item = pick(issue)
      return item !== null && (item.id === v || lower(item.name) === lower(v))
    }
  return {
    assignee: person((i) => i.assignee),
    creator: person((i) => i.creator),
    status: byIdOrName((i) => i.status),
    statusType: (v) => (issue) => issue.status.category === lower(v),
    priority: byIdOrName((i) => i.priority),
    type: byIdOrName((i) => i.issueType),
    label: (v) => (issue) => issue.labels.includes(v),
    customer: sameOption((i) => i.customer),
    engagement: sameOption((i) => i.engagement),
    epic: (v) => (issue) => lineage(issue, index()).some((key) => lower(key) === lower(v)),
    sprint: (v) => (issue) =>
      issue.sprints.some((s) =>
        lower(v) === 'current'
          ? s.state === 'active'
          : String(s.id) === v || lower(s.name) === lower(v),
      ),
    relations: (v) => {
      const keyword = lower(v)
      const side = keyword === 'blocked' ? 'blockedBy' : keyword === 'blocking' ? 'blocking' : null
      return (issue) => side !== null && openBlocks(issue, index())[side].length > 0
    },
  }
}

/** Jira's link type for blocking. */
const BLOCKS = 'Blocks'

/** The keys of the open issues that hold an issue up and of the open issues it holds up. */
export interface OpenBlocks {
  blockedBy: string[]
  blocking: string[]
}

/**
 * The "Blocks" links of an issue whose other end is not Done. In a link the issue Jira names
 * `inwardIssue` is the blocker, so an `inward` link means the issue is blocked by that key. An end
 * found in `byKey` counts by its loaded status, which an edit moves on before Jira's copy in the
 * link is read again; any other end counts by the category the link carried. Each key counts once.
 */
export function openBlocks(issue: Issue, byKey?: ReadonlyMap<string, Issue>): OpenBlocks {
  const blockedBy = new Set<string>()
  const blocking = new Set<string>()
  for (const l of issue.links) {
    if (l.type !== BLOCKS || (byKey?.get(l.key)?.status.category ?? l.category) === 'done') continue
    ;(l.direction === 'inward' ? blockedBy : blocking).add(l.key)
  }
  return { blockedBy: [...blockedBy], blocking: [...blocking] }
}

/**
 * The predicate a view's filters describe: values within a field are alternatives (OR), and every
 * filtered field must match (AND). `not` lists values to leave out, field by field, and an issue
 * must hold none of them. Returns `undefined` when the filters select everything, so a caller can
 * skip filtering.
 *
 * - `assignee` and `creator`: an accountId, or `me` (the signed-in user) in any case. `assignee` also takes `unassigned`.
 * - `status`, `type` and `priority`: a name (any case) or an id.
 * - `statusType`: `new`, `indeterminate` or `done`, Jira's status categories.
 * - `customer` and `engagement`: an option's name (any case) or id.
 * - `epic`: the key of an Epic, which matches that Epic and the issues under it, Subtasks included.
 * - `relations`: `blocked` (a "Blocks" link into the issue from one not Done) or `blocking` (one out of it to one not Done).
 * - `label`: an exact label, as Jira labels are case-sensitive.
 * - `sprint`: a sprint id or name (any case), or `current` (any case) for any active sprint. `current` wins over a sprint literally named "Current".
 * - `dates`: `due`, `created` and `updated`, each one window around today (`today`, `last-7-days`, `last-30-days`, `next-7-days`), or for `due` also `overdue`: open, with a due date before today.
 * - `text`: a case-insensitive substring of the key or summary, trimmed.
 *
 * Pure, with no `node:` imports, so the renderer and the CLI share it.
 */
export function issueMatcher(filters: ViewFilters, context: FilterContext): Matcher | undefined {
  const text = lower((filters.text ?? '').trim())
  const matching = valueMatchers(context)
  const now = context.now ?? new Date()
  const excluded = (values: string[] | undefined, field: FilterListField): Matcher | null => {
    const hit = anyOf(values, matching[field])
    return hit === null ? null : (issue) => !hit(issue)
  }
  const matchers = [
    ...FILTER_LIST_FIELDS.map((f) => anyOf(filters[f], matching[f])),
    ...FILTER_LIST_FIELDS.map((f) => excluded(filters.not?.[f], f)),
    ...DATE_FIELDS.map((f) => dateMatcher(f, filters.dates?.[f], now)),
    text === ''
      ? null
      : (issue: Issue) => lower(issue.key).includes(text) || lower(issue.summary).includes(text),
  ].filter((m): m is Matcher => m !== null)
  if (matchers.length === 0) return undefined
  return (issue) => matchers.every((m) => m(issue))
}

/** The issues a view's filters select, in input order. Hierarchy callers pass `issueMatcher` as `match` instead. */
export function filterIssues(
  issues: Issue[],
  filters: ViewFilters,
  context: FilterContext,
): Issue[] {
  const match = issueMatcher(filters, context)
  return match === undefined ? issues : issues.filter(match)
}

/** The toggles to build a view with: the view's own, over the settings'. */
export function applyViewToggles(
  settings: Settings['toggles'],
  view: SavedView,
): Settings['toggles'] {
  return { ...settings, ...view.toggles }
}
