import { z } from 'zod'

import { adfDocSchema } from './adf-schema.js'
import { JiraMgrError } from './errors.js'
import { getFieldIds } from './fields.js'
import type { HttpClient } from './http.js'
import { issueSchema, type Issue, type IssueDetail } from './issue.js'
import { readSettings, type FieldIds } from './state.js'
import { issueKey, parseInput, parseResponse } from './validate.js'

const PAGE_SIZE = 100

/** Unresolved issues load first, Done second. */
const PHASES = [
  ['unresolved', 'statusCategory != Done'],
  ['done', 'statusCategory = Done'],
] as const

export type SearchPhase = (typeof PHASES)[number][0]

export interface SearchOptions {
  pageSize?: number
  /** The phases to load, in load order. Defaults to both. A skipped phase sends no request. */
  phases?: readonly SearchPhase[]
  signal?: AbortSignal
}

export interface SearchPage {
  phase: SearchPhase
  issues: Issue[]
  /** Issues loaded so far across both phases. Jira sends no total, so there is no percentage. */
  loaded: number
}

/** The most results one text search returns. */
export const TEXT_SEARCH_LIMIT = 50

/** The longest text one search takes. */
export const TEXT_QUERY_MAX = 200

/** Jira refuses a tab or NUL in a `text ~` string and has no escape for them, so each becomes a space. */
const withoutControls = (text: string) =>
  Array.from(text, (c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? ' ' : c)).join('')

const textQuery = z
  .string()
  .max(TEXT_QUERY_MAX)
  .transform((text) => withoutControls(text).trim())
  .pipe(z.string().min(1, 'Enter text to search for.'))

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
    'creator',
    'issuelinks',
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
 * Pages through one JQL query, yielding each page's issues. Jira sends a token with every page
 * but the last, and a token it already sent is an error, so the loop always ends. Aborting
 * `signal` stops the paging.
 */
export async function* searchJqlPages(
  http: HttpClient,
  jql: string,
  options: { pageSize?: number; signal?: AbortSignal } = {},
): AsyncGenerator<Issue[]> {
  const ids = await getFieldIds()
  const fields = requestedFields(ids)
  const pageSchema = z.object({
    issues: z.array(issueSchema(ids)),
    nextPageToken: z.string().optional(),
    isLast: z.boolean(),
  })
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
    yield page.data.issues
    if (page.data.isLast) return
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

  let loaded = 0
  for (const [phase, condition] of PHASES) {
    if (options.phases?.includes(phase) === false) continue
    const jql = `project = ${quote(settings.projectKey)} AND ${condition} ORDER BY key DESC`
    for await (const issues of searchJqlPages(http, jql, options)) {
      loaded += issues.length
      yield { phase, issues, loaded }
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

/**
 * The JQL string for `text ~`. Jira hands the text to Lucene, which reads `*`, `~`, `:` and the
 * like as operators, so each is escaped first and the query matches the words as typed. The JQL
 * quoting then doubles those backslashes.
 */
const luceneLiteral = (text: string) => text.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&')

/**
 * Issues in the project whose summary, description, comments or other text fields hold `text`,
 * most recently updated first, at most `TEXT_SEARCH_LIMIT`. One request, no paging. Throws
 * `validation_failed` for empty or over-long text before anything is sent. Aborting `signal`
 * rejects the request.
 */
export async function searchText(
  http: HttpClient,
  text: string,
  options: { signal?: AbortSignal } = {},
): Promise<Issue[]> {
  const query = parseInput(textQuery, text, 'search text')
  const settings = await readSettings()
  if (settings.projectKey === undefined) {
    throw new JiraMgrError('permission_denied', 'No project is set. Run `jm auth login`.')
  }
  const ids = await getFieldIds()
  const raw = await http.request('POST', '/rest/api/3/search/jql', {
    body: {
      jql: `project = ${quote(settings.projectKey)} AND text ~ ${quote(luceneLiteral(query))} ORDER BY updated DESC`,
      fields: requestedFields(ids),
      maxResults: TEXT_SEARCH_LIMIT,
    },
    signal: options.signal,
  })
  return parseResponse(z.object({ issues: z.array(issueSchema(ids)) }), raw, 'search').issues
}

export type { IssueDetail }

const detailSchema = z.object({
  fields: z.object({
    description: adfDocSchema.nullish(),
    subtasks: z
      .array(
        z.object({
          key: z.string(),
          fields: z.object({
            summary: z.string(),
            status: z.object({
              name: z.string(),
              statusCategory: z.object({ key: z.string() }).nullish(),
            }),
          }),
        }),
      )
      .nullish(),
  }),
})

/**
 * One issue with its description and subtasks, which the searches leave out. Throws `not_found`
 * when the issue does not exist.
 */
export async function getIssue(
  http: HttpClient,
  key: string,
  options: { signal?: AbortSignal } = {},
): Promise<IssueDetail> {
  const issue = parseInput(issueKey, key, 'get the issue')
  const ids = await getFieldIds()
  const fields = [...requestedFields(ids), 'description', 'subtasks'].join(',')
  const raw = await http.request('GET', `/rest/api/3/issue/${issue}?fields=${fields}`, options)
  const base = parseResponse(issueSchema(ids), raw, 'issue')
  const { description, subtasks } = parseResponse(detailSchema, raw, 'issue').fields
  return {
    ...base,
    description: description ?? null,
    subtasks: (subtasks ?? []).map((s) => ({
      key: s.key,
      summary: s.fields.summary,
      status: s.fields.status.name,
      done: s.fields.status.statusCategory?.key === 'done',
    })),
  }
}
