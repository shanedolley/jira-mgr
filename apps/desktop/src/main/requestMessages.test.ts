import { JiraMgrError } from '@jira-mgr/core'
import { listComments } from '@jira-mgr/core/extras'
import { createHttpClient, requestMediaId } from '@jira-mgr/core/http'
import { listSprints } from '@jira-mgr/core/sprints'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { toIpcError } from './handlers'
import { desktopError, desktopMessage } from './messages'

const http = createHttpClient({
  credentials: () =>
    Promise.resolve({ siteUrl: 'https://x.atlassian.net', email: 'a@b.c', token: 't' }),
  maxRetries: 0,
  sleep: () => Promise.resolve(),
})

const answer = (status: number, body = '', init: ResponseInit = {}) =>
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(body, { status, ...init })))

/** The error core throws for a call, with the wording http.ts gives it. */
async function thrown(call: () => Promise<unknown>): Promise<JiraMgrError> {
  const error = await call().then(
    () => undefined,
    (cause: unknown) => cause,
  )
  if (!(error instanceof JiraMgrError)) throw new Error('The call did not throw a JiraMgrError')
  return error
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what the app shows of a request core names', () => {
  const path = '/rest/api/3/issue/PSAPAC-3'

  it.each(['GET', 'POST', 'PUT', 'DELETE'])(
    'drops %s and its path from an answered failure, with or without a Jira reason',
    async (method) => {
      for (const body of [
        '{"errorMessages":["Nope."]}',
        '{"errorMessages":["Nope"]}',
        '{"errors":{"summary":"Too long"}}',
        '',
      ]) {
        answer(403, body)
        const error = await thrown(() => http.request(method, path))
        expect(error.message).toContain(path)
        const shown = desktopMessage(error.message)
        expect(shown).not.toMatch(/\/rest\/|\b(GET|POST|PUT|DELETE)\b/)
        expect(shown).toMatch(/^Jira answered 403[:.]/)
        expect(desktopError(error.message).detail).toBe(error.message)
      }
    },
  )

  it('keeps Jira reason and next step', async () => {
    answer(404, '{"errorMessages":["Issue does not exist."]}')
    const error = await thrown(() => http.request('GET', path))
    expect(desktopMessage(error.message)).toBe(
      'Jira answered 404: Issue does not exist. Check the key or id and that it exists in this project.',
    )
  })

  it('drops the request from a network failure and a timeout', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')))
    const unreachable = await thrown(() => http.request('PUT', path))
    expect(unreachable.message).toContain('Cannot reach Jira for PUT')
    expect(desktopMessage(unreachable.message)).toMatch(/^Cannot reach Jira for the request\. /)

    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('slow', 'TimeoutError')))
    const slow = await thrown(() => http.request('GET', path))
    expect(slow.message).toMatch(/^GET \/rest\/\S+ did not finish within/)
    expect(desktopMessage(slow.message)).toMatch(/^The request did not finish within/)
  })

  it('drops the request from an unreadable answer', async () => {
    answer(200, 'not json')
    const notJson = await thrown(() => http.request('GET', path))
    expect(desktopMessage(notJson.message)).toBe(
      'Jira sent a body for the request that is not JSON.',
    )

    answer(200)
    const content = '/rest/api/3/attachment/content/10001'
    const noRedirect = await thrown(() => requestMediaId(http, content))
    expect(noRedirect.message).toContain(content)
    expect(desktopMessage(noRedirect.message)).toBe(
      'Jira answered the request with no redirect to read.',
    )

    answer(302)
    const odd = await thrown(() => requestMediaId(http, content))
    expect(odd.message).toContain(content)
    expect(desktopMessage(odd.message)).toBe(
      'Jira sent a redirect for the request that this app cannot read.',
    )
  })

  it('drops the bare path from a paged listing Jira answered with the wrong shape', async () => {
    answer(200, '{"unexpected":true}')
    for (const [name, call] of [
      ['comments', () => listComments(http, 'PSAPAC-3')],
      ['sprints', () => listSprints(http, 7)],
    ] as const) {
      const error = await thrown(call)
      expect(error.message, name).toMatch(/^Jira sent an unexpected response for \/rest\/\S+\.$/)
      const ipc = toIpcError(error)
      expect(ipc.message, name).toBe('Jira sent an unexpected response for the request.')
      expect(ipc.detail, name).toBe(error.message)
    }
  })

  it('leaves a message with no request as it is, with no detail', () => {
    expect(desktopError('Jira answered 401 to the login check.')).toEqual({
      message: 'Jira answered 401 to the login check.',
    })
  })

  it('crosses IPC as a plain message and the full text as detail', async () => {
    answer(403, '{"errorMessages":["No."]}')
    const error = await thrown(() => http.request('DELETE', '/rest/api/3/issue/PSAPAC-3'))
    const ipc = toIpcError(error)
    expect(ipc.code).toBe('permission_denied')
    expect(ipc.message).not.toContain('/rest/')
    expect(ipc.detail).toContain('DELETE /rest/api/3/issue/PSAPAC-3')
  })

  it('carries the status Jira answered with, and none when it did not answer', async () => {
    for (const status of [404, 500]) {
      answer(status, '{"errorMessages":["No."]}')
      const error = await thrown(() => http.request('GET', '/rest/api/3/issue/PSAPAC-3'))
      expect(toIpcError(error).status).toBe(status)
    }
    expect(toIpcError(new JiraMgrError('jira_error', 'Cannot reach Jira.'))).toEqual({
      code: 'jira_error',
      message: 'Cannot reach Jira.',
    })
  })
})
