import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JiraMgrError } from '@jira-mgr/core'
import type { Keychain } from '@jira-mgr/core/auth'
import type { HttpClient } from '@jira-mgr/core/http'
import { readInbox } from '@jira-mgr/core/inbox'
import { writeFields, writeSettings } from '@jira-mgr/core/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBackend } from './backend'

const SITE = 'https://team.atlassian.net'
/** Two days after the change the fake Jira reports, so it is inside the Inbox window. */
const NOW = Date.parse('2026-10-11T00:00:00.000Z')
const clock = () => NOW

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-desktop-inbox-'))
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

const rawIssue = (n: number, updated: string) => ({
  id: String(n),
  key: `PSAPAC-${String(n)}`,
  fields: {
    summary: `Issue ${String(n)}`,
    issuetype: { id: '1', name: 'Story', subtask: false, hierarchyLevel: 0 },
    status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
    labels: [],
    created: '2026-10-01T00:00:00.000Z',
    updated,
  },
})

const OTHER = { accountId: 'other', displayName: 'Ben Carey' }
const CHANGE = {
  created: '2026-10-10T02:00:00.000Z',
  author: OTHER,
  items: [{ field: 'status', fromString: 'To Do', toString: 'Done' }],
}

const SEARCH = '/rest/api/3/search/jql'
const isChangelog = (path: string) => path.includes('/changelog?')

const abortion = (signal: AbortSignal | undefined) =>
  new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => {
      reject(signal.reason as Error)
    })
  })

/** Answers the Inbox's calls: two issues, `myself`, and one change by someone else on each. */
function inboxHttp(
  options: { hold?: Promise<void>; onRequest?: (signal?: AbortSignal) => void } = {},
) {
  const requests: { method: string; path: string }[] = []
  const http: HttpClient = {
    async request(method, path, request) {
      requests.push({ method, path })
      options.onRequest?.(request?.signal)
      if (path === SEARCH) {
        // Held until released, and gone when the app aborts it, as the real client's request is.
        await Promise.race([options.hold, abortion(request?.signal)])
        return {
          issues: [
            rawIssue(2, '2026-10-10T02:00:00.000Z'),
            rawIssue(1, '2026-10-10T01:00:00.000Z'),
          ],
          isLast: true,
        }
      }
      if (path === '/rest/api/3/myself') return { accountId: 'me', displayName: 'Me' }
      if (isChangelog(path)) return { startAt: 0, maxResults: 100, total: 1, values: [CHANGE] }
      throw new JiraMgrError('not_found', `No route for ${path}.`)
    },
  }
  return { http, requests }
}

const searches = (requests: { path: string }[]) => requests.filter((r) => r.path === SEARCH).length
const changelogs = (requests: { path: string }[]) =>
  requests.filter((r) => isChangelog(r.path)).length

describe('listInbox', () => {
  it('lists the issues with their unread state from inbox.json', async () => {
    const { http } = inboxHttp()
    const backend = createBackend({ http, now: clock })
    const entries = await backend.listInbox()
    expect(entries.map((e) => [e.issue.key, e.unread, e.change?.summary])).toEqual([
      ['PSAPAC-2', true, 'Status: To Do to Done'],
      ['PSAPAC-1', true, 'Status: To Do to Done'],
    ])

    await backend.markInboxRead({ key: 'PSAPAC-2', updated: '2026-10-10T02:00:00.000Z' })
    expect((await backend.listInbox()).map((e) => [e.issue.key, e.unread])).toEqual([
      ['PSAPAC-2', false],
      ['PSAPAC-1', true],
    ])
  })

  it('shares one load between calls made while it runs, then starts a new one', async () => {
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const { http, requests } = inboxHttp({ hold })
    const backend = createBackend({ http, now: clock })
    const first = backend.listInbox()
    const second = backend.listInbox()
    await expect.poll(() => searches(requests)).toBe(1)
    release()
    expect(await first).toEqual(await second)
    expect(searches(requests)).toBe(1)

    await backend.listInbox()
    expect(searches(requests)).toBe(2)
  })

  it('answers a call made after a mark with a load that read the file after it', async () => {
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const { http, requests } = inboxHttp({ hold })
    const backend = createBackend({ http, now: clock })
    // A poll is running, and has read inbox.json, when the user opens PSAPAC-2.
    const poll = backend.listInbox()
    await expect.poll(() => searches(requests)).toBe(1)
    await backend.markInboxRead({ key: 'PSAPAC-2', updated: '2026-10-10T02:00:00.000Z' })
    const afterMark = backend.listInbox()
    await expect.poll(() => searches(requests)).toBe(2)
    release()

    expect((await afterMark).find((e) => e.issue.key === 'PSAPAC-2')?.unread).toBe(false)
    await poll
  })

  it('keeps the changelogs it read while an issue stays as it was', async () => {
    const { http, requests } = inboxHttp()
    const backend = createBackend({ http, now: clock })
    await backend.listInbox()
    expect(changelogs(requests)).toBe(2)
    await backend.listInbox()
    expect(changelogs(requests)).toBe(2)
  })

  it('answers a failed read with the error, and the next call tries again', async () => {
    let failing = true
    const { http } = inboxHttp()
    const backend = createBackend({
      now: clock,
      http: {
        request: (method, path, options) =>
          failing && path === SEARCH
            ? Promise.reject(new JiraMgrError('jira_error', 'Jira is down.'))
            : http.request(method, path, options),
      },
    })
    await expect(backend.listInbox()).rejects.toMatchObject({ code: 'jira_error' })
    failing = false
    expect(await backend.listInbox()).toHaveLength(2)
  })
})

describe('Inbox writes', () => {
  it('keeps every mark when several are sent at once', async () => {
    const backend = createBackend({ http: inboxHttp().http })
    const keys = ['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-3', 'PSAPAC-4', 'PSAPAC-5']
    await Promise.all(
      keys.map((key) => backend.markInboxRead({ key, updated: new Date().toISOString() })),
    )
    expect(Object.keys((await readInbox()).reads).sort()).toEqual(keys)
  })

  it('marks everything read up to a time, and drops the marks that covers', async () => {
    const backend = createBackend({ http: inboxHttp().http })
    const now = Date.now()
    await backend.markInboxRead({
      key: 'PSAPAC-1',
      updated: new Date(now - 7_200_000).toISOString(),
    })
    const through = new Date(now - 3_600_000).toISOString()
    await backend.markInboxAllRead({ through })
    expect(await readInbox()).toEqual({ version: 1, allReadAt: through, reads: {} })
  })

  it('prunes marks against the injected clock', async () => {
    const now = Date.parse('2026-10-30T00:00:00.000Z')
    const backend = createBackend({ http: inboxHttp().http, now: () => now })
    await backend.markInboxRead({ key: 'PSAPAC-1', updated: '2026-10-10T00:00:00.000Z' })
    expect((await readInbox()).reads).toEqual({})
  })
})

describe('logout', () => {
  const keychain: Keychain = {
    get: () => Promise.resolve('token'),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    deleteAll: () => Promise.resolve(),
  }

  it('aborts the Inbox load, which answers with no entries', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const hold = new Promise<void>(() => undefined)
    const { http, requests } = inboxHttp({ hold, onRequest: (signal) => signals.push(signal) })
    const backend = createBackend({ http, keychain, now: clock })
    const load = backend.listInbox()
    await expect.poll(() => searches(requests)).toBe(1)

    await backend.logout()
    expect(signals[0]?.aborted).toBe(true)
    expect(await load).toEqual([])
  })

  it('forgets what it read, so the next account reads afresh', async () => {
    const { http, requests } = inboxHttp()
    const backend = createBackend({ http, keychain, now: clock })
    await backend.listInbox()
    await backend.logout()
    const before = changelogs(requests)
    await backend.listInbox()
    expect(changelogs(requests)).toBe(before + 2)
  })
})
