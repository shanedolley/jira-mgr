import { loadFixture, serveRecorded, type Recorded } from '@jira-mgr/core/test/msw'

const fixture = (name: string) => loadFixture(name) as unknown as Record<string, unknown>
const list = (name: string, key: string) => fixture(name)[key] as unknown[]
const noContent = () => new Response(null, { status: 204 })
const notFound = (request: Recorded) =>
  Response.json(
    { errorMessages: [`The test fake has no answer for ${request.method} ${request.path}.`] },
    { status: 500 },
  )

/** Jira's 403 for another user's comment or worklog. */
export const forbidden = () =>
  Response.json(
    { errorMessages: ['You can only edit or delete your own entries.'], errors: {} },
    { status: 403 },
  )

export const issueNotFound = () =>
  Response.json({ errorMessages: ['Issue does not exist'], errors: {} }, { status: 404 })

/**
 * Answers the comment, worklog, link, attachment and sprint calls from the recorded PSAPAC
 * fixtures, writes included, and records every request: no test reaches a real site. Writes
 * answer with the first recorded comment, worklog or attachment, so tests assert the request
 * bodies, not the response. `respond` goes first. An unanswered request gets a 500 naming it.
 */
export function serveExtras(respond?: (request: Recorded) => Response | undefined): Recorded[] {
  return serveRecorded((request) => {
    const answer = respond?.(request)
    if (answer) return answer
    const { method, path } = request
    const [route = ''] = path.split('?')
    if (route.endsWith('/comment') && method === 'GET') {
      return Response.json(fixture('comments-psapac-666'))
    }
    if (/\/comment(\/\d+)?$/.test(route) && (method === 'POST' || method === 'PUT')) {
      return Response.json(list('comments-psapac-666', 'comments')[0])
    }
    if (route.endsWith('/worklog') && method === 'GET') {
      return Response.json(fixture('worklogs-psapac-666'))
    }
    if (method === 'GET' && /\/worklog\/\d+$/.test(route)) {
      // Jira answers 404 for a worklog id read through an issue that does not own it.
      return route.endsWith('/120440')
        ? Response.json(list('worklogs-psapac-666', 'worklogs')[0])
        : issueNotFound()
    }
    if (/\/worklog(\/\d+)?$/.test(route) && (method === 'POST' || method === 'PUT')) {
      return Response.json(list('worklogs-psapac-666', 'worklogs')[0])
    }
    if (method === 'GET' && route === '/rest/api/3/issueLinkType') {
      return Response.json(fixture('issuelinktype'))
    }
    if (method === 'GET' && /^\/rest\/api\/3\/issueLink\/\d+$/.test(route)) {
      return Response.json(fixture('issue-link-551838'))
    }
    if (method === 'GET' && path.endsWith('?fields=issuelinks')) {
      return Response.json(fixture('issue-links-psapac-666'))
    }
    if (method === 'GET' && path.endsWith('?fields=attachment')) {
      return Response.json(fixture('issue-attachments-psapac-3017'))
    }
    if (method === 'GET' && route === '/rest/api/3/attachment/meta') {
      return Response.json(fixture('attachment-meta'))
    }
    if (method === 'POST' && route.endsWith('/attachments')) {
      return Response.json(
        (
          fixture('issue-attachments-psapac-3017').fields as { attachment: unknown[] }
        ).attachment.slice(0, 1),
      )
    }
    if (method === 'GET' && route === '/rest/agile/1.0/board') {
      return Response.json(fixture('board-psapac'))
    }
    if (method === 'GET' && route === '/rest/agile/1.0/board/1706/sprint') {
      const body = fixture('board-sprints-active-future') as { values: unknown[] }
      return Response.json({ ...body, total: body.values.length })
    }
    if (['POST', 'PUT', 'DELETE'].includes(method)) return noContent()
    return notFound(request)
  })
}

/** `METHOD path` for each request, the query string kept. */
export const calls = (requests: readonly Recorded[]) => requests.map((r) => `${r.method} ${r.path}`)
