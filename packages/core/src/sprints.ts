import { z } from 'zod'

import { fetchAll } from './fields.js'
import type { HttpClient } from './http.js'
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

const sprintSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    state: z.enum(['active', 'future', 'closed']),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
  })
  .transform((sprint) => ({
    ...sprint,
    startDate: sprint.startDate ?? null,
    endDate: sprint.endDate ?? null,
  }))

export type Sprint = z.infer<typeof sprintSchema>

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
