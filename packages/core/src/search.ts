import { z } from 'zod'

import { JiraMgrError } from './errors.js'
import { getFieldIds } from './fields.js'
import type { HttpClient } from './http.js'
import { issueSchema, type Issue } from './issue.js'
import { readSettings, type FieldIds } from './state.js'

const PAGE_SIZE = 100

/** Unresolved issues load first, Done second. */
const PHASES = [
  ['unresolved', 'statusCategory != Done'],
  ['done', 'statusCategory = Done'],
] as const

export type SearchPhase = (typeof PHASES)[number][0]

export interface SearchOptions {
  pageSize?: number
  signal?: AbortSignal
}

export interface SearchPage {
  phase: SearchPhase
  issues: Issue[]
  /** Issues loaded so far across both phases. Jira sends no total, so there is no percentage. */
  loaded: number
}

const quote = (text: string) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

/** Only the fields `Issue` needs, with the resolved custom field ids. */
function requestedFields(ids: FieldIds): string[] {
  return [
    'summary',
    'issuetype',
    'status',
    'resolution',
    'parent',
    'assignee',
    'labels',
    'priority',
    'timetracking',
    'duedate',
    'created',
    'updated',
    ids.customer,
    ids.engagement,
    ids.sprint,
    ids.startDate,
    ids.timeRemaining,
  ]
}

/**
 * Pages through the project's issues, unresolved first and then Done, yielding each page with the
 * running count. Each phase orders by key, which never changes, so an edit made mid-load cannot
 * shift an issue across a page boundary as `updated` would. Aborting `signal` stops the paging.
 */
export async function* searchIssuePages(
  http: HttpClient,
  options: SearchOptions = {},
): AsyncGenerator<SearchPage> {
  const settings = await readSettings()
  if (settings.projectKey === undefined) {
    throw new JiraMgrError('permission_denied', 'No project is set. Run `jm auth login`.')
  }
  const ids = await getFieldIds()
  const fields = requestedFields(ids)
  const pageSchema = z.object({
    issues: z.array(issueSchema(ids)),
    nextPageToken: z.string().optional(),
    isLast: z.boolean(),
  })

  let loaded = 0
  for (const [phase, condition] of PHASES) {
    const jql = `project = ${quote(settings.projectKey)} AND ${condition} ORDER BY key DESC`
    let nextPageToken: string | undefined
    const seen = new Set<string>()
    for (;;) {
      const raw = await http.request('POST', '/rest/api/3/search/jql', {
        body: { jql, fields, maxResults: options.pageSize ?? PAGE_SIZE, nextPageToken },
        signal: options.signal,
      })
      const page = pageSchema.safeParse(raw)
      if (!page.success) {
        throw new JiraMgrError('jira_error', 'Jira sent an unexpected search response.', {
          details: { issues: page.error.issues },
        })
      }
      loaded += page.data.issues.length
      yield { phase, issues: page.data.issues, loaded }
      if (page.data.isLast) break
      nextPageToken = page.data.nextPageToken
      if (nextPageToken === undefined) {
        throw new JiraMgrError('jira_error', 'Jira sent another page but no token to fetch it.')
      }
      if (seen.has(nextPageToken)) {
        throw new JiraMgrError('jira_error', 'Jira sent a page token it had already sent.')
      }
      seen.add(nextPageToken)
    }
  }
}

/** Every issue in load order. Use `searchIssuePages` to show progress. */
export async function searchIssues(
  http: HttpClient,
  options: SearchOptions = {},
): Promise<Issue[]> {
  const issues: Issue[] = []
  for await (const page of searchIssuePages(http, options)) issues.push(...page.issues)
  return issues
}
