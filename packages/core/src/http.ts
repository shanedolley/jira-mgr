import { setTimeout as delay } from 'node:timers/promises'

import { z } from 'zod'

import { getCredentials, parseSiteUrl } from './auth.js'
import { JiraMgrError, type ErrorCode } from './errors.js'

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
}

export interface HttpClient {
  /** Resolves to the parsed JSON body, or `undefined` for an empty one. Callers validate it. */
  request(method: string, path: string, options?: RequestOptions): Promise<unknown>
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
  if (!path.startsWith('/rest/') || /\.\.|%2e/i.test(path) || path.includes('\\')) {
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
  return new JiraMgrError(
    STATUS_CODES[response.status] ?? 'jira_error',
    `Jira answered ${String(response.status)} to ${method} ${path}` +
      `${first === undefined ? '' : `: ${first.slice(0, MAX_DETAIL_CHARS)}`}.${next === undefined ? '' : ` ${next}`}`,
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

  async function request(method: string, path: string, init: RequestOptions = {}) {
    assertJiraPath(path)
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
      Accept: 'application/json',
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
      const timeout = AbortSignal.timeout(timeoutMs)
      const signal = init.signal === undefined ? timeout : AbortSignal.any([timeout, init.signal])
      const started = performance.now()
      const elapsed = () => `${String(Math.round(performance.now() - started))}ms`
      let response: Response
      let text = ''
      let wait: number | undefined
      try {
        response = await fetch(url, { method, headers, body, redirect: 'error', signal })
        debug(`jm http ${label} ${String(response.status)} ${elapsed()}`)
        wait = attempt < maxRetries ? retryWait(response, attempt, MAX_RETRY_WAIT_MS) : undefined
        if (wait === undefined) text = await readText(response, signal)
        else await response.body?.cancel()
      } catch (cause) {
        // The body can fail after the headers arrive: a stall hits the timeout, a reset throws.
        debug(`jm http ${label} failed ${elapsed()}`)
        if (init.signal?.aborted === true) throw cause
        const timedOut = cause instanceof Error && cause.name === 'TimeoutError'
        const mayHaveRun = READ_METHODS.includes(method.toUpperCase())
          ? ''
          : ' The change may have gone through, so check before retrying.'
        throw new JiraMgrError(
          'jira_error',
          (timedOut
            ? `${label} did not finish within ${String(timeoutMs / 1000)} seconds.`
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
      if (!response.ok) throw failure(response, text, method, url.pathname)
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
