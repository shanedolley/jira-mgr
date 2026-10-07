import { delay, http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { JIRA_SITE, server } from '../test/msw.js'
import { JiraMgrError } from './errors.js'
import { createHttpClient, type HttpClientOptions } from './http.js'

const EMAIL = 'shane@koinon.com.au'
const TOKEN = 'ATATT3xFfGF0-secret_token=ABC123'
const BASIC = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')

/** A client with injected credentials and no real waiting. Returns the waits it was asked for. */
function client(options: HttpClientOptions = {}) {
  const waits: number[] = []
  const debugLines: string[] = []
  const api = createHttpClient({
    credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: EMAIL, token: TOKEN }),
    sleep: (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
    debug: (line) => debugLines.push(line),
    ...options,
  })
  return { api, waits, debugLines }
}

/** Parses the multipart request the client under test sent, which is trusted. */
function parseForm(request: Request): Promise<FormData> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the deprecation targets untrusted servers
  return request.formData()
}

async function rejection(promise: Promise<unknown>): Promise<JiraMgrError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(JiraMgrError)
  return error as JiraMgrError
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('requests', () => {
  it('sends Basic auth and Accept on a JSON GET', async () => {
    let seen: Request | undefined
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, ({ request }) => {
        seen = request
        return HttpResponse.json({ accountId: 'abc' })
      }),
    )
    const result = await client().api.request('GET', '/rest/api/3/myself')
    expect(result).toEqual({ accountId: 'abc' })
    expect(seen?.headers.get('Authorization')).toBe(`Basic ${BASIC}`)
    expect(seen?.headers.get('Accept')).toBe('application/json')
  })

  it.each(['POST', 'PUT'] as const)('sends a JSON body on %s', async (method) => {
    let contentType: string | null = null
    let body: unknown
    server.use(
      http.all(`${JIRA_SITE}/rest/api/3/issue`, async ({ request }) => {
        contentType = request.headers.get('Content-Type')
        body = await request.json()
        return HttpResponse.json({ key: 'PSAPAC-1' }, { status: 201 })
      }),
    )
    const result = await client().api.request(method, '/rest/api/3/issue', {
      body: { fields: { summary: 'x' } },
    })
    expect(result).toEqual({ key: 'PSAPAC-1' })
    expect(contentType).toBe('application/json')
    expect(body).toEqual({ fields: { summary: 'x' } })
  })

  it('returns undefined for a 204 DELETE', async () => {
    let method = ''
    server.use(
      http.delete(`${JIRA_SITE}/rest/api/3/issue/PSAPAC-1`, ({ request }) => {
        method = request.method
        return new HttpResponse(null, { status: 204 })
      }),
    )
    expect(await client().api.request('DELETE', '/rest/api/3/issue/PSAPAC-1')).toBeUndefined()
    expect(method).toBe('DELETE')
  })

  it('keeps the query string', async () => {
    let search = ''
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/search/jql`, ({ request }) => {
        search = new URL(request.url).search
        return HttpResponse.json({ issues: [] })
      }),
    )
    await client().api.request('GET', '/rest/api/3/search/jql?jql=project%3DPSAPAC&maxResults=5')
    expect(search).toBe('?jql=project%3DPSAPAC&maxResults=5')
  })

  it('uploads a file as multipart with the no-check header', async () => {
    let atlassianToken: string | null = null
    let contentType: string | null = null
    let upload: File | undefined
    server.use(
      http.post(`${JIRA_SITE}/rest/api/3/issue/PSAPAC-1/attachments`, async ({ request }) => {
        atlassianToken = request.headers.get('X-Atlassian-Token')
        contentType = request.headers.get('Content-Type')
        upload = (await parseForm(request)).get('file') as File
        return HttpResponse.json([{ id: '1' }])
      }),
    )
    const form = new FormData()
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt')
    await client().api.request('POST', '/rest/api/3/issue/PSAPAC-1/attachments', { body: form })
    expect(atlassianToken).toBe('no-check')
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(upload?.name).toBe('note.txt')
    expect(await upload?.text()).toBe('hello')
  })
})

describe('path validation', () => {
  it.each([
    'https://example.com/rest/api/3/myself',
    '//example.com/rest/api/3/myself',
    '/other/path',
    'rest/api/3/myself',
    '/rest/../admin',
    '/rest/%2e%2e/admin',
    '/rest/%2E./admin',
    '/rest/api\\..\\admin',
    '/rest/.\t./admin',
  ])('refuses %s without sending a request', async (path) => {
    const error = await rejection(client().api.request('GET', path))
    expect(error.code).toBe('validation_failed')
  })

  it.each(['GET', 'HEAD'])('refuses a body on %s', async (method) => {
    const error = await rejection(client().api.request(method, '/rest/api/3/myself', { body: {} }))
    expect(error.code).toBe('validation_failed')
  })

  it('refuses credentials for a site that is not Jira Cloud', async () => {
    const api = createHttpClient({
      credentials: () =>
        Promise.resolve({ siteUrl: 'https://example.com', email: EMAIL, token: TOKEN }),
    })
    expect((await rejection(api.request('GET', '/rest/api/3/myself'))).code).toBe(
      'validation_failed',
    )
  })
})

describe('rate limits', () => {
  it('waits Retry-After seconds on a 429, then retries once', async () => {
    let calls = 0
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => {
        calls++
        return calls === 1
          ? new HttpResponse(null, { status: 429, headers: { 'Retry-After': '7' } })
          : HttpResponse.json({ ok: true })
      }),
    )
    const { api, waits } = client()
    expect(await api.request('GET', '/rest/api/3/myself')).toEqual({ ok: true })
    expect(calls).toBe(2)
    expect(waits).toEqual([7000])
  })

  it('retries a 503 that sends Retry-After', async () => {
    let calls = 0
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => {
        calls++
        return calls === 1
          ? new HttpResponse(null, { status: 503, headers: { 'Retry-After': '2' } })
          : HttpResponse.json({ ok: true })
      }),
    )
    const { api, waits } = client()
    await api.request('GET', '/rest/api/3/myself')
    expect(waits).toEqual([2000])
  })

  it('does not retry a 503 without Retry-After', async () => {
    let calls = 0
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => {
        calls++
        return new HttpResponse(null, { status: 503 })
      }),
    )
    const { api, waits } = client()
    expect((await rejection(api.request('GET', '/rest/api/3/myself'))).code).toBe('jira_error')
    expect(calls).toBe(1)
    expect(waits).toEqual([])
  })

  it('caps the wait at 60 seconds', async () => {
    let calls = 0
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => {
        calls++
        return calls === 1
          ? new HttpResponse(null, { status: 429, headers: { 'Retry-After': '3600' } })
          : HttpResponse.json({})
      }),
    )
    const { api, waits } = client()
    await api.request('GET', '/rest/api/3/myself')
    expect(waits).toEqual([60_000])
  })

  it('backs off exponentially on a 429 with no Retry-After', async () => {
    let calls = 0
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => {
        calls++
        return calls <= 2 ? new HttpResponse(null, { status: 429 }) : HttpResponse.json({})
      }),
    )
    const { api, waits } = client()
    await api.request('GET', '/rest/api/3/myself')
    expect(waits).toEqual([1000, 2000])
  })

  it('resends a multipart body on retry', async () => {
    const files: string[] = []
    server.use(
      http.post(`${JIRA_SITE}/rest/api/3/issue/PSAPAC-1/attachments`, async ({ request }) => {
        files.push(await ((await parseForm(request)).get('file') as File).text())
        return files.length === 1
          ? new HttpResponse(null, { status: 429, headers: { 'Retry-After': '1' } })
          : HttpResponse.json([])
      }),
    )
    const form = new FormData()
    form.append('file', new Blob(['hello']), 'note.txt')
    await client().api.request('POST', '/rest/api/3/issue/PSAPAC-1/attachments', { body: form })
    expect(files).toEqual(['hello', 'hello'])
  })

  it.each([
    ['0', 'Retry-After: 0'],
    ['-5', 'a negative Retry-After'],
    ['Wed, 21 Oct 2015 07:28:00 GMT', 'a Retry-After date in the past'],
  ])('backs off instead of retrying at once on %s (%s)', async (header) => {
    let calls = 0
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => {
        calls++
        return calls === 1
          ? new HttpResponse(null, { status: 429, headers: { 'Retry-After': header } })
          : HttpResponse.json({})
      }),
    )
    const { api, waits } = client()
    await api.request('GET', '/rest/api/3/myself')
    expect(waits).toEqual([1000])
  })

  it('stops waiting when the caller aborts, with the caller reason', async () => {
    server.use(
      http.get(
        `${JIRA_SITE}/rest/api/3/myself`,
        () => new HttpResponse(null, { status: 429, headers: { 'Retry-After': '60' } }),
      ),
    )
    const controller = new AbortController()
    const reason = new Error('stop')
    // No injected sleep: this is the real wait. Abort once the 429 has reached the client.
    const api = createHttpClient({
      credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: EMAIL, token: TOKEN }),
      debug: (line) => {
        if (line.includes(' 429 ')) {
          setTimeout(() => {
            controller.abort(reason)
          }, 0)
        }
      },
    })
    const started = performance.now()
    await expect(
      api.request('GET', '/rest/api/3/myself', { signal: controller.signal }),
    ).rejects.toBe(reason)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('stops after one retry when maxRetries is 1', async () => {
    let calls = 0
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => {
        calls++
        return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '1' } })
      }),
    )
    const { api, waits } = client({ maxRetries: 1 })
    expect((await rejection(api.request('GET', '/rest/api/3/myself'))).code).toBe('jira_error')
    expect(calls).toBe(2)
    expect(waits).toEqual([1000])
  })

  it('throws jira_error once the retries run out', async () => {
    let calls = 0
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => {
        calls++
        return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '1' } })
      }),
    )
    const { api, waits } = client({ maxRetries: 3 })
    const error = await rejection(api.request('GET', '/rest/api/3/myself'))
    expect(error.code).toBe('jira_error')
    expect(error.details).toMatchObject({ status: 429 })
    expect(calls).toBe(4)
    expect(waits).toEqual([1000, 1000, 1000])
  })
})

describe('error mapping', () => {
  it.each([
    [400, 'validation_failed'],
    [401, 'permission_denied'],
    [403, 'permission_denied'],
    [404, 'not_found'],
    [409, 'jira_error'],
    [500, 'jira_error'],
  ])('maps %i to %s', async (status, code) => {
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/issue/PSAPAC-1`, () =>
        HttpResponse.json(
          { errorMessages: ['Nope.'], errors: { summary: 'Too short' } },
          { status },
        ),
      ),
    )
    const error = await rejection(client().api.request('GET', '/rest/api/3/issue/PSAPAC-1'))
    expect(error.code).toBe(code)
    expect(error.message).toContain(`${String(status)} to GET /rest/api/3/issue/PSAPAC-1: Nope.`)
    expect(error.details).toEqual({
      status,
      errorMessages: ['Nope.'],
      errors: { summary: 'Too short' },
    })
  })

  it('uses the first field error when there are no error messages', async () => {
    server.use(
      http.post(`${JIRA_SITE}/rest/api/3/issue`, () =>
        HttpResponse.json({ errors: { summary: 'Too short' } }, { status: 400 }),
      ),
    )
    const error = await rejection(client().api.request('POST', '/rest/api/3/issue', { body: {} }))
    expect(error.message).toContain('summary: Too short')
  })

  it('maps a body that is not JSON to a status-only error', async () => {
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => new HttpResponse('<html>', { status: 502 })),
    )
    const error = await rejection(client().api.request('GET', '/rest/api/3/myself'))
    expect(error.code).toBe('jira_error')
    expect(error.details).toEqual({ status: 502, errorMessages: [], errors: {} })
  })

  it('maps a 200 body that is not JSON to jira_error', async () => {
    server.use(http.get(`${JIRA_SITE}/rest/api/3/myself`, () => new HttpResponse('<html>')))
    expect((await rejection(client().api.request('GET', '/rest/api/3/myself'))).code).toBe(
      'jira_error',
    )
  })

  it('maps a network failure to jira_error', async () => {
    server.use(http.get(`${JIRA_SITE}/rest/api/3/myself`, () => HttpResponse.error()))
    expect((await rejection(client().api.request('GET', '/rest/api/3/myself'))).code).toBe(
      'jira_error',
    )
  })

  it('refuses a redirect', async () => {
    let followed = false
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () =>
        HttpResponse.redirect('https://example.com/collect', 302),
      ),
      http.get('https://example.com/collect', () => {
        followed = true
        return HttpResponse.json({})
      }),
    )
    const error = await rejection(client().api.request('GET', '/rest/api/3/myself'))
    expect(error.code).toBe('jira_error')
    expect(followed).toBe(false)
  })

  it('maps a body that stalls after the headers to jira_error', async () => {
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => {
        // Sends a byte, then never ends.
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'))
          },
        })
        return new HttpResponse(stream, { headers: { 'Content-Type': 'application/json' } })
      }),
    )
    const error = await rejection(
      client({ timeoutMs: 50 }).api.request('GET', '/rest/api/3/myself'),
    )
    expect(error.code).toBe('jira_error')
    expect(error.message).toContain('did not finish within')
  })

  it('maps a body that breaks mid-stream to jira_error', async () => {
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'))
            setTimeout(() => {
              controller.error(new Error('connection reset'))
            }, 10)
          },
        })
        return new HttpResponse(stream, { headers: { 'Content-Type': 'application/json' } })
      }),
    )
    const error = await rejection(client().api.request('GET', '/rest/api/3/myself'))
    expect(error.code).toBe('jira_error')
    expect(error.message).toContain('Cannot reach Jira')
  })

  it('warns that a failed write may have gone through, and a failed read does not', async () => {
    server.use(
      http.post(`${JIRA_SITE}/rest/api/3/issue`, () => HttpResponse.error()),
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => HttpResponse.error()),
    )
    const { api } = client()
    const write = await rejection(api.request('POST', '/rest/api/3/issue', { body: {} }))
    const read = await rejection(api.request('GET', '/rest/api/3/myself'))
    expect(write.message).toContain('may have gone through')
    expect(read.message).not.toContain('may have gone through')
  })

  it.each([
    [401, 'jm auth login'],
    [403, 'Ask a Jira admin'],
    [404, 'Check the key or id'],
  ])('tells the user what to do after a %i', async (status, hint) => {
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/issue/PSAPAC-1`, () => new HttpResponse(null, { status })),
    )
    const error = await rejection(client().api.request('GET', '/rest/api/3/issue/PSAPAC-1'))
    expect(error.message).toContain(hint)
  })

  it('maps a timeout to jira_error', async () => {
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, async () => {
        await delay('infinite')
        return HttpResponse.json({})
      }),
    )
    const error = await rejection(
      client({ timeoutMs: 50 }).api.request('GET', '/rest/api/3/myself'),
    )
    expect(error.code).toBe('jira_error')
    expect(error.message).toContain('did not finish within')
  })

  it('rethrows the caller abort unchanged', async () => {
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, async () => {
        await delay('infinite')
        return HttpResponse.json({})
      }),
    )
    const controller = new AbortController()
    const pending = client().api.request('GET', '/rest/api/3/myself', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.not.toBeInstanceOf(JiraMgrError)
  })
})

describe('debug output', () => {
  /** Everything a caller could see: debug lines, error text and details, and the cause chain. */
  function assertNoSecrets(text: string) {
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(BASIC)
    expect(text).not.toContain('Authorization')
  }

  it('prints method, path, status and timing, never the token or the credential string', async () => {
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => HttpResponse.json({ ok: true })),
      http.get(`${JIRA_SITE}/rest/api/3/issue/PSAPAC-1`, () =>
        HttpResponse.json({ errorMessages: ['Gone'] }, { status: 404 }),
      ),
      http.get(`${JIRA_SITE}/rest/api/3/broken`, () => HttpResponse.error()),
    )
    const { api, debugLines } = client()
    const errors: JiraMgrError[] = []
    await api.request('GET', '/rest/api/3/myself?expand=secret-jql')
    errors.push(await rejection(api.request('GET', '/rest/api/3/issue/PSAPAC-1')))
    errors.push(await rejection(api.request('GET', '/rest/api/3/broken')))

    expect(debugLines).toHaveLength(3)
    expect(debugLines[0]).toMatch(/^jm http GET \/rest\/api\/3\/myself 200 \d+ms$/)
    expect(debugLines[1]).toMatch(/^jm http GET \/rest\/api\/3\/issue\/PSAPAC-1 404 \d+ms$/)
    expect(debugLines[2]).toMatch(/^jm http GET \/rest\/api\/3\/broken failed \d+ms$/)
    assertNoSecrets(debugLines.join('\n'))
    for (const error of errors) {
      assertNoSecrets(`${error.message}\n${JSON.stringify(error.details)}`)
      assertNoSecrets(
        String(error.cause) +
          JSON.stringify(error.cause, Object.getOwnPropertyNames(error.cause ?? {})),
      )
    }
  })

  it('prints to stderr only when JM_DEBUG=1', async () => {
    server.use(http.get(`${JIRA_SITE}/rest/api/3/myself`, () => HttpResponse.json({})))
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const api = createHttpClient({
      credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: EMAIL, token: TOKEN }),
    })

    await api.request('GET', '/rest/api/3/myself')
    expect(stderr).not.toHaveBeenCalled()

    vi.stubEnv('JM_DEBUG', '1')
    await api.request('GET', '/rest/api/3/myself')
    expect(stderr).toHaveBeenCalledTimes(1)
    assertNoSecrets(String(stderr.mock.calls[0]?.[0]))
  })
})
