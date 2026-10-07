import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { http, HttpResponse, type JsonBodyType } from 'msw'
import { setupServer } from 'msw/node'
import { afterEach, beforeEach, expect } from 'vitest'

import { JiraMgrError } from '../src/errors.js'
import { writeFields, writeSettings } from '../src/state.js'

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

export interface Recorded {
  method: string
  /** Path and query string, as sent. */
  path: string
  /** Parsed JSON, a `FormData` for multipart, or `undefined` for no body. */
  body: unknown
  headers: Headers
}

/** Answers every call under /rest/ with `respond`, and returns the requests it received. */
export function serveRecorded(respond: (request: Recorded) => Response): Recorded[] {
  const requests: Recorded[] = []
  server.use(
    http.all(`${JIRA_SITE}/rest/*`, async ({ request }) => {
      const { pathname, search } = new URL(request.url)
      let body: unknown
      if (request.headers.get('content-type')?.startsWith('multipart/form-data') === true) {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- the deprecation targets untrusted servers
        body = await request.formData()
      } else {
        const text = await request.text()
        body = text === '' ? undefined : (JSON.parse(text) as unknown)
      }
      const recorded = {
        method: request.method,
        path: `${pathname}${search}`,
        body,
        headers: request.headers,
      }
      requests.push(recorded)
      return respond(recorded)
    }),
  )
  return requests
}

/** The `JiraMgrError` a promise rejects with. Fails the test when it resolves or throws another. */
export async function failure(promise: Promise<unknown>): Promise<JiraMgrError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(JiraMgrError)
  return error as JiraMgrError
}

export const noContent = () => new HttpResponse(null, { status: 204 })

/** Gives each test a state folder holding PSAPAC settings and the recorded field ids. */
export function usePsapacState(): void {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jm-state-'))
    process.env.JM_STATE_DIR = dir
    await writeSettings({ siteUrl: JIRA_SITE, projectKey: 'PSAPAC' })
    await writeFields({
      site: JIRA_SITE,
      project: 'PSAPAC',
      resolvedAt: '2026-10-07T00:00:00.000Z',
      ids: {
        customer: 'customfield_14849',
        engagement: 'customfield_14850',
        sprint: 'customfield_10600',
        startDate: 'customfield_13808',
        timeRemaining: 'customfield_21785',
      },
    })
  })
  afterEach(async () => {
    delete process.env.JM_STATE_DIR
    await rm(dir, { recursive: true, force: true })
  })
}
