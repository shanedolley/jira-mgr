import type { Issue } from '@jira-mgr/core'
import { parentCandidates } from '@jira-mgr/core/issue'

import type { FieldChoice, SprintOption, StatusOption, UserOption } from '../../shared/ipc'
import type { Notice } from './create'

/**
 * The pure model behind the issue page's pickers: the choices each one lists, the patch each
 * choice makes to the issue for the optimistic edit, and the Customer prompt for a new parent.
 * The rules of what Jira allows stay in core; this only shapes what the pickers show.
 */

/** Case-insensitive substring match; an empty query matches everything. */
export const matches = (text: string, query: string) =>
  text.toLowerCase().includes(query.trim().toLowerCase())

interface Option {
  id: string
  value: string
}

/** The id of the "nothing" choice in a picker: Unassigned, Backlog. */
export const NONE = '__none__'

export const STATE_LABELS: Record<SprintOption['state'], string> = {
  active: 'Active',
  future: 'Future',
  closed: 'Closed',
}

/** An assignee, as the pickers list one. */
export type Person = Pick<UserOption, 'accountId' | 'displayName' | 'avatarUrl'>

/**
 * People assigned to the loaded issues, most recently touched first (Q24), without `meId`. Jira
 * keeps no history of who the user assigned to, so the issue's `updated` time stands in for it.
 */
export function recentAssignees(issues: readonly Issue[], meId: string, limit = 5): Person[] {
  const latest = new Map<string, { person: Person; time: number }>()
  for (const { assignee, updated } of issues) {
    if (assignee === null || assignee.accountId === meId) continue
    const time = Date.parse(updated)
    const seen = latest.get(assignee.accountId)
    if (seen === undefined || time > seen.time)
      latest.set(assignee.accountId, { person: assignee, time })
  }
  return [...latest.values()]
    .sort((a, b) => b.time - a.time || a.person.displayName.localeCompare(b.person.displayName))
    .slice(0, limit)
    .map(({ person }) => person)
}

/** The people for the assignee picker, in order: the suggested ones, then the rest of the search. */
export function assigneeChoices(
  me: Person | undefined,
  recent: readonly Person[],
  found: readonly Person[],
  query: string,
): { suggested: Person[]; others: Person[] } {
  const suggested = [...(me === undefined ? [] : [me]), ...recent].filter((person) =>
    matches(person.displayName, query),
  )
  const taken = new Set(suggested.map((person) => person.accountId))
  return { suggested, others: found.filter((person) => !taken.has(person.accountId)) }
}

interface AssigneeOption {
  id: string
  label: string
  detail?: string
  group: string
}

/**
 * The assignee picker's options: Unassigned when the query allows it, then the suggested people
 * (the user shown as "Me"), then the rest of the search.
 */
export function assigneeOptions(
  choices: { suggested: readonly Person[]; others: readonly Person[] },
  query: string,
  meId: string | undefined,
): AssigneeOption[] {
  return [
    ...('unassigned'.includes(query.trim().toLowerCase())
      ? [{ id: NONE, label: 'Unassigned', group: 'Suggested' }]
      : []),
    ...choices.suggested.map((p) => ({
      id: p.accountId,
      label: p.accountId === meId ? 'Me' : p.displayName,
      ...(p.accountId === meId ? { detail: p.displayName } : {}),
      group: 'Suggested',
    })),
    ...choices.others.map((p) => ({ id: p.accountId, label: p.displayName, group: 'People' })),
  ]
}

const SPRINT_ORDER = { active: 0, future: 1, closed: 2 } as const

/**
 * The sprints to offer (Q20): the active sprint and future sprints that have dates. Closed and
 * undated ones, such as a template sprint, wait behind "Show all".
 */
export function shownSprints(sprints: readonly SprintOption[], showAll: boolean): SprintOption[] {
  const order = (a: SprintOption, b: SprintOption) =>
    SPRINT_ORDER[a.state] - SPRINT_ORDER[b.state] ||
    (a.state === 'closed'
      ? (b.endDate ?? '').localeCompare(a.endDate ?? '')
      : (a.startDate ?? '9').localeCompare(b.startDate ?? '9')) ||
    a.name.localeCompare(b.name)
  return sprints
    .filter(
      (s) => showAll || s.state === 'active' || (s.state === 'future' && s.startDate !== null),
    )
    .sort(order)
}

/** The sprint the issue is in now: the active one, else a future one. `null` means the backlog. */
export function currentSprint(issue: Pick<Issue, 'sprints'>): Issue['sprints'][number] | null {
  return (
    issue.sprints.find((s) => s.state === 'active') ??
    issue.sprints.find((s) => s.state === 'future') ??
    null
  )
}

/** Labels used by the loaded issues, the most used first. Labels are site-wide, so these are the project's (Q35). */
export function projectLabels(issues: readonly Issue[]): string[] {
  const counts = new Map<string, number>()
  for (const { labels } of issues) for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label)
}

/** A label holds no spaces, as core checks. */
export const isLabel = (text: string) => /^\S+$/.test(text) && text.length <= 255

const BY_KEY_DESC = (a: Issue, b: Issue) =>
  Number(a.status.category === 'done') - Number(b.status.category === 'done') ||
  b.key.localeCompare(a.key, 'en', { numeric: true })

/** The parents the issue may take whose key or summary matches `query`, open ones first, at most `limit`. */
export function parentChoices(
  issue: Pick<Issue, 'key'> & { issueType: Pick<Issue['issueType'], 'subtask' | 'hierarchyLevel'> },
  issues: readonly Issue[],
  query: string,
  limit = 50,
): { shown: Issue[]; total: number } {
  const all = parentCandidates(issue, issues)
    .filter((p) => matches(`${p.key} ${p.summary}`, query))
    .sort(BY_KEY_DESC)
  return { shown: all.slice(0, limit), total: all.length }
}

export interface ParentMatch {
  /** The parent's Customer when the issue has another, else `null`. */
  customer: Option | null
  engagement: Option | null
}

/**
 * What a new parent holds that differs from the issue (Q16): its Customer and Engagement where
 * it has one and the issue has another or none. Both `null` means moving needs no question.
 */
export function parentMatch(
  issue: Pick<Issue, 'customer' | 'engagement'>,
  parent: Pick<Issue, 'customer' | 'engagement'>,
): ParentMatch {
  const differs = (own: Option | null, other: Option | null) =>
    other !== null && own?.id !== other.id ? other : null
  return {
    customer: differs(issue.customer, parent.customer),
    engagement: differs(issue.engagement, parent.engagement),
  }
}

/** "Customer", "Engagement" or "Customer and Engagement", for the prompt's wording. */
export function matchWords({ customer, engagement }: ParentMatch): string {
  return [customer && 'Customer', engagement && 'Engagement'].filter(Boolean).join(' and ')
}

/**
 * What `I` does on an issue: wait when the signed-in user has not loaded (so nobody is compared
 * with an unassigned issue), leave an issue that is already theirs, otherwise take it.
 */
export function assignMeOutcome(
  issue: Pick<Issue, 'assignee'>,
  me: { accountId: string } | undefined,
): 'wait' | 'mine' | 'assign' {
  if (me === undefined) return 'wait'
  return issue.assignee?.accountId === me.accountId ? 'mine' : 'assign'
}

export const assigneePatch = (person: Person | null): Partial<Issue> => ({
  assignee: person === null ? null : { ...person },
})

export const statusPatch = (issue: Issue, option: StatusOption): Partial<Issue> => ({
  status: { id: option.id, name: option.name, category: option.category ?? issue.status.category },
})

export const priorityPatch = (choice: FieldChoice): Partial<Issue> => ({
  priority: { id: choice.id, name: choice.name },
})

export const typePatch = (issue: Issue, choice: FieldChoice): Partial<Issue> => ({
  issueType: { ...issue.issueType, id: choice.id, name: choice.name },
})

export const customerPatch = (choice: FieldChoice): Partial<Issue> => ({
  customer: { id: choice.id, value: choice.name },
})

export const engagementPatch = (choice: FieldChoice): Partial<Issue> => ({
  engagement: { id: choice.id, value: choice.name },
})

/** The issue's labels with `label` added or removed. */
export const labelsPatch = (issue: Issue, label: string, on: boolean): Partial<Issue> => ({
  labels: on
    ? [...issue.labels.filter((l) => l !== label), label]
    : issue.labels.filter((l) => l !== label),
})

/** Moving into a sprint keeps the closed sprints the issue was in before; the backlog drops the open one. */
export const sprintPatch = (issue: Issue, sprint: SprintOption | null): Partial<Issue> => ({
  sprints: [
    ...issue.sprints.filter((s) => s.state === 'closed'),
    ...(sprint === null ? [] : [{ id: sprint.id, name: sprint.name, state: sprint.state }]),
  ],
})

/** Jira's answer as main words it: "Jira answered 400: <reason>", or "Jira answered 403. <next step>". */
const ANSWER = /^Jira answered \d{3}(?::\s*|\.\s*)/

/**
 * The toast for an edit that failed, which has shown the old value again: "Priority not changed.
 * Jira refused it: <reason>." Main has dropped the request from the message already. A failure
 * that is not an answer from Jira, such as a lost connection, says so in its own words.
 */
export function refusedNotice(what: string, failure: unknown): Notice {
  const message = failure instanceof Error ? failure.message : String(failure)
  const answer = ANSWER.exec(message)
  const reason = answer === null ? message : `Jira refused it: ${message.slice(answer[0].length)}`
  return {
    title: `${what} not changed. ${/[.!?]$/.test(reason) ? reason : `${reason}.`}`,
    notes: [],
    warned: true,
  }
}
