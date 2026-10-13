/** The properties a Tree row can show beyond its fixed anatomy, in the order the row lays them out. */
export const ROW_PROPERTIES = ['labels', 'sprint', 'due', 'created', 'updated'] as const

export type RowProperty = (typeof ROW_PROPERTIES)[number]

/** How issues sort within an Epic, among its children and in No Epic. */
export const ISSUE_ORDERS = ['key', 'priority', 'updated', 'due'] as const

export type IssueOrder = (typeof ISSUE_ORDERS)[number]

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
