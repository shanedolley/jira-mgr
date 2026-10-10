import { setTimeout as delay } from 'node:timers/promises'

import { z } from 'zod'

import { getCredentials, parseSiteUrl } from './auth.js'
import { JiraMgrError, type ErrorCode } from './errors.js'
import { isJiraPath } from './site-url.js'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RETRIES = 3
/** The longest a `Retry-After` can make a request wait. */
const MAX_RETRY_WAIT_MS = 60_000
/** Wait for a 429 that sends no usable `Retry-After`, doubled per retry. */
const FALLBACK_WAIT_MS = 1000
const MAX_DETAIL_CHARS = 200

export interface Credentials {
  siteUrl: string
  email: string
  token: string
}

export interface HttpClientOptions {
  /** Defaults to `getCredentials()`, read on every request so a new login takes effect at once. */
  credentials?: () => Promise<Credentials>
  timeoutMs?: number
  maxRetries?: number
  /** Replace the real wait, so tests do not wait. The signal is the caller's, so a wait can be cut short. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Receives one line per attempt. Defaults to `stderr` when `JM_DEBUG=1`, else nothing. */
  debug?: (line: string) => void
}

export interface RequestOptions {
  /** An object is sent as JSON. A `FormData` is sent as multipart, for attachments. */
  body?: unknown
  signal?: AbortSignal
  /** Overrides the client's timeout for this request, such as a large upload. */
  timeoutMs?: number
  /**
   * What to read back: JSON unless `bytes` (needs `maxBytes`) or `mediaId`. Callers use
   * `requestBytes` and `requestMediaId`, which type the answer.
   */
  as?: 'json' | 'bytes' | 'mediaId'
  /** With `as: 'bytes'`: the most bytes to read before refusing. */
  maxBytes?: number
}

export interface HttpClient {
  /** Resolves to the parsed JSON body, or `undefined` for an empty one. Callers validate it. */
  request(method: string, path: string, options?: RequestOptions): Promise<unknown>
}

/** A body read as bytes, with the content type Jira declared. */
export interface BytesResponse {
  contentType: string | null
  bytes: Uint8Array
}

/** Reads a body as bytes, refusing with `validation_failed` past `maxBytes`. */
export function requestBytes(
  http: HttpClient,
  method: string,
  path: string,
  options: Omit<RequestOptions, 'as'> & { maxBytes: number },
): Promise<BytesResponse> {
  return http.request(method, path, { ...options, as: 'bytes' }) as Promise<BytesResponse>
}

/** The Media Services file id an attachment content path redirects to. No other path is allowed. */
export function requestMediaId(
  http: HttpClient,
  path: string,
  options: Omit<RequestOptions, 'as' | 'maxBytes'> = {},
): Promise<string> {
  return http.request('GET', path, { ...options, as: 'mediaId' }) as Promise<string>
}

const jiraErrorBody = z.object({
  errorMessages: z.array(z.string()).optional(),
  errors: z.record(z.string(), z.string()).optional(),
})

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'validation_failed',
  401: 'permission_denied',
  403: 'permission_denied',
  404: 'not_found',
}

const defaultSleep = (ms: number, signal?: AbortSignal) => delay(ms, undefined, { signal })

/** Reads the body, giving up when `signal` fires even if the transport never errors the stream. */
function readText(response: Response, signal: AbortSignal): Promise<string> {
  return Promise.race([
    response.text(),
    new Promise<never>((_, reject) => {
      // A DOMException is an Error at run time; the lib types lag.
      const abort = () => {
        reject(signal.reason as Error)
      }
      if (signal.aborted) abort()
      signal.addEventListener('abort', abort, { once: true })
    }),
  ])
}

const tooLarge = (maxBytes: number) =>
  new JiraMgrError(
    'validation_failed',
    `Jira sent more than ${String(maxBytes)} bytes, which is more than this app reads.`,
  )

/** Reads at most `maxBytes` of the body, giving up when `signal` fires. */
async function readBytes(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Uint8Array> {
  const length = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(length) && length > maxBytes) {
    void response.body?.cancel().catch(() => undefined)
    throw tooLarge(maxBytes)
  }
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined
  if (reader === undefined) return new Uint8Array()
  const aborted = new Promise<never>((_, reject) => {
    const abort = () => {
      reject(signal.reason as Error)
    }
    if (signal.aborted) abort()
    signal.addEventListener('abort', abort, { once: true })
  })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (done) break
      total += value.length
      if (total > maxBytes) throw tooLarge(maxBytes)
      chunks.push(value)
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    throw error
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return bytes
}

const MEDIA_HOST = 'api.media.atlassian.com'
const MEDIA_PATH = /^\/file\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i
const CONTENT_PATH = /^\/rest\/api\/3\/attachment\/content\/[1-9]\d*$/

/**
 * The file id in a content redirect's `Location`, or `undefined` when it is not the media
 * service's. The URL carries a short-lived media token, so only the id leaves this module.
 */
function mediaIdOf(location: string | null): string | undefined {
  if (location === null || !URL.canParse(location)) return undefined
  const url = new URL(location)
  if (url.protocol !== 'https:' || url.hostname !== MEDIA_HOST) return undefined
  return MEDIA_PATH.exec(url.pathname)?.[1]
}

/** What to do next, per status, so a message says more than what went wrong. */
const NEXT_STEPS: Record<number, string> = {
  400: 'Fix the input and try again.',
  401: 'Run `jm auth login` to sign in again.',
  403: 'Ask a Jira admin for access to this, or check you are on the right project.',
  404: 'Check the key or id and that it exists in this project.',
  429: 'Try again later.',
  503: 'Try again later.',
}

/** Verbs that change nothing, so repeating them is safe. */
const READ_METHODS = ['GET', 'HEAD']

const defaultDebug = (line: string) => {
  if (process.env.JM_DEBUG === '1') console.error(line)
}

/** Only `/rest/...` on the site is allowed, so a caller cannot steer the token to another URL. */
function assertJiraPath(path: string): void {
  if (!isJiraPath(path)) {
    throw new JiraMgrError(
      'validation_failed',
      'A Jira request path must start with /rest/ and hold no "..", backslash or encoded dot.',
    )
  }
}

/** Milliseconds a response asks us to wait, or `undefined` when it is not retryable. */
function retryWait(response: Response, attempt: number, maxWaitMs: number): number | undefined {
  if (response.status !== 429 && response.status !== 503) return undefined
  const header = response.headers.get('Retry-After')
  let waitMs: number | undefined
  if (header !== null) {
    const seconds = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000
    if (seconds > 0 && Number.isFinite(seconds)) waitMs = seconds * 1000
  }
  // A 429, or a 503 that sent the header, still backs off when the wait is zero, past or unreadable.
  // A bare 503 is a failure.
  if (waitMs === undefined && (response.status === 429 || header !== null)) {
    waitMs = FALLBACK_WAIT_MS * 2 ** attempt
  }
  return waitMs === undefined ? undefined : Math.min(waitMs, maxWaitMs)
}

/** Turns a Jira failure into a `JiraMgrError`. The message and details carry no request headers. */
function failure(response: Response, text: string, method: string, path: string): JiraMgrError {
  let parsed: z.infer<typeof jiraErrorBody> = {}
  try {
    const body = jiraErrorBody.safeParse(JSON.parse(text))
    if (body.success) parsed = body.data
  } catch {
    // Not JSON: the status alone describes the failure.
  }
  const first =
    parsed.errorMessages?.[0] ??
    Object.entries(parsed.errors ?? {})
      .map(([field, message]) => `${field}: ${message}`)
      .at(0)
  const next = NEXT_STEPS[response.status]
  const quoted = first?.slice(0, MAX_DETAIL_CHARS)
  // Jira's text often ends a sentence already; a second full stop would double it.
  const stop = quoted !== undefined && /[.!?]$/.test(quoted) ? '' : '.'
  return new JiraMgrError(
    STATUS_CODES[response.status] ?? 'jira_error',
    `Jira answered ${String(response.status)} to ${method} ${path}` +
      `${quoted === undefined ? '' : `: ${quoted}`}${stop}${next === undefined ? '' : ` ${next}`}`,
    {
      details: {
        status: response.status,
        errorMessages: parsed.errorMessages ?? [],
        errors: parsed.errors ?? {},
      },
    },
  )
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? MAX_RETRIES
  const sleep = options.sleep ?? defaultSleep
  const debug = options.debug ?? defaultDebug
  // ponytail: one Keychain read per request, cache it if the CLI makes enough calls to notice.
  const credentials = options.credentials ?? (() => getCredentials())

  async function request(
    method: string,
    path: string,
    init: RequestOptions = {},
  ): Promise<unknown> {
    const limitMs = init.timeoutMs ?? timeoutMs
    const mode = init.as ?? 'json'
    const maxBytes = init.maxBytes ?? 0
    if (mode === 'bytes' && init.maxBytes === undefined) {
      throw new JiraMgrError('validation_failed', 'Reading bytes needs a maxBytes limit.')
    }
    assertJiraPath(path)
    if (mode === 'mediaId' && !CONTENT_PATH.test(path.split(/[?#]/, 1)[0] ?? '')) {
      throw new JiraMgrError(
        'validation_failed',
        'A media id can be read only from an attachment content path.',
      )
    }
    if (init.body !== undefined && READ_METHODS.includes(method.toUpperCase())) {
      throw new JiraMgrError('validation_failed', `${method} cannot carry a body.`)
    }
    const { siteUrl, email, token } = await credentials()
    // Even injected credentials must not send the token to a site that is not Jira Cloud.
    const origin = parseSiteUrl(siteUrl)
    if (origin === null) {
      throw new JiraMgrError(
        'validation_failed',
        'The site URL is not an https://<name>.atlassian.net site.',
      )
    }
    const url = new URL(path, origin)
    if (url.origin !== origin || !url.pathname.startsWith('/rest/')) {
      throw new JiraMgrError(
        'validation_failed',
        'A Jira request path must stay under /rest/ on the site.',
      )
    }
    // Logs and errors name the path without its query string, which may hold JQL text.
    const label = `${method} ${url.pathname}`

    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
      Accept: mode === 'bytes' ? '*/*' : 'application/json',
    }
    let body: FormData | string | undefined
    if (init.body instanceof FormData) {
      headers['X-Atlassian-Token'] = 'no-check'
      body = init.body
    } else if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.body)
    }

    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(limitMs)
      const signal = init.signal === undefined ? timeout : AbortSignal.any([timeout, init.signal])
      const started = performance.now()
      const elapsed = () => `${String(Math.round(performance.now() - started))}ms`
      let response: Response
      let text = ''
      let bytes: Uint8Array | undefined
      let wait: number | undefined
      try {
        response = await fetch(url, {
          method,
          headers,
          body,
          redirect: mode === 'mediaId' ? 'manual' : 'error',
          signal,
        })
        debug(`jm http ${label} ${String(response.status)} ${elapsed()}`)
        wait = attempt < maxRetries ? retryWait(response, attempt, MAX_RETRY_WAIT_MS) : undefined
        if (wait !== undefined || mode === 'mediaId')
          void response.body?.cancel().catch(() => undefined)
        else if (mode === 'bytes' && response.ok) {
          bytes = await readBytes(response, signal, maxBytes)
        } else text = await readText(response, signal)
      } catch (cause) {
        // The body can fail after the headers arrive: a stall hits the timeout, a reset throws.
        debug(`jm http ${label} failed ${elapsed()}`)
        if (init.signal?.aborted === true) throw cause
        if (cause instanceof JiraMgrError) throw cause
        const timedOut = cause instanceof Error && cause.name === 'TimeoutError'
        const mayHaveRun = READ_METHODS.includes(method.toUpperCase())
          ? ''
          : ' The change may have gone through, so check before retrying.'
        throw new JiraMgrError(
          'jira_error',
          (timedOut
            ? `${label} did not finish within ${String(limitMs / 1000)} seconds.`
            : `Cannot reach Jira for ${label}. Check your network, and that Jira did not redirect the request.`) +
            mayHaveRun,
          { cause },
        )
      }

      if (wait !== undefined) {
        try {
          await sleep(wait, init.signal)
        } catch (cause) {
          // The caller sees the same reason whether the abort lands during the fetch or the wait.
          if (init.signal?.aborted === true) throw init.signal.reason
          throw cause
        }
        continue
      }
      if (mode === 'mediaId' && response.status >= 300 && response.status < 400) {
        const id = mediaIdOf(response.headers.get('Location'))
        // No cause and no details: nothing of the redirect URL may reach a log or a message.
        if (id === undefined) {
          throw new JiraMgrError(
            'jira_error',
            `Jira sent a redirect for ${label} that this app cannot read.`,
          )
        }
        return id
      }
      if (mode === 'mediaId' && response.ok) {
        throw new JiraMgrError('jira_error', `Jira answered ${label} with no redirect to read.`)
      }
      if (!response.ok) throw failure(response, text, method, url.pathname)
      if (bytes !== undefined) return { contentType: response.headers.get('Content-Type'), bytes }
      if (text === '') return undefined
      try {
        return JSON.parse(text) as unknown
      } catch (cause) {
        throw new JiraMgrError('jira_error', `Jira sent a body for ${label} that is not JSON.`, {
          cause,
        })
      }
    }
  }

  return { request }
}
