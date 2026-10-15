import type { Issue } from '@jira-mgr/core'
import { propertyRules } from '@jira-mgr/core/issue'

import type { SavedView } from '../../shared/ipc'
import { fitsParent } from './create'
import { keyOf } from './keymap'

/**
 * What the palette can do to the issue in context. Every id but `subIssue` and
 * `openInJira` is also the name of a command in `keymap.ts`, which is how its key shows.
 */
export type ActionId =
  | 'assignee'
  | 'assignMe'
  | 'status'
  | 'priority'
  | 'labels'
  | 'sprint'
  | 'subIssue'
  | 'copyKey'
  | 'copyLink'
  | 'openInJira'

export interface IssueAction {
  id: ActionId
  label: string
  /** Whether the issue's type allows it; an action that could not run is not listed. */
  allowed: (issue: Issue) => boolean
}

const always = () => true

/** In the order the palette lists them. */
export const ISSUE_ACTIONS: readonly IssueAction[] = [
  { id: 'assignee', label: 'Assign', allowed: always },
  { id: 'assignMe', label: 'Assign to me', allowed: always },
  { id: 'status', label: 'Change status', allowed: always },
  { id: 'priority', label: 'Change priority', allowed: always },
  { id: 'labels', label: 'Add labels', allowed: always },
  { id: 'sprint', label: 'Set sprint', allowed: (i) => propertyRules(i.issueType).sprint },
  { id: 'subIssue', label: 'Create sub-issue', allowed: (i) => fitsParent('Subtask', i) },
  { id: 'copyKey', label: 'Copy key', allowed: always },
  { id: 'copyLink', label: 'Copy link', allowed: always },
  { id: 'openInJira', label: 'Open in Jira', allowed: always },
]

/** One action row: its label and, when a global shortcut runs the same thing, that key. */
export interface ActionRow {
  id: ActionId
  label: string
  key: string | undefined
}

/** Whether every word of `query` appears in `label`, in any case. An empty query fits all. */
export function labelMatches(label: string, query: string): boolean {
  const text = label.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .every((word) => text.includes(word))
}

/** The actions `issue` allows whose label fits `query`. */
export function matchingActions(issue: Issue | null, query: string): ActionRow[] {
  if (issue === null) return []
  return ISSUE_ACTIONS.filter((a) => a.allowed(issue) && labelMatches(a.label, query)).map((a) => ({
    id: a.id,
    label: a.label,
    key: keyOf(a.id),
  }))
}

/** The saved views whose name fits `query`. The "Go to view" lead-in is not searched. */
export function matchingViews(views: readonly SavedView[], query: string): SavedView[] {
  return views.filter((v) => labelMatches(v.name, query))
}

/**
 * The row Enter takes before the user moves: the first loaded issue when any matches, so Enter
 * opens an issue as it did before the palette had actions, else the first action or view, else the
 * first Jira text match. The Jira matches land a moment after the user stops typing, so they never
 * take the highlight from a row already shown.
 */
export function defaultRow<T>(
  loaded: readonly T[],
  lead: readonly T[],
  jira: readonly T[],
): T | undefined {
  return loaded[0] ?? lead[0] ?? jira[0]
}
