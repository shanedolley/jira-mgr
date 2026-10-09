import { JiraMgrError } from '@jira-mgr/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Backend } from './backend'
import { createHandlers, stackFrames } from './handlers'

const TOKEN = 'ATATT3xFfGF0-secret_token=ABC123'

function fakeBackend(overrides: Partial<Backend> = {}) {
  const calls: { method: string; args: unknown[] }[] = []
  const record =
    <T>(method: string, result: T) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return Promise.resolve(result)
    }
  const loggedOut = { loggedIn: false, prefill: {} } as const
  const backend: Backend = {
    getSession: record('getSession', loggedOut),
    login: record('login', loggedOut),
    logout: record('logout', loggedOut),
    listIssues: record('listIssues', []),
    setSummary: record('setSummary', undefined),
    ...overrides,
  }
  return { backend, calls }
}

const login = {
  siteUrl: 'https://team.atlassian.net',
  projectKey: 'PSAPAC',
  email: 'me@example.com',
  token: TOKEN,
}

describe('argument validation', () => {
  it('refuses a login with a missing field before the backend runs', async () => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['session:login']({ ...login, token: undefined })
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('refuses an unknown field, so the renderer cannot smuggle extra input to core', async () => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['session:login']({ ...login, admin: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('never echoes the token in a validation message', async () => {
    const { backend } = fakeBackend()
    const result = await createHandlers(backend)['session:login']({
      ...login,
      token: TOKEN.repeat(100),
      email: 42,
    })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it.each([
    ['a key that is not an issue key', { key: 'psapac-12', summary: 'x' }],
    ['a key with a path in it', { key: 'PSAPAC-12/../x', summary: 'x' }],
    ['a blank summary', { key: 'PSAPAC-12', summary: '   ' }],
    ['a summary over 255 characters', { key: 'PSAPAC-12', summary: 'x'.repeat(256) }],
    ['no argument', undefined],
  ])('refuses setSummary with %s', async (_name, raw) => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['issues:setSummary'](raw)
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('refuses an argument on a channel that takes none', async () => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['issues:list']({ key: 'PSAPAC-1' })
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('passes a valid request through, with the summary trimmed', async () => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['issues:setSummary']({
      key: 'PSAPAC-12',
      summary: '  New summary  ',
    })
    expect(result).toEqual({ ok: true, data: null })
    expect(calls).toEqual([
      { method: 'setSummary', args: [{ key: 'PSAPAC-12', summary: 'New summary' }] },
    ])
  })
})

describe('errors', () => {
  it('sends a core error as its code and message', async () => {
    const { backend } = fakeBackend({
      listIssues: () =>
        Promise.reject(
          new JiraMgrError('permission_denied', 'Not logged in.', { details: { a: 1 } }),
        ),
    })
    const result = await createHandlers(backend, () => undefined)['issues:list'](undefined)
    expect(result).toEqual({
      ok: false,
      error: { code: 'permission_denied', message: 'Not logged in.' },
    })
    // The result must survive the structured clone IPC applies.
    expect(structuredClone(result)).toEqual(result)
  })

  it('hides the message of an unexpected error and logs only the channel and code', async () => {
    const log = vi.fn()
    const { backend } = fakeBackend({
      listIssues: () => Promise.reject(new TypeError(`fetch failed for token ${TOKEN}`)),
    })
    const result = await createHandlers(backend, log)['issues:list'](undefined)
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(log).toHaveBeenCalledWith('jm ipc issues:list failed: internal')
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN)
  })
})

describe('JM_DEBUG', () => {
  afterEach(() => {
    delete process.env.JM_DEBUG
  })

  it('logs the stack frames of an unexpected error, never its message', async () => {
    process.env.JM_DEBUG = '1'
    const log = vi.fn<(line: string) => void>()
    // A multi-line message whose second line looks like a frame, as a hostile one could.
    const error = new TypeError(`fetch failed for ${TOKEN}\n    at secret ${TOKEN}`)
    const { backend } = fakeBackend({ listIssues: () => Promise.reject(error) })
    await createHandlers(backend, log)['issues:list'](undefined)

    expect(log.mock.calls.length).toBe(2)
    expect(log.mock.calls[1]?.[0]).toMatch(/^\s+at /)
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN)
    expect(JSON.stringify(log.mock.calls)).not.toContain('fetch failed')
  })

  it('logs no stack without JM_DEBUG', async () => {
    const log = vi.fn<(line: string) => void>()
    const { backend } = fakeBackend({ listIssues: () => Promise.reject(new TypeError('boom')) })
    await createHandlers(backend, log)['issues:list'](undefined)
    expect(log.mock.calls.length).toBe(1)
  })
})

describe('stackFrames', () => {
  it('is empty for a value that is not an error', () => {
    expect(stackFrames('boom')).toBe('')
  })
})
