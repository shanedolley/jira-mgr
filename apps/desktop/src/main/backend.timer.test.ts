import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AdfDoc } from '@jira-mgr/core/adf'
import type { HttpClient } from '@jira-mgr/core/http'
import { readTimer, writeFields, writeSettings, writeTimer } from '@jira-mgr/core/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBackend } from './backend'

const SITE = 'https://team.atlassian.net'
const KEY = 'PSAPAC-12'
const OTHER = 'PSAPAC-13'
const START = '2026-10-10T01:00:00.000Z'
const HOUR = 3_600_000

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-desktop-timer-'))
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

const doc = (text: string): AdfDoc => ({
  version: 1,
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const rawIssue = (key: string, typeName: string) => ({
  id: '1',
  key,
  fields: {
    summary: 'An issue',
    issuetype: {
      id: '1',
      name: typeName,
      subtask: false,
      hierarchyLevel: typeName === 'Epic' ? 1 : 0,
    },
    status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
    labels: [],
    created: '2026-10-01T00:00:00.000Z',
    updated: '2026-10-01T00:00:00.000Z',
  },
})

const rawWorklog = (timeSpent: string) => ({
  id: '9',
  author: { accountId: 'u1', displayName: 'Me' },
  timeSpent,
  timeSpentSeconds: 3600,
  started: START,
  created: START,
  updated: START,
})

interface Request {
  method: string
  path: string
  body: unknown
}

/** Answers issue reads as `type` and worklog writes as logged, or refuses the worklog with `refuse`. */
function fakeJira({ type = 'Story', refuse = false } = {}) {
  const requests: Request[] = []
  const http: HttpClient = {
    request(method, path, init) {
      requests.push({ method, path, body: init?.body })
      const issue = /\/issue\/(PSAPAC-\d+)(?:\?|$)/.exec(path)
      if (method === 'GET' && issue?.[1] !== undefined) {
        return Promise.resolve(rawIssue(issue[1], type))
      }
      if (method === 'POST' && path.includes('/worklog')) {
        if (refuse) return Promise.reject(new Error('Jira said no'))
        const sent = (init?.body as { timeSpent: string } | undefined)?.timeSpent ?? ''
        return Promise.resolve(rawWorklog(sent))
      }
      return Promise.reject(new Error(`unexpected ${method} ${path}`))
    },
  }
  return { http, requests }
}

/** A backend whose clock reads `hours` after the timer started. */
const at = (http: HttpClient, hours: number) =>
  createBackend({ http, now: () => Date.parse(START) + hours * HOUR })

const runningSince = (issueKey: string) =>
  writeTimer({ issueKey, segments: [{ start: START, end: null }] })

const worklogPosts = (requests: Request[]) => requests.filter((r) => r.method === 'POST')

describe('getTimer', () => {
  it('reads the shared timer file and the timer settings', async () => {
    const { http } = fakeJira()
    const backend = at(http, 0)
    expect(await backend.getTimer()).toEqual({
      timer: null,
      settings: { rounding: '5m', reminderThresholdHours: 8, reminderIntervalMinutes: 60 },
    })
    await runningSince(KEY)
    expect((await backend.getTimer()).timer?.issueKey).toBe(KEY)
  })
})

describe('startTimer', () => {
  it('reads the issue for its type, then starts the timer at the clock', async () => {
    const { http, requests } = fakeJira()
    const outcome = await at(http, 0).startTimer({ key: KEY })
    expect(outcome.snapshot.timer).toEqual({
      issueKey: KEY,
      segments: [{ start: START, end: null }],
    })
    expect(await readTimer()).toEqual(outcome.snapshot.timer)
    expect(requests.map((r) => r.method)).toEqual(['GET'])
  })

  it('refuses an Epic, and leaves no timer', async () => {
    const { http } = fakeJira({ type: 'Epic' })
    await expect(at(http, 0).startTimer({ key: KEY })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    expect(await readTimer()).toBeNull()
  })

  it('refuses an issue of another project before any request', async () => {
    const { http, requests } = fakeJira()
    await expect(at(http, 0).startTimer({ key: 'OTHER-1' })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    expect(requests).toEqual([])
  })

  it('refuses to start over a timer on another issue', async () => {
    const { http } = fakeJira()
    await runningSince(OTHER)
    await expect(at(http, 1).startTimer({ key: KEY })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { runningIssueKey: OTHER },
    })
    expect((await readTimer())?.issueKey).toBe(OTHER)
  })
})

describe('stopTimer', () => {
  it('logs the rounded time from the first start, with the comment, and clears the timer', async () => {
    const { http, requests } = fakeJira()
    await runningSince(KEY)
    const outcome = await at(http, 1).stopTimer({ expectRunning: KEY, comment: doc('Done') })
    expect(outcome.logged?.timeSpent).toBe('1h')
    expect(outcome.stopped).toMatchObject({ issueKey: KEY, timeSpent: '1h', started: START })
    expect(outcome.snapshot.timer).toBeNull()
    expect(worklogPosts(requests)).toMatchObject([
      {
        path: `/rest/api/3/issue/${KEY}/worklog?adjustEstimate=auto`,
        body: { timeSpent: '1h', started: '2026-10-10T01:00:00.000+0000' },
      },
    ])
  })

  it('logs the time the user chose instead', async () => {
    const { http, requests } = fakeJira()
    await runningSince(KEY)
    await at(http, 1).stopTimer({ expectRunning: KEY, timeSpent: '45m' })
    expect(worklogPosts(requests)).toMatchObject([{ body: { timeSpent: '45m' } }])
  })

  it('refuses a timer past the threshold until it is confirmed or adjusted', async () => {
    const { http, requests } = fakeJira()
    await runningSince(KEY)
    await expect(at(http, 9).stopTimer({ expectRunning: KEY })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    expect(worklogPosts(requests)).toEqual([])
    expect(await readTimer()).not.toBeNull()
    const outcome = await at(http, 9).stopTimer({ expectRunning: KEY, confirm: true })
    expect(outcome.logged?.timeSpent).toBe('9h')
    expect(await readTimer()).toBeNull()
  })

  it('drops the time with discard and logs nothing', async () => {
    const { http, requests } = fakeJira()
    await runningSince(KEY)
    const outcome = await at(http, 1).stopTimer({ expectRunning: KEY, discard: true })
    expect(outcome).toMatchObject({ logged: null, stopped: { timeSpent: '1h' } })
    expect(outcome.snapshot.timer).toBeNull()
    expect(requests).toEqual([])
  })

  it('refuses a timer the user was not shown, whether it logs or discards', async () => {
    const { http, requests } = fakeJira()
    await runningSince(OTHER)
    for (const discard of [false, true]) {
      await expect(at(http, 1).stopTimer({ expectRunning: KEY, discard })).rejects.toMatchObject({
        code: 'validation_failed',
      })
    }
    expect((await readTimer())?.issueKey).toBe(OTHER)
    expect(requests).toEqual([])
  })

  it('puts the timer back paused when Jira refuses the worklog', async () => {
    const { http } = fakeJira({ refuse: true })
    await runningSince(KEY)
    await expect(at(http, 1).stopTimer({ expectRunning: KEY })).rejects.toMatchObject({
      message: expect.stringContaining('The timer is paused') as string,
    })
    const timer = await readTimer()
    expect(timer?.segments.at(-1)?.end).not.toBeNull()
  })

  it('stops nothing when no timer runs', async () => {
    const { http } = fakeJira()
    const outcome = await at(http, 1).stopTimer({ expectRunning: KEY })
    expect(outcome).toMatchObject({ stopped: null, logged: null })
  })
})

describe('switchTimer', () => {
  it('logs the running timer, then starts the new one', async () => {
    const { http, requests } = fakeJira()
    await runningSince(OTHER)
    const outcome = await at(http, 1).switchTimer({ key: KEY, expectRunning: OTHER })
    expect(outcome.logged?.timeSpent).toBe('1h')
    expect(outcome.stopped?.issueKey).toBe(OTHER)
    expect(outcome.snapshot.timer).toEqual({
      issueKey: KEY,
      segments: [{ start: '2026-10-10T02:00:00.000Z', end: null }],
    })
    expect(requests.find((r) => r.method === 'POST')?.path).toContain(`/issue/${OTHER}/worklog`)
  })

  it('drops the running timer with discard, and starts the new one', async () => {
    const { http, requests } = fakeJira()
    await runningSince(OTHER)
    const outcome = await at(http, 1).switchTimer({ key: KEY, expectRunning: OTHER, discard: true })
    expect(outcome).toMatchObject({ logged: null, stopped: { issueKey: OTHER } })
    expect(outcome.snapshot.timer?.issueKey).toBe(KEY)
    expect(worklogPosts(requests)).toEqual([])
  })

  it('keeps the running timer when the new issue is an Epic', async () => {
    const { http } = fakeJira({ type: 'Epic' })
    await runningSince(OTHER)
    await expect(at(http, 1).switchTimer({ key: KEY, expectRunning: OTHER })).rejects.toMatchObject(
      {
        code: 'validation_failed',
      },
    )
    expect((await readTimer())?.issueKey).toBe(OTHER)
  })

  it('keeps the old timer, paused, and starts nothing when the worklog fails', async () => {
    const { http } = fakeJira({ refuse: true })
    await runningSince(OTHER)
    await expect(at(http, 1).switchTimer({ key: KEY, expectRunning: OTHER })).rejects.toThrow()
    const timer = await readTimer()
    expect(timer?.issueKey).toBe(OTHER)
    expect(timer?.segments.at(-1)?.end).not.toBeNull()
  })
})
