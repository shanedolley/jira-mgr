import { loadFixture, serveCreatemeta, serveRecorded, type Recorded } from '@jira-mgr/core/test/msw'

export const ME = '712020:16f8dbe7-f120-4043-bcaf-e06ef7156d34'

const noContent = () => new Response(null, { status: 204 })

/**
 * Answers a write command's requests from the recorded PSAPAC fixtures, writes included, and
 * records them: no test reaches a real site. `respond` goes first, so a test can override any
 * answer. `requests` holds everything but the createmeta reads, which `meta` lists as paths.
 * An unanswered request gets a 500 that names it.
 */
export function serveWrites(
  options: {
    respond?: (request: Recorded) => Response | undefined
    createmeta?: Parameters<typeof serveCreatemeta>[0]
  } = {},
): { requests: Recorded[]; meta: string[] } {
  const requests = serveRecorded((request) => {
    const answer = options.respond?.(request)
    if (answer) return answer
    const { method, path } = request
    if (method === 'POST' && path === '/rest/api/3/issue') {
      return Response.json({ id: '10050', key: 'PSAPAC-14', self: 'https://example.invalid' })
    }
    // The read-back after a create: the recorded issue under the key the create answered with.
    if (method === 'GET' && path.startsWith('/rest/api/3/issue/PSAPAC-14?')) {
      return Response.json({
        ...(loadFixture('issue-psapac-3066') as object),
        id: '10050',
        key: 'PSAPAC-14',
      })
    }
    if (method === 'GET' && path.startsWith('/rest/api/3/issue/PSAPAC-3066?')) {
      return Response.json(loadFixture('issue-psapac-3066'))
    }
    if (method === 'GET' && path.endsWith('/transitions')) {
      return Response.json(loadFixture('transitions-story'))
    }
    if (method === 'GET' && path === '/rest/api/3/myself') {
      return Response.json(loadFixture('myself'))
    }
    if (
      ['PUT', 'DELETE'].includes(method) ||
      (method === 'POST' && path.endsWith('/transitions'))
    ) {
      return noContent()
    }
    return Response.json(
      { errorMessages: [`The test fake has no answer for ${method} ${path}.`] },
      { status: 500 },
    )
  })
  // Registered last, so it answers the createmeta paths before the catch-all above.
  const meta = serveCreatemeta(options.createmeta)
  return { requests, meta }
}

const recordedIssue = () => loadFixture('issue-psapac-3066') as { fields: Record<string, unknown> }

/** A `respond` that serves the recorded issue (PSAPAC-3066) with `fields` changed, such as its type or subtasks. */
export const withIssueFields =
  (fields: Record<string, unknown>) =>
  ({ method, path }: Recorded): Response | undefined => {
    if (method !== 'GET' || !path.startsWith('/rest/api/3/issue/PSAPAC-3066?')) return undefined
    const issue = recordedIssue()
    return Response.json({ ...issue, fields: { ...issue.fields, ...fields } })
  }

/** The recorded issue's type with its name changed: `withIssueFields({ issuetype: issueType('Epic') })`. */
export const issueType = (name: string) => ({
  ...(recordedIssue().fields.issuetype as object),
  name,
})
