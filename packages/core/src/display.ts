/** The properties a Tree row can show beyond its fixed anatomy, in the order the row lays them out. */
export const ROW_PROPERTIES = [
  'labels',
  'sprint',
  'estimate',
  'logged',
  'remaining',
  'remainingPercent',
  'due',
  'created',
  'updated',
] as const

export type RowProperty = (typeof ROW_PROPERTIES)[number]

/** How issues sort within an Epic, among its children and in No Epic. `manual` follows a list the user dragged into place. */
export const ISSUE_ORDERS = ['key', 'priority', 'updated', 'due', 'status', 'manual'] as const

export type IssueOrder = (typeof ISSUE_ORDERS)[number]

/** Which way an order runs: lowest, oldest, soonest or first-listed first (`asc`), or the reverse (`desc`). */
export const ORDER_DIRECTIONS = ['asc', 'desc'] as const

export type OrderDirection = (typeof ORDER_DIRECTIONS)[number]

/** The direction each order runs while none is chosen: the look the Tree had before directions existed. `manual` ignores it. */
export const ORDER_DEFAULT_DIRECTION: Record<IssueOrder, OrderDirection> = {
  key: 'desc',
  priority: 'desc',
  updated: 'desc',
  due: 'asc',
  status: 'asc',
  manual: 'asc',
}

/** The most issue keys a manual order holds. A longer list in a file reads as no list. */
export const MANUAL_ORDER_LIMIT = 20000

/** How far the Tree opens: Customers only, down to Epics, down to Stories, or every level. */
export const TREE_LEVELS = ['customers', 'epics', 'stories', 'all'] as const

export type TreeLevel = (typeof TREE_LEVELS)[number]

/** What the Tree shows while `settings.json` and the applied view say nothing. */
export const DEFAULT_PROPERTIES: readonly RowProperty[] = ['updated']
export const DEFAULT_ORDER: IssueOrder = 'key'
export const DEFAULT_TREE_LEVEL: TreeLevel = 'stories'

/** The names in `ROW_PROPERTIES` out of a list, each once, in row order. Unknown names drop. */
export function keepKnownProperties(names: readonly string[]): RowProperty[] {
  return ROW_PROPERTIES.filter((p) => names.includes(p))
}

/** Filled bars out of four for each priority name PSAPAC and a default Jira site use. */
const LEVELS: Record<string, number> = {
  highest: 4,
  blocker: 4,
  'business critical': 4,
  p1: 4,
  high: 3,
  critical: 3,
  'major problem': 3,
  p2: 3,
  medium: 2,
  major: 2,
  problem: 2,
  low: 1,
  minor: 1,
  lowest: 1,
  trivial: 1,
}

/** How many of four bars a priority fills, 4 the highest; a name that is not listed fills none. */
export const priorityLevel = (name: string): number => LEVELS[name.toLowerCase()] ?? 0

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The part of a sprint the row's label and title read. */
export interface SprintLabelInput {
  name: string
  endDate?: string | null
}

/**
 * The day (`YYYY-MM-DD`) a sprint ends, or `null` without a usable end date. It is the date part of
 * Jira's timestamp, not the local day: PSAPAC sprints end at 14:00Z, which is 19 Oct in Sydney, but
 * the sprint is named "to 18 Oct".
 */
function endDay(sprint: SprintLabelInput): string | null {
  const day = sprint.endDate?.slice(0, 10)
  if (day === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const month = Number(day.slice(5, 7))
  return month >= 1 && month <= 12 ? day : null
}

/**
 * The sprint as the canvas shows it: `S 36 (..14 Oct)` for "Sprint 36" ending 14 October, with the
 * year (`..14 Oct '25`) when the end falls outside the year of `today`. The number is the last run
 * of digits in the name before any bracket, so the dates PSAPAC puts in a name
 * (`PS Sprint 36 (05 Oct-18 Oct)`) do not count. A sprint with no usable end date reads `S 36`,
 * and one with no number in its name reads as the full name.
 */
export function sprintLabel(sprint: SprintLabelInput, today: string): string {
  const digits = sprint.name.split('(')[0]?.match(/\d+/g)?.at(-1)
  if (digits === undefined) return sprint.name
  const number = String(Number(digits))
  const day = endDay(sprint)
  if (day === null) return `S ${number}`
  const [y = '', m = '', d = ''] = day.split('-')
  const date = `${String(Number(d))} ${MONTHS[Number(m) - 1] ?? ''}`
  return `S ${number} (..${y === today.slice(0, 4) ? date : `${date} '${y.slice(2)}`})`
}

/** The full sprint name, with its end day (`Sprint 5, ends 2026-10-14`) when it has one. */
export function sprintTitle(sprint: SprintLabelInput): string {
  const day = endDay(sprint)
  return day === null ? sprint.name : `${sprint.name}, ends ${day}`
}
