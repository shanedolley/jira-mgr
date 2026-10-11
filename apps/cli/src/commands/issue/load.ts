import type { Issue } from '@jira-mgr/core'
import { searchIssuePages } from '@jira-mgr/core/search'
import { findView, type SavedView } from '@jira-mgr/core/state'
import { filtersNeedMe, issueMatcher, type ViewFilters } from '@jira-mgr/core/view-filter'

import type { Context } from '../../context.js'

/** The filter flags `issue list` and `issue tree` share. Each repeatable one is `[]` when absent. */
export interface FilterInput {
  view: string | undefined
  search: string | undefined
  assignee: string[]
  status: string[]
  label: string[]
  type: string[]
  sprint: string[]
  mine: boolean
  showDone: boolean
}

type Toggles = SavedView['toggles']

/** Where the toggles start. The settings file's toggles are the app's last UI state, so the CLI ignores them. */
const START_TOGGLES: Toggles = { hideDone: true, assigneeMe: false, hideEmptyCustomers: true }

export interface Loaded {
  /** Every issue loaded, so a tree can find the ancestors of a match. */
  issues: Issue[]
  /** The view's filters and the filter flags, as the app's own matcher takes them. */
  match: ((issue: Issue) => boolean) | undefined
  toggles: Toggles
  /** The signed-in user's account id, or `''` when nothing asked for it. */
  accountId: string
  /** Whether an issue passes the filters and the `assigneeMe` toggle. */
  wanted: (issue: Issue) => boolean
}

/**
 * Resolves the view and the flags into filters and toggles, then pages through the issues.
 * With Done hidden it skips the done phase. With `limit` it stops once that many
 * issues are wanted. An `epic` filter climbs from a Subtask through its parents, which arrive in
 * any page of either phase (a Story has a lower key than its Subtask, and may be Done), so it
 * loads both phases to the end and `wanted` hides Done as the skipped phase would have. The
 * current user is read once, and only when something asks for `me`.
 */
export async function loadIssues(
  ctx: Context,
  input: FilterInput,
  options: { showEmptyCustomers?: boolean; limit?: number } = {},
): Promise<Loaded> {
  const view = input.view === undefined ? undefined : await findView(input.view)
  const toggles = { ...START_TOGGLES, ...view?.toggles }
  if (input.mine) toggles.assigneeMe = true
  if (input.showDone) toggles.hideDone = false
  if (options.showEmptyCustomers === true) toggles.hideEmptyCustomers = false

  const filters: ViewFilters = { ...view?.filters }
  for (const field of ['assignee', 'status', 'label', 'type', 'sprint'] as const) {
    if (input[field].length > 0) filters[field] = input[field]
  }
  if (input.search !== undefined) filters.text = input.search

  const wantsMe = toggles.assigneeMe || filtersNeedMe(filters)
  const accountId = wantsMe ? (await ctx.me()).accountId : ''
  // The matcher reads `issues` as it fills, to find the Epic of a Subtask.
  const issues: Issue[] = []
  const match = issueMatcher(filters, { accountId, issues })
  const climbs = (filters.epic ?? []).length > 0 || (filters.not?.epic ?? []).length > 0
  const wanted = (issue: Issue) =>
    (!toggles.assigneeMe || issue.assignee?.accountId === accountId) &&
    (!(climbs && toggles.hideDone) || issue.status.category !== 'done') &&
    (match?.(issue) ?? true)

  let matched = 0
  const phases = toggles.hideDone && !climbs ? (['unresolved'] as const) : undefined
  for await (const page of searchIssuePages(ctx.http(), { signal: ctx.signal, phases })) {
    issues.push(...page.issues)
    matched += page.issues.filter(wanted).length
    if (!climbs && options.limit !== undefined && matched >= options.limit) break
  }
  if (ctx.io.stderrIsTTY) ctx.io.stderr.write(`Loaded ${String(issues.length)} issues\n`)
  return { issues, match, toggles, accountId, wanted }
}
