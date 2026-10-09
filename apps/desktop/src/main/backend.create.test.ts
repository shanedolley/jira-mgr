import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JiraMgrError } from '@jira-mgr/core'
import type { HttpClient } from '@jira-mgr/core/http'
import { writeFields, writeSettings } from '@jira-mgr/core/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBackend, type ProgressSender } from './backend'

const SITE = 'https://team.atlassian.net'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-desktop-create-'))
  process.env.JM_STATE_DIR = dir
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
})
afterEach(async () => {
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

interface Request {
  method: string
  path: string
  body: unknown
}

type Respond = (request: Request) => unknown

/** Records every request and answers each with `respond`, so a test sees what would be sent. */
function routedHttp(respond: Respond) {
  const requests: Request[] = []
  const http: HttpClient = {
    request(method, path, options) {
      const request = { method, path, body: options?.body }
      requests.push(request)
      try {
        return Promise.resolve(respond(request))
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }
  return { http, requests }
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  )

const rawIssue = (key: string, subtasks: string[] = []) => ({
  id: '1',
  key,
  fields: {
    summary: 'An issue',
    issuetype: { id: '10', name: 'Story', subtask: false, hierarchyLevel: 0 },
    status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
    labels: [],
    created: '2026-10-01T00:00:00.000Z',
    updated: '2026-10-01T00:00:00.000Z',
    subtasks: subtasks.map((s) => ({
      key: s,
      fields: { summary: `Summary of ${s}`, status: { name: 'To Do' } },
    })),
  },
})

const NEW = { type: 'Story', summary: 'Write it', customerId: '1', engagementId: '7' } as const

/** A project whose create answers with PSAPAC-9 and whose reads and sprint moves succeed. */
const accepts: Respond = ({ method, path }) =>
  method === 'POST' && path === '/rest/api/3/issue'
    ? { id: '9', key: 'PSAPAC-9' }
    : method === 'GET'
      ? rawIssue('PSAPAC-9')
      : undefined

const calls = (requests: Request[]) =>
  requests.map((r) => `${r.method} ${r.path.split('?')[0] ?? ''}`)

describe('createIssue', () => {
  it('creates, reads the issue back and returns what the project holds', async () => {
    const { http, requests } = routedHttp(accepts)
    const created = await createBackend({ http }).createIssue({ ...NEW, parentKey: 'PSAPAC-10' })

    expect(created).toMatchObject({ key: 'PSAPAC-9', warning: null, issue: { key: 'PSAPAC-9' } })
    expect(calls(requests)).toEqual(['POST /rest/api/3/issue', 'GET /rest/api/3/issue/PSAPAC-9'])
    expect(requests[0]?.body).toMatchObject({
      fields: {
        project: { key: 'PSAPAC' },
        issuetype: { name: 'Story' },
        summary: 'Write it',
        customfield_1: { id: '1' },
        customfield_2: { id: '7' },
        parent: { key: 'PSAPAC-10' },
      },
    })
  })

  it('moves the new issue into the chosen sprint, then reads it again', async () => {
    const { http, requests } = routedHttp(accepts)
    const created = await createBackend({ http }).createIssue({ ...NEW, sprintId: 5 })

    expect(created.warning).toBeNull()
    expect(calls(requests)).toEqual([
      'POST /rest/api/3/issue',
      'GET /rest/api/3/issue/PSAPAC-9',
      'POST /rest/agile/1.0/sprint/5/issue',
      'GET /rest/api/3/issue/PSAPAC-9',
    ])
    expect(requests[2]?.body).toEqual({ issues: ['PSAPAC-9'] })
  })

  it('keeps the key and says so when the sprint move fails', async () => {
    const { http } = routedHttp((request) => {
      if (request.path.startsWith('/rest/agile')) {
        throw new JiraMgrError('validation_failed', 'The sprint is closed.')
      }
      return accepts(request)
    })
    const created = await createBackend({ http }).createIssue({ ...NEW, sprintId: 5 })

    expect(created.key).toBe('PSAPAC-9')
    // The first read-back is still accurate, so the caller keeps it.
    expect(created.issue).toMatchObject({ key: 'PSAPAC-9' })
    expect(created.warning).toBe(
      'Created PSAPAC-9, but it is not in the sprint. The sprint is closed.',
    )
  })

  it('returns the key with a warning when the read after the sprint move fails', async () => {
    let reads = 0
    const { http } = routedHttp((request) => {
      if (request.method === 'GET' && ++reads === 2) {
        throw new JiraMgrError('jira_error', 'The site is down.')
      }
      return accepts(request)
    })
    const created = await createBackend({ http }).createIssue({ ...NEW, sprintId: 5 })

    expect(created).toMatchObject({ key: 'PSAPAC-9', issue: null })
    expect(created.warning).toContain('could not read it back')
  })

  it('drops the read-back warning when the read after the sprint move works', async () => {
    let reads = 0
    const { http } = routedHttp((request) => {
      if (request.method === 'GET' && ++reads === 1) {
        throw new JiraMgrError('jira_error', 'The site is down.')
      }
      return accepts(request)
    })
    const created = await createBackend({ http }).createIssue({ ...NEW, sprintId: 5 })

    expect(created).toMatchObject({ key: 'PSAPAC-9', warning: null, issue: { key: 'PSAPAC-9' } })
  })

  it('keeps the read-back warning when the sprint move fails', async () => {
    const { http } = routedHttp((request) => {
      if (request.method === 'GET') throw new JiraMgrError('jira_error', 'The site is down.')
      if (request.path.startsWith('/rest/agile')) {
        throw new JiraMgrError('validation_failed', 'The sprint is closed.')
      }
      return accepts(request)
    })
    const created = await createBackend({ http }).createIssue({ ...NEW, sprintId: 5 })

    expect(created.issue).toBeNull()
    expect(created.warning).toContain('could not read it back')
  })

  it('returns the key with a warning when the read-back fails after the create', async () => {
    const { http } = routedHttp((request) => {
      if (request.method === 'GET') throw new JiraMgrError('jira_error', 'The site is down.')
      return accepts(request)
    })
    const created = await createBackend({ http }).createIssue(NEW)

    expect(created).toMatchObject({ key: 'PSAPAC-9', issue: null })
    expect(created.warning).toContain('Created PSAPAC-9, but could not read it back')
    expect(created.warning).not.toContain('jm issue get')
  })

  it('throws when the project refuses the create, since no issue exists', async () => {
    const { http } = routedHttp(() => {
      throw new JiraMgrError('validation_failed', 'Customer is required.')
    })
    const error = await failure(createBackend({ http }).createIssue(NEW))

    expect(error).toMatchObject({ code: 'validation_failed', message: 'Customer is required.' })
  })

  it('refuses a parent of another project before any request is sent', async () => {
    const { http, requests } = routedHttp(accepts)
    const error = await failure(
      createBackend({ http }).createIssue({ ...NEW, parentKey: 'OTHER-1' }),
    )

    expect(error).toMatchObject({ code: 'validation_failed' })
    expect(requests).toEqual([])
  })

  it('refuses a Subtask with no parent before any request is sent', async () => {
    const { http, requests } = routedHttp(accepts)
    const error = await failure(createBackend({ http }).createIssue({ ...NEW, type: 'Subtask' }))

    expect(error).toMatchObject({ code: 'validation_failed' })
    expect(requests).toEqual([])
  })
})

describe('late read', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function window(open = true) {
    const state = { open, reads: [] as unknown[] }
    const to: ProgressSender = {
      sendProgress: () => undefined,
      isOpen: () => state.open,
      sendLateRead: (read) => state.reads.push(read),
    }
    return { state, to }
  }
  const gets = (requests: Request[]) => requests.filter((r) => r.method === 'GET').length

  it('reads the issue again after the delay and sends it to the window', async () => {
    const { http, requests } = routedHttp(accepts)
    const { state, to } = window()
    await createBackend({ http, lateReadMs: 5000 }).createIssue(NEW, to)
    const before = gets(requests)

    await vi.advanceTimersByTimeAsync(4999)
    expect(state.reads).toEqual([])
    await vi.advanceTimersByTimeAsync(1)

    // Core reads its field ids from disk first, which fake timers do not advance.
    await vi.waitFor(() => {
      expect(state.reads).toHaveLength(1)
    })
    expect(gets(requests)).toBe(before + 1)
    expect(state.reads).toMatchObject([{ key: 'PSAPAC-9', issue: { key: 'PSAPAC-9' } }])
  })

  it('schedules nothing without a window to tell', async () => {
    const { http, requests } = routedHttp(accepts)
    await createBackend({ http, lateReadMs: 5000 }).createIssue(NEW)
    const before = requests.length

    await vi.advanceTimersByTimeAsync(10_000)

    expect(requests).toHaveLength(before)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does nothing when the window closed before the timer fired', async () => {
    const { http, requests } = routedHttp(accepts)
    const { state, to } = window()
    await createBackend({ http, lateReadMs: 5000 }).createIssue(NEW, to)
    const before = requests.length
    state.open = false

    await vi.advanceTimersByTimeAsync(5000)

    expect(requests).toHaveLength(before)
    expect(state.reads).toEqual([])
  })

  it('sends nothing when the issue is gone by then', async () => {
    let gone = false
    const { http, requests } = routedHttp((request) => {
      if (gone && request.method === 'GET') throw new JiraMgrError('not_found', 'Gone.')
      return accepts(request)
    })
    const { state, to } = window()
    await createBackend({ http, lateReadMs: 5000 }).createIssue(NEW, to)
    const before = gets(requests)
    gone = true

    await vi.advanceTimersByTimeAsync(5000)
    await vi.waitFor(() => {
      expect(gets(requests)).toBe(before + 1)
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(state.reads).toEqual([])
  })

  it('cancels the pending read on logout and on dispose', async () => {
    const { http } = routedHttp(accepts)
    const { state, to } = window()
    const backend = createBackend({
      http,
      lateReadMs: 5000,
      keychain: {
        get: () => Promise.resolve('token'),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        deleteAll: () => Promise.resolve(),
      },
    })
    await backend.createIssue(NEW, to)
    await backend.createIssue(NEW, to)
    expect(vi.getTimerCount()).toBe(2)

    await backend.logout()
    expect(vi.getTimerCount()).toBe(0)

    await backend.createIssue(NEW, to)
    backend.dispose()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(state.reads).toEqual([])
  })
})

describe('deleteIssue', () => {
  const reads =
    (subtasks: string[]): Respond =>
    ({ method }) =>
      method === 'GET' ? rawIssue('PSAPAC-12', subtasks) : undefined
  const deletes = (requests: Request[]) => requests.filter((r) => r.method === 'DELETE')

  it('deletes an issue with no subtasks without the cascade', async () => {
    const { http, requests } = routedHttp(reads([]))
    const result = await createBackend({ http }).deleteIssue({
      key: 'PSAPAC-12',
      deleteSubtasks: false,
      subtasks: [],
    })

    expect(result).toEqual({ key: 'PSAPAC-12', deletedSubtasks: [] })
    expect(deletes(requests).map((r) => r.path)).toEqual([
      '/rest/api/3/issue/PSAPAC-12?deleteSubtasks=false',
    ])
  })

  it('cascades only when asked, and reports the subtasks that went', async () => {
    const { http, requests } = routedHttp(reads(['PSAPAC-13', 'PSAPAC-14']))
    const result = await createBackend({ http }).deleteIssue({
      key: 'PSAPAC-12',
      deleteSubtasks: true,
      subtasks: ['PSAPAC-14', 'PSAPAC-13'],
    })

    expect(result.deletedSubtasks).toEqual(['PSAPAC-13', 'PSAPAC-14'])
    expect(deletes(requests).map((r) => r.path)).toEqual([
      '/rest/api/3/issue/PSAPAC-12?deleteSubtasks=true',
    ])
  })

  it('refuses to delete an issue that has subtasks unless asked to cascade', async () => {
    const { http, requests } = routedHttp(reads(['PSAPAC-13']))
    const error = await failure(
      createBackend({ http }).deleteIssue({
        key: 'PSAPAC-12',
        deleteSubtasks: false,
        subtasks: [],
      }),
    )

    expect(error).toMatchObject({ code: 'validation_failed' })
    expect((error as Error).message).toContain('PSAPAC-13')
    expect(deletes(requests)).toEqual([])
  })

  it('refuses to cascade to a subtask the user was not shown', async () => {
    const { http, requests } = routedHttp(reads(['PSAPAC-13', 'PSAPAC-14']))
    const error = await failure(
      createBackend({ http }).deleteIssue({
        key: 'PSAPAC-12',
        deleteSubtasks: true,
        subtasks: ['PSAPAC-13'],
      }),
    )

    expect(error).toMatchObject({ code: 'validation_failed' })
    expect((error as Error).message).toContain('PSAPAC-14')
    expect(deletes(requests)).toEqual([])
  })

  it('refuses an issue of another project before any request is sent', async () => {
    const { http, requests } = routedHttp(reads([]))
    const error = await failure(
      createBackend({ http }).deleteIssue({ key: 'OTHER-5', deleteSubtasks: false, subtasks: [] }),
    )

    expect(error).toMatchObject({ code: 'validation_failed' })
    expect(requests).toEqual([])
  })
})
