import type { Issue } from '@jira-mgr/core'
import { STATUS_ORDER } from '@jira-mgr/core/hierarchy'
import type { ViewFilters } from '@jira-mgr/core/view-filter'

/** The five fields the Filter menu lists. The text field is the toolbar's own input. */
export const FILTER_FIELDS = ['assignee', 'status', 'label', 'type', 'sprint'] as const
export type FilterField = (typeof FILTER_FIELDS)[number]

export const FIELD_LABELS: Record<FilterField, string> = {
  assignee: 'Assignee',
  status: 'Status',
  label: 'Label',
  type: 'Type',
  sprint: 'Sprint',
}

/** One checkbox: the `value` core and the CLI read, and the text the user sees. */
export interface Choice {
  value: string
  label: string
}

const byLabel = (a: Choice, b: Choice) =>
  a.label.localeCompare(b.label, 'en', { sensitivity: 'base' })

/**
 * The choices for each field. The filter can only match loaded issues, so every field but Status
 * lists what the loaded issues hold; Status lists the Q21 order first, then any other status.
 */
export function filterChoices(issues: readonly Issue[]): Record<FilterField, Choice[]> {
  const assignees = new Map<string, Choice>()
  const statuses = new Set<string>()
  const labels = new Set<string>()
  const types = new Set<string>()
  const sprints = new Map<string, Choice & { active: boolean }>()
  for (const issue of issues) {
    if (issue.assignee !== null) {
      assignees.set(issue.assignee.accountId, {
        value: issue.assignee.accountId,
        label: issue.assignee.displayName,
      })
    }
    statuses.add(issue.status.name)
    for (const label of issue.labels) labels.add(label)
    types.add(issue.issueType.name)
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
    status: [...STATUS_ORDER, ...others.sort()].map((name) => ({ value: name, label: name })),
    label: named(labels),
    type: named(types),
    sprint: [
      { value: 'current', label: 'Current sprint' },
      ...[...sprints.values()]
        .sort((a, b) => Number(b.active) - Number(a.active) || byLabel(a, b))
        .map(({ value, label }) => ({ value, label })),
    ],
  }
}

function without(filters: ViewFilters, field: keyof ViewFilters): ViewFilters {
  return Object.fromEntries(Object.entries(filters).filter(([key]) => key !== field))
}

/** The filters with `value` added to, or removed from, one field. An emptied field is dropped. */
export function toggleChoice(filters: ViewFilters, field: FilterField, value: string): ViewFilters {
  const held = filters[field] ?? []
  const next = held.includes(value) ? held.filter((v) => v !== value) : [...held, value]
  return next.length === 0 ? without(filters, field) : { ...filters, [field]: next }
}

export function clearField(filters: ViewFilters, field: FilterField): ViewFilters {
  return without(filters, field)
}

/** The filters with the text replaced. An empty text is dropped. */
export function withText(filters: ViewFilters, text: string): ViewFilters {
  return text === '' ? without(filters, 'text') : { ...filters, text }
}

/** True when any field, the text included, filters something. */
export function hasFilters(filters: ViewFilters): boolean {
  return (
    FILTER_FIELDS.some((field) => (filters[field]?.length ?? 0) > 0) ||
    (filters.text ?? '').trim() !== ''
  )
}

export interface FilterChip {
  field: FilterField
  /** "Status: To Do, In Progress". */
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

/** One chip per filtered field, naming the choices by their labels. */
export function filterChips(
  filters: ViewFilters,
  choices: Record<FilterField, Choice[]>,
): FilterChip[] {
  const chips: FilterChip[] = []
  for (const field of FILTER_FIELDS) {
    const values = filters[field] ?? []
    if (values.length === 0) continue
    const names = values.map(
      (value) =>
        choices[field].find((c) => c.value === value)?.label ??
        // A value typed into a saved view that no loaded issue holds shows as stored.
        value,
    )
    chips.push({ field, text: `${FIELD_LABELS[field]}: ${names.join(', ')}` })
  }
  return chips
}
