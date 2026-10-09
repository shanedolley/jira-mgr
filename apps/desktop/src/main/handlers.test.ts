import { JiraMgrError } from '@jira-mgr/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Backend, ProgressSender } from './backend'
import { createHandlers, stackFrames } from './handlers'

const TOKEN = 'ATATT3xFfGF0-secret_token=ABC123'
const LIST = { phase: 'unresolved', loadId: 1 } as const
const TOGGLES = { hideDone: true, assigneeMe: false, hideEmptyCustomers: true }
const VIEW = { id: 'bugs', name: 'Bugs', filters: { type: ['Bug'] }, toggles: TOGGLES }
const NEW_VIEW = { name: 'Bugs', filters: { type: ['Bug'], text: 'etl' }, toggles: TOGGLES }

/** A progress sender that records what a handler reports. */
function progressRecorder() {
  const sent: unknown[] = []
  const progress: ProgressSender = {
    sendProgress(p) {
      sent.push(p)
    },
  }
  return { progress, sent }
}
const noProgress = progressRecorder().progress

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
    getMe: record('getMe', { accountId: 'u1', displayName: 'Me' }),
    listCustomers: record('listCustomers', []),
    getToggles: record('getToggles', TOGGLES),
    setToggles: record('setToggles', TOGGLES),
    listViews: record('listViews', []),
    createView: record('createView', VIEW),
    renameView: record('renameView', VIEW),
    deleteView: record('deleteView', undefined),
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
    const result = await createHandlers(backend)['session:login'](
      { ...login, token: undefined },
      noProgress,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('refuses an unknown field, so the renderer cannot smuggle extra input to core', async () => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['session:login'](
      { ...login, admin: true },
      noProgress,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('never echoes the token in a validation message', async () => {
    const { backend } = fakeBackend()
    const result = await createHandlers(backend)['session:login'](
      { ...login, token: TOKEN.repeat(100), email: 42 },
      noProgress,
    )
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
    const result = await createHandlers(backend)['issues:setSummary'](raw, noProgress)
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('refuses an argument on a channel that takes none', async () => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['user:me']({ key: 'PSAPAC-1' }, noProgress)
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('passes a valid request through, with the summary trimmed', async () => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['issues:setSummary'](
      { key: 'PSAPAC-12', summary: '  New summary  ' },
      noProgress,
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(calls).toEqual([
      { method: 'setSummary', args: [{ key: 'PSAPAC-12', summary: 'New summary' }] },
    ])
  })
})

describe('issue loads', () => {
  it.each([
    ['an unknown phase', { phase: 'all', loadId: 1 }],
    ['a missing load id', { phase: 'done' }],
    ['a fractional load id', { phase: 'done', loadId: 1.5 }],
    ['an extra key', { phase: 'done', loadId: 1, pageSize: 5000 }],
    ['no argument', undefined],
  ])('issues:list refuses %s', async (_name, raw) => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['issues:list'](raw, noProgress)
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it("issues:list passes each page's progress to sendProgress", async () => {
    const { progress, sent } = progressRecorder()
    const { backend } = fakeBackend({
      listIssues(args, to) {
        to.sendProgress({ ...args, loaded: 100 })
        to.sendProgress({ ...args, loaded: 200 })
        return Promise.resolve([])
      },
    })
    const result = await createHandlers(backend)['issues:list'](
      { phase: 'done', loadId: 7 },
      progress,
    )
    expect(result).toEqual({ ok: true, data: [] })
    expect(sent).toEqual([
      { phase: 'done', loadId: 7, loaded: 100 },
      { phase: 'done', loadId: 7, loaded: 200 },
    ])
  })

  it('an aborted load logs nothing', async () => {
    const log = vi.fn()
    const { backend } = fakeBackend({ listIssues: () => Promise.resolve(null) })
    const result = await createHandlers(backend, log)['issues:list'](LIST, noProgress)
    expect(result).toEqual({ ok: true, data: null })
    expect(log).not.toHaveBeenCalled()
  })
})

describe('toggles', () => {
  it.each([
    ['a missing key', { hideDone: true, assigneeMe: false }],
    ['an extra key', { ...TOGGLES, theme: 'dark' }],
    ['a non-boolean value', { ...TOGGLES, hideDone: 'yes' }],
    ['no argument', undefined],
  ])('settings:setToggles refuses %s', async (_name, raw) => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['settings:setToggles'](raw, noProgress)
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('settings:setToggles passes three booleans to the backend', async () => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['settings:setToggles'](TOGGLES, noProgress)
    expect(result).toEqual({ ok: true, data: TOGGLES })
    expect(calls).toEqual([{ method: 'setToggles', args: [TOGGLES] }])
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
    const result = await createHandlers(backend, () => undefined)['issues:list'](LIST, noProgress)
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
    const result = await createHandlers(backend, log)['issues:list'](LIST, noProgress)
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
    await createHandlers(backend, log)['issues:list'](LIST, noProgress)

    expect(log.mock.calls.length).toBe(2)
    expect(log.mock.calls[1]?.[0]).toMatch(/^\s+at /)
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN)
    expect(JSON.stringify(log.mock.calls)).not.toContain('fetch failed')
  })

  it('logs no stack without JM_DEBUG', async () => {
    const log = vi.fn<(line: string) => void>()
    const { backend } = fakeBackend({ listIssues: () => Promise.reject(new TypeError('boom')) })
    await createHandlers(backend, log)['issues:list'](LIST, noProgress)
    expect(log.mock.calls.length).toBe(1)
  })
})

describe('stackFrames', () => {
  it('is empty for a value that is not an error', () => {
    expect(stackFrames('boom')).toBe('')
  })
})

describe('saved views', () => {
  it('views:create passes the name, filters and toggles to the backend', async () => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['views:create'](NEW_VIEW, noProgress)
    expect(result).toEqual({ ok: true, data: VIEW })
    expect(calls).toEqual([{ method: 'createView', args: [NEW_VIEW] }])
  })

  it('views:create accepts a view with no filters', async () => {
    const { backend, calls } = fakeBackend()
    const raw = { name: 'All', filters: {}, toggles: TOGGLES }
    expect(await createHandlers(backend)['views:create'](raw, noProgress)).toMatchObject({
      ok: true,
    })
    expect(calls).toHaveLength(1)
  })

  it.each([
    ['an unknown filter field', { ...NEW_VIEW, filters: { owner: ['me'] } }],
    ['a filter value that is not a list', { ...NEW_VIEW, filters: { type: 'Bug' } }],
    ['a non-string filter value', { ...NEW_VIEW, filters: { type: [1] } }],
    ['an extra key', { ...NEW_VIEW, id: 'bugs' }],
    ['a missing toggle', { ...NEW_VIEW, toggles: { hideDone: true } }],
    ['a name over 80 characters', { ...NEW_VIEW, name: 'x'.repeat(81) }],
    ['no filters', { name: 'Bugs', toggles: TOGGLES }],
  ])('views:create refuses %s', async (_name, raw) => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)['views:create'](raw, noProgress)
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('views:rename and views:delete take an id, and views:delete answers null', async () => {
    const { backend, calls } = fakeBackend()
    const handlers = createHandlers(backend)
    expect(await handlers['views:rename']({ id: 'bugs', name: 'Defects' }, noProgress)).toEqual({
      ok: true,
      data: VIEW,
    })
    expect(await handlers['views:delete']({ id: 'bugs' }, noProgress)).toEqual({
      ok: true,
      data: null,
    })
    expect(calls).toEqual([
      { method: 'renameView', args: [{ id: 'bugs', name: 'Defects' }] },
      { method: 'deleteView', args: [{ id: 'bugs' }] },
    ])
  })

  it.each([
    ['views:rename', { id: '', name: 'X' }],
    ['views:rename', { id: 'bugs' }],
    ['views:rename', { id: 'bugs', name: 'X', extra: 1 }],
    ['views:delete', {}],
    ['views:delete', { id: 'bugs', name: 'X' }],
  ] as const)('%s refuses %j', async (channel, raw) => {
    const { backend, calls } = fakeBackend()
    const result = await createHandlers(backend)[channel](raw, noProgress)
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    expect(calls).toEqual([])
  })

  it('views:list takes no argument', async () => {
    const { backend } = fakeBackend()
    const handlers = createHandlers(backend)
    expect(await handlers['views:list'](undefined, noProgress)).toEqual({ ok: true, data: [] })
    expect(await handlers['views:list']({ x: 1 }, noProgress)).toMatchObject({ ok: false })
  })

  it('maps a core refusal to the IPC error shape', async () => {
    const { backend } = fakeBackend({
      createView: () =>
        Promise.reject(
          new JiraMgrError('validation_failed', 'A view named "Bugs" already exists.'),
        ),
    })
    const log = vi.fn()
    const result = await createHandlers(backend, log)['views:create'](NEW_VIEW, noProgress)
    expect(result).toEqual({
      ok: false,
      error: { code: 'validation_failed', message: 'A view named "Bugs" already exists.' },
    })
  })
})
