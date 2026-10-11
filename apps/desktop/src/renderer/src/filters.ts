import type { Issue } from '@jira-mgr/core'
import { STATUS_ORDER } from '@jira-mgr/core/hierarchy'
import {
  DATE_FIELDS,
  type DateField,
  type FilterListField,
  type ViewFilters,
} from '@jira-mgr/core/view-filter'

/** The fields the Filter menu lists, in Linear's order, then this project's own. The text field is the toolbar's own input. */
export const FILTER_FIELDS = [
  'status',
  'statusType',
  'assignee',
  'creator',
  'priority',
  'type',
  'label',
  'relations',
  'due',
  'created',
  'updated',
  'customer',
  'engagement',
  'epic',
  'sprint',
] as const satisfies readonly (FilterListField | DateField)[]
export type FilterField = (typeof FILTER_FIELDS)[number]

export const FIELD_LABELS: Record<FilterField, string> = {
  assignee: 'Assignee',
  creator: 'Creator',
  status: 'Status',
  statusType: 'Status type',
  priority: 'Priority',
  type: 'Type',
  label: 'Label',
  customer: 'Customer',
  engagement: 'Engagement',
  epic: 'Epic',
  sprint: 'Sprint',
  relations: 'Relations',
  due: 'Due date',
  created: 'Created',
  updated: 'Updated',
}

/** "is" keeps the issues that hold a value; "is not" leaves them out. A date field has no "is not". */
export type Operator = 'is' | 'not'

type DatePreset = NonNullable<ViewFilters['dates']>[DateField]

const isDateField = (field: FilterField): field is DateField =>
  (DATE_FIELDS as readonly string[]).includes(field)

/** Whether the menu offers "is not" for this field. */
export const hasNot = (field: FilterField): boolean => !isDateField(field)

/** One checkbox: the `value` core and the CLI read, and the text the user sees. */
export interface Choice {
  value: string
  label: string
}

const byLabel = (a: Choice, b: Choice) =>
  a.label.localeCompare(b.label, 'en', { sensitivity: 'base' })

/** Jira's three status categories, which the Status type filter reads. */
const STATUS_TYPES: Choice[] = [
  { value: 'new', label: 'To Do' },
  { value: 'indeterminate', label: 'In Progress' },
  { value: 'done', label: 'Done' },
]

const RELATIONS: Choice[] = [
  { value: 'blocked', label: 'Blocked' },
  { value: 'blocking', label: 'Blocking' },
]

const TODAY: Choice = { value: 'today', label: 'Today' }
const LAST_7: Choice = { value: 'last-7-days', label: 'Last 7 days' }
const LAST_30: Choice = { value: 'last-30-days', label: 'Last 30 days' }

/**
 * The choices for each field. The filter can only match loaded issues, so most fields list what
 * the loaded issues hold. Status lists the Q21 order first, then any other status. Customer lists
 * the Project's Customers when `customers` has loaded, and the loaded issues' until then.
 */
export function filterChoices(
  issues: readonly Issue[],
  customers: readonly string[] = [],
): Record<FilterField, Choice[]> {
  const assignees = new Map<string, Choice>()
  const creators = new Map<string, Choice>()
  const statuses = new Set<string>()
  const priorities = new Map<string, string>()
  const labels = new Set<string>()
  const types = new Set<string>()
  const customerNames = new Set(customers)
  const engagements = new Set<string>()
  const epics: Choice[] = []
  const sprints = new Map<string, Choice & { active: boolean }>()
  for (const issue of issues) {
    if (issue.assignee !== null) {
      assignees.set(issue.assignee.accountId, {
        value: issue.assignee.accountId,
        label: issue.assignee.displayName,
      })
    }
    if (issue.creator !== null) {
      creators.set(issue.creator.accountId, {
        value: issue.creator.accountId,
        label: issue.creator.displayName,
      })
    }
    statuses.add(issue.status.name)
    if (issue.priority !== null) priorities.set(issue.priority.name, issue.priority.id)
    for (const label of issue.labels) labels.add(label)
    types.add(issue.issueType.name)
    if (issue.customer !== null) customerNames.add(issue.customer.value)
    if (issue.engagement !== null) engagements.add(issue.engagement.value)
    if (issue.issueType.hierarchyLevel >= 1) {
      epics.push({ value: issue.key, label: `${issue.key} ${issue.summary}` })
    }
    for (const sprint of issue.sprints) {
      sprints.set(String(sprint.id), {
        value: String(sprint.id),
        label: sprint.name,
        active: sprint.state === 'active',
      })
    }
  }
  const named = (names: Iterable<string>): Choice[] =>
    [...names].map((name) => ({ value: name, label: name })).sort(byLabel)
  const others = [...statuses].filter((name) => !STATUS_ORDER.includes(name))
  return {
    assignee: [
      { value: 'me', label: 'Me' },
      { value: 'unassigned', label: 'Unassigned' },
      ...[...assignees.values()].sort(byLabel),
    ],
    creator: [{ value: 'me', label: 'Me' }, ...[...creators.values()].sort(byLabel)],
    status: [...STATUS_ORDER, ...others.sort()].map((name) => ({ value: name, label: name })),
    statusType: STATUS_TYPES,
    // Jira numbers its priorities from the most urgent down, so the id order is the urgency order.
    priority: [...priorities]
      .sort(([, a], [, b]) => Number(a) - Number(b))
      .map(([name]) => ({ value: name, label: name })),
    label: named(labels),
    type: named(types),
    customer: named(customerNames),
    engagement: named(engagements),
    epic: epics.sort(byLabel),
    sprint: [
      { value: 'current', label: 'Current sprint' },
      ...[...sprints.values()]
        .sort((a, b) => Number(b.active) - Number(a.active) || byLabel(a, b))
        .map(({ value, label }) => ({ value, label })),
    ],
    relations: RELATIONS,
    due: [
      { value: 'overdue', label: 'Overdue' },
      TODAY,
      { value: 'next-7-days', label: 'Next 7 days' },
      LAST_7,
      LAST_30,
    ],
    created: [TODAY, LAST_7, LAST_30],
    updated: [TODAY, LAST_7, LAST_30],
  }
}

/** The values a field holds under one operator. A date field holds at most one, under "is". */
export function valuesOf(filters: ViewFilters, field: FilterField, op: Operator = 'is'): string[] {
  if (isDateField(field)) {
    const preset = op === 'is' ? filters.dates?.[field] : undefined
    return preset === undefined ? [] : [preset]
  }
  return (op === 'is' ? filters : filters.not)?.[field] ?? []
}

/** The filters with one field's values under one operator replaced. Anything left empty is dropped. */
function withValues(
  filters: ViewFilters,
  field: FilterField,
  op: Operator,
  values: string[],
): ViewFilters {
  const { dates, not, ...rest } = filters
  const kept = (entries: [string, unknown][]): Record<string, unknown> =>
    Object.fromEntries(
      entries.filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)),
    )
  const next: ViewFilters = { ...rest }
  let nextDates = dates
  let nextNot = not
  if (isDateField(field)) nextDates = { ...dates, [field]: values[0] as DatePreset }
  else if (op === 'not') nextNot = { ...not, [field]: values }
  else next[field] = values
  const dateEntries = kept(Object.entries(nextDates ?? {}))
  const notEntries = kept(Object.entries(nextNot ?? {}))
  if (Object.keys(dateEntries).length > 0) next.dates = dateEntries
  if (Object.keys(notEntries).length > 0) next.not = notEntries
  return kept(Object.entries(next))
}

/** The filters with `value` added to, or removed from, one field. An emptied field is dropped. A date field takes one value: choosing another replaces it. */
export function toggleChoice(
  filters: ViewFilters,
  field: FilterField,
  value: string,
  op: Operator = 'is',
): ViewFilters {
  const held = valuesOf(filters, field, op)
  const next = held.includes(value)
    ? held.filter((v) => v !== value)
    : isDateField(field)
      ? [value]
      : [...held, value]
  return withValues(filters, field, op, next)
}

export function clearField(
  filters: ViewFilters,
  field: FilterField,
  op: Operator = 'is',
): ViewFilters {
  return withValues(filters, field, op, [])
}

/** The filters with the text replaced. An empty text is dropped. */
export function withText(filters: ViewFilters, text: string): ViewFilters {
  const next = { ...filters }
  if (text === '') delete next.text
  else next.text = text
  return next
}

export const OPERATORS: readonly Operator[] = ['is', 'not']

/** True when any field, the text included, filters something. */
export function hasFilters(filters: ViewFilters): boolean {
  return (
    FILTER_FIELDS.some((field) =>
      OPERATORS.some((op) => valuesOf(filters, field, op).length > 0),
    ) || (filters.text ?? '').trim() !== ''
  )
}

export interface FilterChip {
  field: FilterField
  op: Operator
  /** "Status: To Do, In Progress", or "Status is not: Hold". */
  text: string
}

/** The names in a sentence: "A", "A and B", "A, B and C". */
export const sentence = (names: string[]): string =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

/** What the empty Tree names as its cause: `No issues match "zzzzqq" with Type: Bug`. */
export function noMatchTitle(filters: ViewFilters, choices: Record<FilterField, Choice[]>): string {
  const text = (filters.text ?? '').trim()
  const chips = sentence(filterChips(filters, choices).map((chip) => chip.text))
  if (text === '') return chips === '' ? 'No issues match' : `No issues match ${chips}`
  return chips === '' ? `No issues match “${text}”` : `No issues match “${text}” with ${chips}`
}

/** One chip per filtered field and operator, naming the choices by their labels. */
export function filterChips(
  filters: ViewFilters,
  choices: Record<FilterField, Choice[]>,
): FilterChip[] {
  const chips: FilterChip[] = []
  for (const field of FILTER_FIELDS) {
    for (const op of OPERATORS) {
      const values = valuesOf(filters, field, op)
      if (values.length === 0) continue
      const names = values.map(
        (value) =>
          choices[field].find((c) => c.value === value)?.label ??
          // A value typed into a saved view that no loaded issue holds shows as stored.
          value,
      )
      const label = op === 'is' ? FIELD_LABELS[field] : `${FIELD_LABELS[field]} is not`
      chips.push({ field, op, text: `${label}: ${names.join(', ')}` })
    }
  }
  return chips
}
