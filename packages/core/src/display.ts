/** The properties a Tree row can show beyond its fixed anatomy, in the order the row lays them out. */
export const ROW_PROPERTIES = [
  'labels',
  'sprint',
  'estimate',
  'logged',
  'remaining',
  'remainingPercent',
  'start',
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

/** The widest a column can be saved, in pixels. A drag is capped well below it by the Tree's width. */
export const WIDTH_MAX = 1000

/** A column's saved width in pixels, by property. A property with no entry takes its default width. */
export type PropertyWidths = Partial<Record<RowProperty, number>>

/**
 * The widths a file holds for `properties`, read leniently: an entry is kept only for a listed
 * property and only as a whole number of pixels from 1 to `WIDTH_MAX` (0 removes a column, so it is
 * never saved). Anything else drops, and a value that is not an object, or keeps nothing, reads as
 * none.
 */
export function keepKnownWidths(
  value: unknown,
  properties: readonly RowProperty[],
): PropertyWidths | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const kept: PropertyWidths = {}
  for (const property of properties) {
    const width: unknown = (value as Record<string, unknown>)[property]
    if (typeof width === 'number' && Number.isInteger(width) && width >= 1 && width <= WIDTH_MAX) {
      kept[property] = width
    }
  }
  return Object.keys(kept).length === 0 ? undefined : kept
}

/** The names in `ROW_PROPERTIES` out of a list, each once, in the list's order. Unknown names and repeats drop. */
export function keepKnownProperties(names: readonly string[]): RowProperty[] {
  const known: readonly string[] = ROW_PROPERTIES
  return [...new Set(names)].filter((p): p is RowProperty => known.includes(p))
}

/** True unless the display turned the priority slot off: a missing `priority` reads as on. */
export const showsPriority = (display: { priority?: boolean }): boolean =>
  display.priority !== false

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

/** The part of a sprint the row's label, the pickers and the title read. */
export interface SprintLabelInput {
  name: string
  startDate?: string | null
  endDate?: string | null
}

/**
 * The day (`YYYY-MM-DD`) of a Jira timestamp, or `null` without a usable one. It is the date part
 * of the timestamp, not the local day: PSAPAC sprints end at 14:00Z, which is 19 Oct in Sydney, but
 * the sprint is named "to 18 Oct".
 */
function dayOf(timestamp: string | null | undefined): string | null {
  const day = timestamp?.slice(0, 10)
  if (day === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const month = Number(day.slice(5, 7))
  return month >= 1 && month <= 12 ? day : null
}

/** `14 Oct`, with `'25` after the month when the day falls outside the year of `today`. */
function shortDay(day: string, today: string): string {
  const [y = '', m = '', d = ''] = day.split('-')
  const date = `${String(Number(d))} ${MONTHS[Number(m) - 1] ?? ''}`
  return y === today.slice(0, 4) ? date : `${date} '${y.slice(2)}`
}

/**
 * The sprint as the canvas shows it: `S 36` for "Sprint 36". The number is the last run of digits
 * in the name before any bracket, so the dates PSAPAC puts in a name
 * (`PS Sprint 36 (05 Oct-18 Oct)`) do not count. A name with no number reads as the full name.
 */
export function sprintLabel(sprint: SprintLabelInput): string {
  const digits = sprint.name.split('(')[0]?.match(/\d+/g)?.at(-1)
  return digits === undefined ? sprint.name : `S ${String(Number(digits))}`
}

/**
 * The day a sprint ends as a short date: `14 Oct`, with `'25` after the month when the end falls
 * outside the year of `today`. `null` without a usable end date.
 */
export function sprintEnd(sprint: SprintLabelInput, today: string): string | null {
  const day = dayOf(sprint.endDate)
  return day === null ? null : shortDay(day, today)
}

/**
 * A sprint's dates as a picker lists them: `5 Oct - 14 Oct`, or the end alone (`14 Oct`) when the
 * start is missing. `null` without a usable end date.
 */
export function sprintDates(sprint: SprintLabelInput, today: string): string | null {
  const end = sprintEnd(sprint, today)
  const start = dayOf(sprint.startDate)
  return end === null || start === null ? end : `${shortDay(start, today)} - ${end}`
}

/** The full sprint name, with its end day (`Sprint 5, ends 2026-10-14`) when it has one. */
export function sprintTitle(sprint: SprintLabelInput): string {
  const day = dayOf(sprint.endDate)
  return day === null ? sprint.name : `${sprint.name}, ends ${day}`
}
