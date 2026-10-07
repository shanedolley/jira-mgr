import type { Issue } from './issue.js'
import type { SavedView, Settings } from './state.js'

export type ViewFilters = SavedView['filters']

export interface FilterContext {
  /** The signed-in user, matched by the assignee value `me`. */
  accountId: string
}

type Matcher = (issue: Issue) => boolean

const lower = (text: string) => text.toLowerCase()

/** Builds the matcher for one field. An absent or empty list filters nothing. */
function anyOf(values: string[] | undefined, match: (value: string) => Matcher): Matcher | null {
  if (values === undefined || values.length === 0) return null
  const matchers = values.map(match)
  return (issue) => matchers.some((m) => m(issue))
}

/**
 * The predicate a view's filters describe: values within a field are alternatives (OR), and every
 * filtered field must match (AND). Returns `undefined` when the filters select everything, so a
 * caller can skip filtering.
 *
 * - `assignee`: an accountId, or `me` (the signed-in user) or `unassigned` in any case.
 * - `status` and `type`: a name (any case) or an id.
 * - `label`: an exact label, as Jira labels are case-sensitive.
 * - `sprint`: a sprint id or name (any case), or `current` (any case) for any active sprint. `current` wins over a sprint literally named "Current".
 * - `text`: a case-insensitive substring of the key or summary, trimmed.
 *
 * Pure, with no `node:` imports, so the renderer and the CLI share it.
 */
export function issueMatcher(filters: ViewFilters, context: FilterContext): Matcher | undefined {
  const text = lower((filters.text ?? '').trim())
  const matchers = [
    anyOf(filters.assignee, (v) => (issue) => {
      const keyword = lower(v)
      if (keyword === 'unassigned') return issue.assignee === null
      return issue.assignee?.accountId === (keyword === 'me' ? context.accountId : v)
    }),
    anyOf(
      filters.status,
      (v) => (issue) => issue.status.id === v || lower(issue.status.name) === lower(v),
    ),
    anyOf(filters.label, (v) => (issue) => issue.labels.includes(v)),
    anyOf(
      filters.type,
      (v) => (issue) => issue.issueType.id === v || lower(issue.issueType.name) === lower(v),
    ),
    anyOf(
      filters.sprint,
      (v) => (issue) =>
        issue.sprints.some((s) =>
          lower(v) === 'current'
            ? s.state === 'active'
            : String(s.id) === v || lower(s.name) === lower(v),
        ),
    ),
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
