import { readFileSync } from 'node:fs'

import { http, HttpResponse, type JsonBodyType } from 'msw'
import { setupServer } from 'msw/node'

export const JIRA_SITE = 'https://engineering-collibra.atlassian.net'

export const server = setupServer()

const fixturesDir = new URL('../fixtures/', import.meta.url)

/** Reads a recorded fixture, parsed. */
export function loadFixture(name: string): JsonBodyType {
  return JSON.parse(readFileSync(new URL(`${name}.json`, fixturesDir), 'utf8')) as JsonBodyType
}

export interface CreatemetaField {
  key: string
  name: string
}

const ISSUE_TYPES = [
  ['11500', 'task'],
  ['11501', 'bug'],
  ['11502', 'story'],
  ['11503', 'epic'],
  ['11504', 'subtask'],
] as const

/**
 * Answers the createmeta calls for PSAPAC from the recorded fixtures, one per issue type, and
 * returns the requested URLs. `edit` changes a type's fields, and `pageSize` serves every
 * listing in pages of that size, as Jira does.
 */
export function serveCreatemeta(
  options: {
    edit?: (type: string, fields: CreatemetaField[]) => CreatemetaField[]
    pageSize?: number
  } = {},
): string[] {
  const requested: string[] = []
  const base = `${JIRA_SITE}/rest/api/3/issue/createmeta/PSAPAC/issuetypes`

  function serve(url: string, name: string, list: 'issueTypes' | 'fields', type: string) {
    server.use(
      http.get(url, ({ request }) => {
        const { pathname, searchParams, search } = new URL(request.url)
        requested.push(`${pathname}${search}`)
        const body = loadFixture(name) as Partial<Record<typeof list, CreatemetaField[]>>
        let all = body[list] ?? []
        if (list === 'fields') all = options.edit?.(type, all) ?? all
        const startAt = Number(searchParams.get('startAt'))
        const maxResults = options.pageSize ?? 50
        return HttpResponse.json({
          startAt,
          maxResults,
          total: all.length,
          [list]: all.slice(startAt, startAt + maxResults),
        })
      }),
    )
  }

  serve(base, 'createmeta-issuetypes', 'issueTypes', '')
  for (const [id, name] of ISSUE_TYPES) serve(`${base}/${id}`, `createmeta-${name}`, 'fields', name)
  return requested
}

/** Answers `method path` on the Jira site origin with the recorded fixture. */
export function serveFixture(method: 'get' | 'post', path: string, name: string): void {
  server.use(http[method](`${JIRA_SITE}${path}`, () => HttpResponse.json(loadFixture(name))))
}
