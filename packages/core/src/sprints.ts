import { z } from 'zod'

import { fetchAll, getFieldIds } from './fields.js'
import type { HttpClient } from './http.js'
import { issueSchema, type Issue } from './issue.js'
import { requestedFields } from './search.js'
import { issueKey, parseInput, parseResponse, projectKeyOrSettings } from './validate.js'

/** Jira moves at most this many issues in one call. */
const MAX_ISSUES = 50

const issueKeys = z.array(issueKey).min(1).max(MAX_ISSUES)
/** Kanban boards have no sprints, so their sprint endpoint answers 400. */
const SPRINT_BOARD_TYPES = ['scrum', 'simple']
const positiveInt = z.number().int().positive()

const boardsPage = z.object({
  values: z.array(z.object({ id: z.number(), name: z.string(), type: z.string() })),
})

export type Board = z.infer<typeof boardsPage>['values'][number]

/**
 * The board of the project that supports sprints (type `scrum` or `simple`), from settings
 * unless `projectKey` is given. It returns `null` when the project has none, a Kanban board
 * included, and the first of several.
 */
// ponytail: first board only, offer a choice when a project with several boards needs it.
export async function findBoard(http: HttpClient, projectKey?: string): Promise<Board | null> {
  const project = await projectKeyOrSettings(projectKey)
  const raw = await http.request(
    'GET',
    `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(project)}`,
  )
  const boards = parseResponse(boardsPage, raw, 'boards').values
  return boards.find((board) => SPRINT_BOARD_TYPES.includes(board.type)) ?? null
}

const sprintFields = {
  id: z.number(),
  name: z.string(),
  state: z.enum(['active', 'future', 'closed']),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
}

const sprintSchema = z.object(sprintFields).transform((sprint) => ({
  ...sprint,
  startDate: sprint.startDate ?? null,
  endDate: sprint.endDate ?? null,
}))

export type Sprint = z.infer<typeof sprintSchema>

/** A sprint with its goal. The goal is left off `Sprint`, so `jm sprint list --json` keeps its shape. */
const sprintDetailSchema = z
  .object({ ...sprintFields, goal: z.string().nullish() })
  .transform((sprint) => ({
    ...sprint,
    startDate: sprint.startDate ?? null,
    endDate: sprint.endDate ?? null,
    goal: sprint.goal === '' ? null : (sprint.goal ?? null),
  }))

export type SprintDetail = z.infer<typeof sprintDetailSchema>

const sprintsPage = z
  .object({ total: z.number(), values: z.array(sprintSchema) })
  .transform((page) => ({ total: page.total, items: page.values }))

/**
 * The sprints of a board: active and future ones, or every sprint with `all`. Dates are ISO
 * strings, `null` on an undated sprint.
 */
export async function listSprints(
  http: HttpClient,
  boardId: number,
  options: { all?: boolean } = {},
): Promise<Sprint[]> {
  const id = parseInput(positiveInt, boardId, 'list sprints')
  const path = `/rest/agile/1.0/board/${String(id)}/sprint`
  return fetchAll(http, options.all === true ? path : `${path}?state=active,future`, sprintsPage)
}

/** Moves issues into a sprint. */
export async function moveToSprint(
  http: HttpClient,
  sprintId: number,
  keys: string[],
): Promise<void> {
  const input = parseInput(
    z.strictObject({ sprintId: positiveInt, keys: issueKeys }),
    { sprintId, keys },
    'move the issues into the sprint',
  )
  await http.request('POST', `/rest/agile/1.0/sprint/${String(input.sprintId)}/issue`, {
    body: { issues: input.keys },
  })
}

/** Moves issues out of their sprint to the backlog. */
export async function moveToBacklog(http: HttpClient, keys: string[]): Promise<void> {
  const issues = parseInput(issueKeys, keys, 'move the issues to the backlog')
  await http.request('POST', '/rest/agile/1.0/backlog/issue', { body: { issues } })
}

/** One sprint: the same fields `listSprints` gives, plus the goal. Throws `not_found` for an unknown id. */
export async function getSprint(http: HttpClient, sprintId: number): Promise<SprintDetail> {
  const id = parseInput(positiveInt, sprintId, 'read the sprint')
  const raw = await http.request('GET', `/rest/agile/1.0/sprint/${String(id)}`)
  return parseResponse(sprintDetailSchema, raw, 'sprint')
}

/** Every issue in the sprint, paged. Read-only: it reads the sprint's issues and moves none. */
export async function listSprintIssues(
  http: HttpClient,
  sprintId: number,
  options: { comments?: boolean } = {},
): Promise<Issue[]> {
  const id = parseInput(positiveInt, sprintId, 'list the sprint issues')
  const ids = await getFieldIds()
  const page = z
    .object({ total: z.number(), issues: z.array(issueSchema(ids)) })
    .transform((p) => ({ total: p.total, items: p.issues }))
  const fields = requestedFields(ids, options.comments).join(',')
  return fetchAll(http, `/rest/agile/1.0/sprint/${String(id)}/issue?fields=${fields}`, page)
}

/** The issues of one sprint, counted by status category and by assignee, label and the rest. */
export interface SprintStats {
  /** Every issue in the sprint. */
  scope: number
  /** Issues whose status category is In Progress. A Done issue counts as completed, not started. */
  started: number
  /** Issues whose status category is Done. */
  completed: number
  assignees: SprintGroup[]
  labels: SprintGroup[]
  priorities: SprintGroup[]
  customers: SprintGroup[]
  engagements: SprintGroup[]
}

/** The issues sharing one value, such as one assignee: how many, and how many of them are completed. */
export interface SprintGroup {
  /** The value's id, or `''` for the group of issues with none. */
  id: string
  name: string
  /** The assignee's image URL. Set on assignee groups only. */
  avatarUrl?: string | null
  /** "M" of "N% of M". */
  total: number
  completed: number
  /** "N" of "N% of M": `completed` as a whole percent of `total`. */
  percent: number
}

interface Value {
  id: string
  name: string
  avatarUrl?: string | null
}

/** Groups `issues` by the values `valuesOf` names. An issue with no value joins the group called `none`. */
function groupBy(
  issues: readonly Issue[],
  valuesOf: (issue: Issue) => Value[],
  none: string,
): SprintGroup[] {
  const groups = new Map<string, SprintGroup>()
  for (const issue of issues) {
    const values = valuesOf(issue)
    for (const value of values.length === 0 ? [{ id: '', name: none }] : values) {
      const group = groups.get(value.id) ?? { ...value, total: 0, completed: 0, percent: 0 }
      group.total++
      if (issue.status.category === 'done') group.completed++
      group.percent = Math.round((group.completed / group.total) * 100)
      groups.set(value.id, group)
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.id === '') - Number(b.id === '') ||
      b.total - a.total ||
      a.name.localeCompare(b.name),
  )
}

/**
 * The counts of the sprint page. Completed means the status category is Done, whatever the
 * status is called, and started means In Progress. A breakdown row reads "N% of M": M issues
 * share the value, N percent of them completed.
 */
export function sprintStats(issues: readonly Issue[]): SprintStats {
  const inCategory = (category: Issue['status']['category']) =>
    issues.filter((issue) => issue.status.category === category).length
  return {
    scope: issues.length,
    started: inCategory('indeterminate'),
    completed: inCategory('done'),
    assignees: groupBy(
      issues,
      ({ assignee }) =>
        assignee === null
          ? []
          : [{ id: assignee.accountId, name: assignee.displayName, avatarUrl: assignee.avatarUrl }],
      'Unassigned',
    ),
    labels: groupBy(issues, ({ labels }) => labels.map((id) => ({ id, name: id })), 'No label'),
    priorities: groupBy(
      issues,
      ({ priority }) => (priority === null ? [] : [{ id: priority.id, name: priority.name }]),
      'No priority',
    ),
    customers: groupBy(
      issues,
      ({ customer }) => (customer === null ? [] : [{ id: customer.id, name: customer.value }]),
      'No Customer',
    ),
    engagements: groupBy(
      issues,
      ({ engagement }) =>
        engagement === null ? [] : [{ id: engagement.id, name: engagement.value }],
      'No Engagement',
    ),
  }
}

export interface SprintReport {
  sprint: SprintDetail
  issues: Issue[]
  stats: SprintStats
}

/** What the sprint page shows: the sprint, its issues and their counts. */
export async function readSprint(
  http: HttpClient,
  sprintId: number,
  options: { comments?: boolean } = {},
): Promise<SprintReport> {
  const [sprint, issues] = await Promise.all([
    getSprint(http, sprintId),
    listSprintIssues(http, sprintId, options),
  ])
  return { sprint, issues, stats: sprintStats(issues) }
}
