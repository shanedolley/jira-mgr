import type { Issue } from '@jira-mgr/core'
import { formatDate } from '@jira-mgr/core/display'
import { STATUS_ORDER } from '@jira-mgr/core/hierarchy'
import type { SprintGroup, SprintStats } from '@jira-mgr/core/sprints'

import type { SprintOption } from '../../shared/ipc'
import { shownSprints } from './properties'

/** The sprints the sidebar opens: the active one, and the next future one that has dates. */
export function sidebarSprints(sprints: readonly SprintOption[]): {
  current: SprintOption | null
  upcoming: SprintOption | null
} {
  const shown = shownSprints(sprints, false)
  return {
    current: shown.find((s) => s.state === 'active') ?? null,
    upcoming: shown.find((s) => s.state === 'future') ?? null,
  }
}

/** A sprint date as a short local day, such as `5 Oct`. */
export const formatDay = (iso: string | null): string =>
  iso === null ? 'Not set' : formatDate(iso)

/** The issues of one status, in the order the page lists them. */
export interface StatusGroup {
  status: Issue['status']
  issues: Issue[]
}

const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf('-') + 1))

/** The issues grouped by status in the Tree's status order, each group by key. */
export function groupByStatus(issues: readonly Issue[]): StatusGroup[] {
  const groups = new Map<string, StatusGroup>()
  for (const issue of issues) {
    const group = groups.get(issue.status.id) ?? { status: issue.status, issues: [] }
    group.issues.push(issue)
    groups.set(issue.status.id, group)
  }
  const rank = (name: string) => {
    const at = STATUS_ORDER.indexOf(name)
    return at < 0 ? STATUS_ORDER.length : at
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      issues: group.issues.sort((a, b) => keyNumber(a.key) - keyNumber(b.key)),
    }))
    .sort(
      (a, b) =>
        rank(a.status.name) - rank(b.status.name) || a.status.name.localeCompare(b.status.name),
    )
}

/** The tabs of the right panel, in order, each with the breakdown it shows. */
export const BREAKDOWNS = [
  { id: 'assignees', label: 'Assignees' },
  { id: 'labels', label: 'Labels' },
  { id: 'priorities', label: 'Priority' },
  { id: 'customers', label: 'Customer' },
  { id: 'engagements', label: 'Engagement' },
] as const satisfies readonly { id: keyof SprintStats; label: string }[]

export type BreakdownId = (typeof BREAKDOWNS)[number]['id']

/** The text of a breakdown row's share: "33% of 3". */
export const shareText = (group: SprintGroup): string =>
  `${String(group.percent)}% of ${String(group.total)}`

/** `part` as a whole percent of `scope`, or 0 for an empty sprint. */
export const percentOf = (part: number, scope: number): number =>
  scope === 0 ? 0 : Math.round((part / scope) * 100)
