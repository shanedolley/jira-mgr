import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JiraMgrError } from '@jira-mgr/core'
import type { Keychain } from '@jira-mgr/core/auth'
import type { HttpClient } from '@jira-mgr/core/http'
import * as state from '@jira-mgr/core/state'
import { readSettings, writeFields, writeSettings } from '@jira-mgr/core/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBackend, type ProgressSender } from './backend'

// Passes through to core. `setToggles` ordering needs one write held by hand.
vi.mock('@jira-mgr/core/state', async (importOriginal) => {
  const real = await importOriginal<typeof import('@jira-mgr/core/state')>()
  return { ...real, writeSettings: vi.fn(real.writeSettings) }
})

const SITE = 'https://team.atlassian.net'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-desktop-state-'))
  process.env.JM_STATE_DIR = dir
})
afterEach(async () => {
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

async function logIn() {
  await writeSettings({ siteUrl: SITE, projectKey: 'PSAPAC', email: 'me@example.com' })
  await writeFields({
    site: SITE,
    project: 'PSAPAC',
    resolvedAt: '2026-10-09T00:00:00.000Z',
    ids: {
      customer: 'customfield_1',
      engagement: 'customfield_2',
      sprint: 'customfield_3',
      startDate: 'customfield_4',
      timeRemaining: 'customfield_5',
    },
  })
}

/** An HTTP client that records every request and answers none, so a test sees what would be sent. */
function recordingHttp() {
  const requests: { method: string; path: string; body: unknown }[] = []
  const http: HttpClient = {
    request(method, path, options) {
      requests.push({ method, path, body: options?.body })
      return Promise.resolve(undefined)
    },
  }
  return { http, requests }
}

describe('setSummary', () => {
  it('refuses an issue of another project before any request is sent', async () => {
    await logIn()
    const { http, requests } = recordingHttp()
    const error = await createBackend({ http })
      .setSummary({ key: 'OTHER-5', summary: 'New' })
      .then(
        () => undefined,
        (e: unknown) => e,
      )
    expect(error).toBeInstanceOf(JiraMgrError)
    expect(error).toMatchObject({
      code: 'validation_failed',
      message: 'OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.',
    })
    expect(requests).toEqual([])
  })

  it('refuses every write when no project is set', async () => {
    const { http, requests } = recordingHttp()
    await expect(
      createBackend({ http }).setSummary({ key: 'PSAPAC-12', summary: 'New' }),
    ).rejects.toMatchObject({ code: 'permission_denied' })
    expect(requests).toEqual([])
  })

  it('edits an issue of the project with one PUT holding the summary', async () => {
    await logIn()
    const { http, requests } = recordingHttp()
    await createBackend({ http }).setSummary({ key: 'PSAPAC-12', summary: 'New' })
    expect(requests).toEqual([
      { method: 'PUT', path: '/rest/api/3/issue/PSAPAC-12', body: { fields: { summary: 'New' } } },
    ])
  })
})

describe('batch', () => {
  const status = (n: number) => ({
    key: `PSAPAC-${String(n)}`,
    id: String(1000 + n),
    change: { kind: 'status', statusId: '3' } as const,
  })

  /** Serves the bulk transition calls of `done` issues, and records every request. */
  function bulkHttp(options: { submit?: Error } = {}) {
    const requests: { method: string; path: string; body: unknown }[] = []
    const http: HttpClient = {
      request(method, path, init) {
        requests.push({ method, path, body: init?.body })
        if (method === 'GET' && path.startsWith('/rest/api/3/bulk/issues/transition')) {
          return Promise.resolve({
            availableTransitions: [
              {
                transitions: [{ transitionId: 31, to: { statusId: 3 } }],
                issues: ['PSAPAC-1', 'PSAPAC-2'],
              },
            ],
          })
        }
        if (method === 'POST') {
          return options.submit === undefined
            ? Promise.resolve({ taskId: '7' })
            : Promise.reject(options.submit)
        }
        return Promise.resolve({
          status: 'COMPLETE',
          processedAccessibleIssues: [1001, 1002],
          failedAccessibleIssues: {},
        })
      },
    }
    return { http, requests }
  }
  const fast = { pollMs: 100, sleep: () => Promise.resolve() }

  it('refuses a key of another project, and a new parent of another project, before any request', async () => {
    await logIn()
    const { http, requests } = bulkHttp()
    const { progress } = progressRecorder()
    const backend = createBackend({ http, batchPoll: fast })
    await expect(
      backend.batch({ batchId: 1, items: [status(1), { ...status(2), key: 'OTHER-2' }] }, progress),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(
      backend.batch(
        {
          batchId: 1,
          items: [{ ...status(1), change: { kind: 'edit', changes: { parentKey: 'OTHER-9' } } }],
        },
        progress,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    expect(requests).toEqual([])
  })

  it('refuses a type change on an Epic like a single edit does, before the write', async () => {
    await logIn()
    const requests: string[] = []
    const http: HttpClient = {
      request(method, path) {
        requests.push(`${method} ${path}`)
        return Promise.resolve({
          id: '1001',
          key: 'PSAPAC-1',
          fields: {
            summary: 'Epic',
            issuetype: { id: '9', name: 'Epic', subtask: false, hierarchyLevel: 1 },
            status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
            labels: [],
            created: '2026-10-01T00:00:00.000Z',
            updated: '2026-10-01T00:00:00.000Z',
          },
        })
      },
    }
    await expect(
      createBackend({ http, batchPoll: fast }).batch(
        {
          batchId: 1,
          items: [{ ...status(1), change: { kind: 'edit', changes: { type: 'Story' } } }],
        },
        progressRecorder().progress,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    // One read of the type, and no write.
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatch(/^GET .*PSAPAC-1\?/)
  })

  it('runs the batch through core and reports each settled issue as progress for its batch id', async () => {
    await logIn()
    const { http, requests } = bulkHttp()
    const { progress, sent } = progressRecorder()
    const outcome = await createBackend({ http, batchPoll: fast }).batch(
      { batchId: 7, items: [status(1), status(2)] },
      progress,
    )
    expect(outcome).toEqual({ done: ['PSAPAC-1', 'PSAPAC-2'], refused: [] })
    expect(requests.filter(({ method }) => method === 'POST')).toEqual([
      {
        method: 'POST',
        path: '/rest/api/3/bulk/issues/transition',
        body: {
          bulkTransitionInputs: [
            { selectedIssueIdsOrKeys: ['PSAPAC-1', 'PSAPAC-2'], transitionId: '31' },
          ],
          sendBulkNotification: false,
        },
      },
    ])
    expect(sent.at(-1)).toEqual({ batchId: 7, done: 2, total: 2 })
  })

  it('stops reporting progress once the window is gone', async () => {
    await logIn()
    const { http } = bulkHttp()
    const sent: unknown[] = []
    const gone: ProgressSender = {
      sendProgress: () => undefined,
      sendBatchProgress: (p) => sent.push(p),
      isOpen: () => false,
      sendLateRead: () => undefined,
    }
    await createBackend({ http, batchPoll: fast }).batch(
      { batchId: 1, items: [status(1), status(2)] },
      gone,
    )
    expect(sent).toEqual([])
  })

  it('returns a refusal in the outcome instead of throwing', async () => {
    await logIn()
    const { http } = bulkHttp({ submit: new Error('Jira is down') })
    const outcome = await createBackend({ http, batchPoll: fast }).batch(
      { batchId: 1, items: [status(1), status(2)] },
      progressRecorder().progress,
    )
    expect(outcome.done).toEqual([])
    expect(outcome.refused.map(({ key }) => key)).toEqual(['PSAPAC-1', 'PSAPAC-2'])
    expect(outcome.refused[0]?.reason).toContain('Jira is down')
  })

  it('words a refusal without the request core names in it', async () => {
    await logIn()
    const { http } = bulkHttp({
      submit: new Error('Jira answered 500 to POST /rest/api/3/bulk/issues/transition: Boom.'),
    })
    const outcome = await createBackend({ http, batchPoll: fast }).batch(
      { batchId: 1, items: [status(1)] },
      progressRecorder().progress,
    )
    expect(outcome.refused[0]?.reason).toBe('Jira answered 500: Boom.')
  })

  it('aborts a running batch on logout, so no request goes out after it', async () => {
    await logIn()
    const calls: string[] = []
    const http: HttpClient = {
      request(method, path, init) {
        calls.push(`${method} ${path}`)
        // The transitions lookup never answers until the batch is aborted.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error)
          })
        })
      },
    }
    const backend = createBackend({ http, batchPoll: fast, keychain: fakeKeychain().keychain })
    const running = expect(
      backend.batch({ batchId: 1, items: [status(1), status(2)] }, progressRecorder().progress),
    ).rejects.toMatchObject({ code: 'jira_error' })
    await expect.poll(() => calls.length).toBe(1)
    await backend.logout()
    await running
    expect(calls).toHaveLength(1)
  })
})

function rawIssue(n: number) {
  return {
    id: String(n),
    key: `PSAPAC-${String(n)}`,
    fields: {
      summary: `Issue ${String(n)}`,
      issuetype: { id: '1', name: 'Story', subtask: false, hierarchyLevel: 0 },
      status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
      labels: [],
      created: '2026-10-01T00:00:00.000Z',
      updated: '2026-10-01T00:00:00.000Z',
    },
  }
}

/**
 * Serves search pages of two issues each, three pages per phase, and holds every page until the
 * test releases it or the request's signal aborts, as the real client does.
 */
function pagedHttp() {
  const requests: { phase: 'unresolved' | 'done'; signal: AbortSignal | undefined }[] = []
  const waiting: { release: () => void; signal: AbortSignal | undefined }[] = []
  const http: HttpClient = {
    request(_method, _path, options) {
      const body = options?.body as { jql: string; nextPageToken?: string }
      const phase = body.jql.includes('!= Done') ? 'unresolved' : 'done'
      requests.push({ phase, signal: options?.signal })
      const page = Number(body.nextPageToken ?? '0')
      const base = phase === 'unresolved' ? 100 : 200
      return new Promise((resolve, reject) => {
        const answer = () => {
          resolve({
            issues: [rawIssue(base + page * 2), rawIssue(base + page * 2 + 1)],
            isLast: page === 2,
            nextPageToken: String(page + 1),
          })
        }
        const signal = options?.signal
        // As the real client: an already aborted signal fails the request at once.
        if (signal?.aborted === true) reject(signal.reason as Error)
        signal?.addEventListener('abort', () => {
          reject(signal.reason as Error)
        })
        waiting.push({ release: answer, signal })
      })
    },
  }
  /** Lets the oldest held page through, once a request has arrived. */
  async function releaseNext() {
    await expect.poll(() => waiting.length).toBeGreaterThan(0)
    waiting.shift()?.release()
  }
  return { http, requests, releaseNext, waiting }
}

function progressRecorder() {
  const sent: unknown[] = []
  const progress: ProgressSender = {
    sendProgress(p) {
      sent.push(p)
    },
    sendBatchProgress(p) {
      sent.push(p)
    },
    isOpen: () => true,
    sendLateRead: () => undefined,
  }
  return { progress, sent }
}

/** Holds each text search until the test releases the newest or its signal aborts, and records the JQL. */
function textSearchHttp() {
  const requests: { jql: string; signal: AbortSignal | undefined }[] = []
  const waiting: (() => void)[] = []
  const http: HttpClient = {
    request(_method, _path, options) {
      const { jql } = options?.body as { jql: string }
      requests.push({ jql, signal: options?.signal })
      return new Promise((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(options.signal?.reason as Error)
        })
        waiting.push(() => {
          resolve({ issues: [rawIssue(requests.length)], isLast: true })
        })
      })
    },
  }
  return { http, requests, release: () => waiting.pop()?.() }
}

describe('searchText', () => {
  it('searches the project text and returns the issues', async () => {
    await logIn()
    const { http, requests, release } = textSearchHttp()
    const search = createBackend({ http }).searchText({ query: 'runbook' })
    await expect.poll(() => requests.length).toBe(1)
    release()
    expect((await search)?.map((i) => i.key)).toEqual(['PSAPAC-1'])
    expect(requests[0]?.jql).toContain('text ~ "runbook"')
  })

  it('a second search aborts the first, which returns null, and the second still answers', async () => {
    await logIn()
    const { http, requests, release } = textSearchHttp()
    const backend = createBackend({ http })
    const first = backend.searchText({ query: 'one' })
    await expect.poll(() => requests.length).toBe(1)
    const second = backend.searchText({ query: 'two' })

    await expect(first).resolves.toBeNull()
    expect(requests[0]?.signal?.aborted).toBe(true)
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1]?.signal?.aborted).toBe(false)
    release()
    expect((await second)?.length).toBe(1)
  })

  it('returns null for a search that Jira answers after a newer one aborted it', async () => {
    await logIn()
    const answers: (() => void)[] = []
    // Ignores the signal, so the first answer still arrives after the abort.
    const http: HttpClient = {
      request: () =>
        new Promise((resolve) => {
          answers.push(() => {
            resolve({ issues: [rawIssue(answers.length)], isLast: true })
          })
        }),
    }
    const backend = createBackend({ http })
    const first = backend.searchText({ query: 'one' })
    await expect.poll(() => answers.length).toBe(1)
    const second = backend.searchText({ query: 'two' })
    await expect.poll(() => answers.length).toBe(2)

    answers[0]?.()
    await expect(first).resolves.toBeNull()
    answers[1]?.()
    expect((await second)?.length).toBe(1)
  })

  it('logout aborts the search in flight', async () => {
    await logIn()
    const { http, requests } = textSearchHttp()
    const backend = createBackend({ http, keychain: fakeKeychain().keychain })
    const search = backend.searchText({ query: 'one' })
    await expect.poll(() => requests.length).toBe(1)

    await backend.logout()
    await expect(search).resolves.toBeNull()
    expect(requests[0]?.signal?.aborted).toBe(true)
  })

  it('passes a failure that is not an abort on', async () => {
    await logIn()
    const http: HttpClient = {
      request: () => Promise.reject(new JiraMgrError('jira_error', 'Jira is down.')),
    }
    await expect(createBackend({ http }).searchText({ query: 'x' })).rejects.toMatchObject({
      code: 'jira_error',
    })
  })
})

describe('listIssues', () => {
  it('loads one phase and reports progress per page with its load id', async () => {
    await logIn()
    const { http, requests, releaseNext } = pagedHttp()
    const { progress, sent } = progressRecorder()
    const load = createBackend({ http }).listIssues({ phase: 'done', loadId: 4 }, progress)
    for (let page = 0; page < 3; page++) await releaseNext()

    const issues = await load
    expect(issues?.map((i) => i.key)).toEqual([
      'PSAPAC-200',
      'PSAPAC-201',
      'PSAPAC-202',
      'PSAPAC-203',
      'PSAPAC-204',
      'PSAPAC-205',
    ])
    expect(sent).toEqual([
      { phase: 'done', loadId: 4, loaded: 2 },
      { phase: 'done', loadId: 4, loaded: 4 },
      { phase: 'done', loadId: 4, loaded: 6 },
    ])
    // The unresolved phase sends no request.
    expect(requests.map((r) => r.phase)).toEqual(['done', 'done', 'done'])
  })

  it('a second load of a phase aborts the first, which returns null', async () => {
    await logIn()
    const { http, requests, releaseNext, waiting } = pagedHttp()
    const backend = createBackend({ http })
    const first = backend.listIssues(
      { phase: 'unresolved', loadId: 1 },
      progressRecorder().progress,
    )
    await expect.poll(() => requests.length).toBe(1)

    const second = backend.listIssues(
      { phase: 'unresolved', loadId: 2 },
      progressRecorder().progress,
    )
    await expect(first).resolves.toBeNull()
    expect(requests[0]?.signal?.aborted).toBe(true)

    // The newer load is untouched and runs to the end.
    waiting.shift()
    for (let page = 0; page < 3; page++) await releaseNext()
    expect((await second)?.length).toBe(6)
  })

  it('does not abort the load of the other phase', async () => {
    await logIn()
    const { http, requests } = pagedHttp()
    const backend = createBackend({ http })
    void backend.listIssues({ phase: 'unresolved', loadId: 1 }, progressRecorder().progress)
    void backend.listIssues({ phase: 'done', loadId: 2 }, progressRecorder().progress)
    await expect.poll(() => requests.length).toBe(2)
    expect(requests.map((r) => r.signal?.aborted)).toEqual([false, false])
  })

  it("an aborted load leaves the newer load's controller in place", async () => {
    await logIn()
    const { http, requests } = pagedHttp()
    const backend = createBackend({ http, keychain: fakeKeychain().keychain })
    const first = backend.listIssues({ phase: 'done', loadId: 1 }, progressRecorder().progress)
    await expect.poll(() => requests.length).toBe(1)
    const second = backend.listIssues({ phase: 'done', loadId: 2 }, progressRecorder().progress)
    await expect.poll(() => requests.length).toBe(2)
    // The first load's `finally` has run once it settles. If it dropped the newer entry, the
    // logout below would find nothing to abort.
    await expect(first).resolves.toBeNull()

    await backend.logout()
    await expect(second).resolves.toBeNull()
    expect(requests[1]?.signal?.aborted).toBe(true)
  })

  it('logout aborts every load before removing the token', async () => {
    await logIn()
    const { http, requests } = pagedHttp()
    const { keychain, abortedWhenDeleted } = fakeKeychain(() =>
      requests.map((r) => r.signal?.aborted),
    )
    const backend = createBackend({ http, keychain })
    const unresolved = backend.listIssues(
      { phase: 'unresolved', loadId: 1 },
      progressRecorder().progress,
    )
    const done = backend.listIssues({ phase: 'done', loadId: 2 }, progressRecorder().progress)
    await expect.poll(() => requests.length).toBe(2)

    await backend.logout()
    expect(abortedWhenDeleted()).toEqual([true, true])
    await expect(unresolved).resolves.toBeNull()
    await expect(done).resolves.toBeNull()
  })

  it('passes a failure that is not an abort on', async () => {
    await logIn()
    const http: HttpClient = {
      request: () => Promise.reject(new JiraMgrError('jira_error', 'Jira is down.')),
    }
    await expect(
      createBackend({ http }).listIssues(
        { phase: 'unresolved', loadId: 1 },
        progressRecorder().progress,
      ),
    ).rejects.toMatchObject({ code: 'jira_error' })
  })
})

/** A Keychain that holds nothing, and notes what `probe` reports at the moment of the delete. */
function fakeKeychain(probe: () => unknown[] = () => []) {
  let seen: unknown[] = []
  const keychain: Keychain = {
    get: () => Promise.resolve('token'),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    deleteAll() {
      seen = probe()
      return Promise.resolve()
    },
  }
  return { keychain, abortedWhenDeleted: () => seen }
}

describe('toggles', () => {
  it('reads core defaults on first launch', async () => {
    expect(await createBackend().getToggles()).toEqual({
      hideDone: true,
      assigneeMe: false,
      hideEmptyCustomers: true,
    })
  })

  it('setToggles writes in call order and keeps the other settings', async () => {
    await logIn()
    const backend = createBackend()
    const first = { hideDone: false, assigneeMe: false, hideEmptyCustomers: true }
    const second = { hideDone: false, assigneeMe: true, hideEmptyCustomers: false }
    // Hold the first write. Unchained, the second would read and write while it waits, and the
    // first would then land last and leave the file with the older toggles.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const write = vi.mocked(state.writeSettings)
    const real = (await vi.importActual<typeof state>('@jira-mgr/core/state')).writeSettings
    // Hold the write that carries `first`, whichever settings read finishes first.
    write.mockImplementation(async (settings) => {
      if (settings.toggles?.assigneeMe !== true) await held
      await real(settings)
    })
    write.mockClear()
    const writes = [backend.setToggles(first), backend.setToggles(second)]
    await expect.poll(() => write.mock.calls.length).toBeGreaterThan(0)
    // Give an unchained second write every chance to run first: a run of file reads is a run of
    // real I/O round trips, and the second write needs only two.
    for (let i = 0; i < 25; i++) await readSettings()
    release()
    expect(await Promise.all(writes)).toEqual([first, second])
    write.mockImplementation(real)

    const settings = await readSettings()
    expect(settings.toggles).toEqual(second)
    expect(settings).toMatchObject({ siteUrl: SITE, projectKey: 'PSAPAC', email: 'me@example.com' })
  })

  it('getDisplay reads the defaults, and setDisplay and setToggles keep each other', async () => {
    await logIn()
    const backend = createBackend()
    expect(await backend.getDisplay()).toEqual({
      properties: ['updated'],
      order: 'key',
      direction: 'desc',
    })
    const display = {
      properties: ['labels' as const, 'due' as const],
      order: 'priority' as const,
      direction: 'asc' as const,
    }
    const toggles = { hideDone: false, assigneeMe: true, hideEmptyCustomers: false }
    // Both change one file, so a second write that read before the first landed would undo it.
    await Promise.all([backend.setDisplay(display), backend.setToggles(toggles)])
    const settings = await readSettings()
    expect(settings.display).toEqual(display)
    expect(settings.toggles).toEqual(toggles)
    expect(await backend.getDisplay()).toEqual(display)
  })

  it('getTreeLevel reads stories, and setTreeLevel and setToggles keep each other', async () => {
    await logIn()
    const backend = createBackend()
    expect(await backend.getTreeLevel()).toBe('stories')
    const toggles = { hideDone: false, assigneeMe: true, hideEmptyCustomers: false }
    await Promise.all([backend.setTreeLevel('epics'), backend.setToggles(toggles)])
    const settings = await readSettings()
    expect(settings.treeLevel).toBe('epics')
    expect(settings.toggles).toEqual(toggles)
    expect(await backend.getTreeLevel()).toBe('epics')
  })

  it('keeps writing after one write fails', async () => {
    await logIn()
    const backend = createBackend()
    const toggles = { hideDone: false, assigneeMe: false, hideEmptyCustomers: false }
    await writeFile(join(dir, 'settings.json'), '{ not json')
    await expect(backend.setToggles(toggles)).rejects.toMatchObject({ code: 'validation_failed' })

    await logIn()
    await expect(backend.setToggles(toggles)).resolves.toEqual(toggles)
    expect((await readSettings()).toggles).toEqual(toggles)
  })
})

const BUGS = {
  filters: { type: ['Bug'] },
  toggles: { hideDone: false, assigneeMe: true, hideEmptyCustomers: true },
}

// `jm view list` calls `readViews`, and `--view` calls `findView`, so these read as the CLI does.
describe('views shared with the CLI', () => {
  it('lists the starter views before any file exists', async () => {
    const views = await createBackend().listViews()
    expect(views.map((v) => v.name)).toEqual([
      'My issues',
      'Created by me',
      'Current sprint',
      'Active',
      'Backlog',
    ])
  })

  it('a view made in the app is read by the CLI, by id and by name', async () => {
    const created = await createBackend().createView({ name: ' Open bugs ', ...BUGS })
    expect(created).toMatchObject({ id: 'open-bugs', name: 'Open bugs', ...BUGS })

    expect(await state.readViews()).toContainEqual(created)
    expect(await state.findView('open-bugs')).toEqual(created)
    expect(await state.findView('OPEN BUGS')).toEqual(created)
  })

  it('a view keeps its display through create, update, duplicate and rename', async () => {
    const backend = createBackend()
    const display = {
      properties: ['sprint' as const],
      order: 'due' as const,
      direction: 'asc' as const,
    }
    const created = await backend.createView({ name: 'Triage', ...BUGS, display })
    expect(created.display).toEqual(display)
    expect((await backend.renameView({ id: created.id, name: 'Triage 2' })).display).toEqual(
      display,
    )
    expect((await backend.duplicateView({ id: created.id })).display).toEqual(display)
    const next = { properties: [], order: 'priority' as const, direction: 'desc' as const }
    const updated = await backend.updateView({ id: created.id, ...BUGS, display: next })
    expect(updated.display).toEqual(next)
    expect((await state.findView(created.id)).display).toEqual(next)
  })

  it('a view made by the CLI shows in the app, and a rename and delete reach the CLI', async () => {
    const backend = createBackend()
    const made = await state.createView('From the CLI', BUGS)
    expect(await backend.listViews()).toContainEqual(made)

    const renamed = await backend.renameView({ id: made.id, name: 'Renamed' })
    expect(renamed).toEqual({ ...made, name: 'Renamed' })
    expect((await state.findView(made.id)).name).toBe('Renamed')

    await backend.deleteView({ id: made.id })
    await expect(state.findView(made.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('passes core refusals on: a taken name, an empty name and an unknown id', async () => {
    const backend = createBackend()
    await expect(backend.createView({ name: 'my issues', ...BUGS })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    await expect(backend.createView({ name: '  ', ...BUGS })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    await expect(backend.renameView({ id: 'nope', name: 'X' })).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(backend.deleteView({ id: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('keeps every edit when calls overlap', async () => {
    const backend = createBackend()
    await Promise.all([
      backend.createView({ name: 'One', ...BUGS }),
      backend.createView({ name: 'Two', ...BUGS }),
      backend.createView({ name: 'Three', ...BUGS }),
      backend.deleteView({ id: 'my-issues' }),
      backend.renameView({ id: 'current-sprint', name: 'Sprint now' }),
      backend.updateView({ id: 'active', ...BUGS }),
      backend.duplicateView({ id: 'backlog' }),
      backend.moveView({ id: 'created-by-me', toIndex: 0 }),
    ])
    const names = (await state.readViews()).map((v) => v.name).sort()
    expect(names).toEqual([
      'Active',
      'Backlog',
      'Backlog copy',
      'Created by me',
      'One',
      'Sprint now',
      'Three',
      'Two',
    ])
    expect((await state.findView('active')).filters).toEqual(BUGS.filters)
    expect((await state.readViews())[0]?.id).toBe('created-by-me')
  })

  it('update, duplicate and move rewrite views.json, and the CLI reads the result', async () => {
    const backend = createBackend()
    const updated = await backend.updateView({ id: 'my-issues', ...BUGS })
    expect(updated).toMatchObject({ id: 'my-issues', name: 'My issues', ...BUGS })
    expect(await state.findView('my-issues')).toEqual(updated)

    const copy = await backend.duplicateView({ id: 'my-issues' })
    expect(copy).toMatchObject({ id: 'my-issues-copy', name: 'My issues copy', ...BUGS })
    expect(await state.findView('My issues copy')).toEqual(copy)

    const moved = await backend.moveView({ id: 'backlog', toIndex: 0 })
    expect(moved[0]?.id).toBe('backlog')
    expect(await state.readViews()).toEqual(moved)
  })

  it('keeps working after one call fails', async () => {
    const backend = createBackend()
    await expect(backend.deleteView({ id: 'nope' })).rejects.toBeInstanceOf(JiraMgrError)
    await expect(backend.createView({ name: 'After', ...BUGS })).resolves.toMatchObject({
      id: 'after',
    })
  })
})

describe('customers', () => {
  it('maps field options to the hierarchy shape', async () => {
    await logIn()
    const http: HttpClient = {
      request(_method, path) {
        if (!path.includes('/issuetypes/')) {
          return Promise.resolve({ total: 1, issueTypes: [{ id: '10', name: 'Story' }] })
        }
        return Promise.resolve({
          total: 1,
          fields: [
            {
              key: 'customfield_1',
              allowedValues: [
                { id: '5', value: 'Acme' },
                { id: '6', value: 'Beta Ltd' },
              ],
            },
          ],
        })
      },
    }
    expect(await createBackend({ http }).listCustomers()).toEqual([
      { id: '5', value: 'Acme' },
      { id: '6', value: 'Beta Ltd' },
    ])
  })

  it('reads the working day and week from the site settings', async () => {
    const paths: string[] = []
    const http: HttpClient = {
      request(_method, path) {
        paths.push(path)
        return Promise.resolve({
          timeTrackingEnabled: true,
          timeTrackingConfiguration: { workingHoursPerDay: 7.5, workingDaysPerWeek: 5 },
        })
      },
    }
    expect(await createBackend({ http }).getTimeTracking()).toEqual({
      workingHoursPerDay: 7.5,
      workingDaysPerWeek: 5,
    })
    expect(paths).toEqual(['/rest/api/3/configuration'])
  })
})
