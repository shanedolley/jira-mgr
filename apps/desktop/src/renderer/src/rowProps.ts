import type { Issue } from '@jira-mgr/core'
import { dayKey } from '@jira-mgr/core/view-filter'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The local day of a due date (`2026-10-11`) or of a Jira timestamp, as `YYYY-MM-DD`. */
export const localDay = (text: string) => (text.length === 10 ? text : dayKey(new Date(text)))

const dayNumber = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000
}

/** `Oct 14` in the year of `today`, and `Oct 14 '25` in any other. The full date goes in a title. */
export function shortDate(text: string, today: string): string {
  const day = localDay(text)
  const [y, m, d] = day.split('-')
  const month = MONTHS[Number(m) - 1] ?? ''
  const date = `${month} ${String(Number(d))}`
  return y === today.slice(0, 4) ? date : `${date} '${(y ?? '').slice(2)}`
}

export type DueTone = 'overdue' | 'soon' | 'later'

/**
 * How near a due date is: `overdue` for today or earlier, `soon` within the next seven days and
 * `later` after that. A Done issue is never overdue or soon, since nothing is left to do by then.
 */
export function dueTone(due: string, today: string, done: boolean): DueTone {
  if (done) return 'later'
  const days = dayNumber(localDay(due)) - dayNumber(today)
  if (days <= 0) return 'overdue'
  return days <= 7 ? 'soon' : 'later'
}

/** The sprint a row names: the active one, else the newest. `undefined` when the issue has none. */
export function rowSprint(issue: Issue): Issue['sprints'][number] | undefined {
  return (
    issue.sprints.find((s) => s.state === 'active') ??
    issue.sprints.reduce<Issue['sprints'][number] | undefined>(
      (newest, s) => (newest === undefined || s.id > newest.id ? s : newest),
      undefined,
    )
  )
}
