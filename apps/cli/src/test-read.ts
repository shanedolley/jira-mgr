import { createHttpClient } from '@jira-mgr/core/http'
import { loadFixture, serveRecorded, type Recorded } from '@jira-mgr/core/test/msw'

import type { Deps } from './context.js'
import { run } from './run.js'
import { EMAIL, TOKEN } from './test-auth.js'
import { fakeIo } from './test-io.js'

/** A client with fixed credentials and no waiting, so a read test needs no Keychain. */
export const http = createHttpClient({
  credentials: () =>
    Promise.resolve({
      siteUrl: 'https://engineering-collibra.atlassian.net',
      email: EMAIL,
      token: TOKEN,
    }),
  sleep: () => Promise.resolve(),
})

export const SEARCH_PATH = '/rest/api/3/search/jql'

interface Page {
  issues: unknown[]
  nextPageToken?: string
}

const recorded = (name: string) => loadFixture(name) as unknown as Page

/**
 * Answers the recorded search pages: two per phase, with the second served as the last (the
 * recording has no genuine last page), plus `myself`. `extra` answers anything else, and an
 * unanswered request gets a 500 that names it. Returns every request received.
 */
export function serveReads(extra?: (request: Recorded) => Response | undefined): Recorded[] {
  return serveRecorded((request) => {
    if (request.method === 'POST' && request.path === SEARCH_PATH) {
      const body = request.body as { jql: string; nextPageToken?: string }
      const phase = body.jql.includes('!= Done') ? 'unresolved' : 'done'
      if (body.nextPageToken === undefined) return Response.json(recorded(`search-${phase}-1`))
      return Response.json({ issues: recorded(`search-${phase}-2`).issues, isLast: true })
    }
    if (request.path === '/rest/api/3/myself') return Response.json(loadFixture('myself'))
    return (
      extra?.(request) ??
      Response.json(
        { errorMessages: [`The test fake has no answer for ${request.method} ${request.path}.`] },
        { status: 500 },
      )
    )
  })
}

/** The search requests among `requests`, as the phase each one asked for. */
export function searchPhases(requests: readonly Recorded[]): ('unresolved' | 'done')[] {
  return requests
    .filter((r) => r.path === SEARCH_PATH)
    .map((r) => ((r.body as { jql: string }).jql.includes('!= Done') ? 'unresolved' : 'done'))
}

/** Runs `argv` piped, the way an agent would, with the shared client unless `deps` brings its own. */
export async function runJson(argv: string[], deps: Deps = { http }) {
  const f = fakeIo()
  const code = await run(argv, f.io, deps)
  const body = f.stdout === '' ? undefined : (JSON.parse(f.stdout) as Envelope)
  return { code, f, body, data: body?.data, error: body?.error }
}

/** Runs `argv` on a terminal, colourless unless `env` says otherwise. */
export async function runTty(
  argv: string[],
  options: { env?: Record<string, string>; stderrIsTTY?: boolean; columns?: number } = {},
  deps: Deps = { http },
) {
  const f = fakeIo({
    stdoutIsTTY: true,
    stderrIsTTY: options.stderrIsTTY ?? false,
    columns: options.columns,
    env: options.env ?? { NO_COLOR: '1' },
  })
  const code = await run(argv, f.io, deps)
  return { code, f, lines: f.stdout.split('\n') }
}

interface Envelope {
  data?: unknown
  error?: { code: string; message: string; details?: unknown }
}
