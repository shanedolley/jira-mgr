import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JiraMgrError } from '@jira-mgr/core'
import type { HttpClient } from '@jira-mgr/core/http'
import { writeFields, writeSettings } from '@jira-mgr/core/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBackend, type ProgressSender } from './backend'

const SITE = 'https://team.atlassian.net'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-desktop-page-'))
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

/** Records every request and answers each with `respond`, so a test sees what would be sent. */
function routedHttp(respond: (request: Request) => unknown = () => undefined) {
  const requests: Request[] = []
  const http: HttpClient = {
    request(method, path, options) {
      const request = { method, path, body: options?.body }
      requests.push(request)
      return Promise.resolve(respond(request))
    },
  }
  return { http, requests }
}

const rawIssue = (typeName: string, subtask = false) => ({
  id: '1',
  key: 'PSAPAC-12',
  fields: {
    summary: 'An issue',
    issuetype: { id: '1', name: typeName, subtask, hierarchyLevel: typeName === 'Epic' ? 1 : 0 },
    status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
    labels: [],
    created: '2026-10-01T00:00:00.000Z',
    updated: '2026-10-01T00:00:00.000Z',
  },
})

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  )

describe('editIssue', () => {
  it('sends the given fields in one PUT', async () => {
    const { http, requests } = routedHttp()
    await createBackend({ http }).editIssue({
      key: 'PSAPAC-12',
      changes: { assignee: 'u1', addLabels: ['docs'], dueDate: null },
    })
    expect(requests).toEqual([
      {
        method: 'PUT',
        path: '/rest/api/3/issue/PSAPAC-12',
        body: {
          fields: { assignee: { accountId: 'u1' }, duedate: null },
          update: { labels: [{ add: 'docs' }] },
        },
      },
    ])
  })

  it('refuses an issue of another project before any request is sent', async () => {
    const { http, requests } = routedHttp()
    const error = await failure(
      createBackend({ http }).editIssue({ key: 'OTHER-5', changes: { assignee: null } }),
    )
    expect(error).toMatchObject({ code: 'validation_failed' })
    expect(requests).toEqual([])
  })

  it('refuses a new parent of another project before any request is sent', async () => {
    const { http, requests } = routedHttp()
    const error = await failure(
      createBackend({ http }).editIssue({ key: 'PSAPAC-12', changes: { parentKey: 'OTHER-1' } }),
    )
    expect(error).toMatchObject({ code: 'validation_failed' })
    expect(requests).toEqual([])
  })

  it('reads the issue first and refuses a type change on an Epic', async () => {
    const { http, requests } = routedHttp(() => rawIssue('Epic'))
    const error = await failure(
      createBackend({ http }).editIssue({ key: 'PSAPAC-12', changes: { type: 'Bug' } }),
    )
    expect(error).toBeInstanceOf(JiraMgrError)
    expect(error).toMatchObject({
      code: 'validation_failed',
      message: 'PSAPAC-12 is an Epic. The type can change only among Story, Task and Bug.',
    })
    expect(requests.map((r) => r.method)).toEqual(['GET'])
  })

  it('changes the type of a Story', async () => {
    const { http, requests } = routedHttp(({ method }) =>
      method === 'GET' ? rawIssue('Story') : undefined,
    )
    await createBackend({ http }).editIssue({ key: 'PSAPAC-12', changes: { type: 'Bug' } })
    expect(requests.at(-1)).toMatchObject({
      method: 'PUT',
      body: { fields: { issuetype: { name: 'Bug' } } },
    })
  })
})

describe('transitions and status', () => {
  const transitions = {
    transitions: [
      {
        id: '21',
        name: 'Start',
        to: { id: '2', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      },
      { id: '31', name: 'Finish', to: { id: '3', name: 'Done' } },
    ],
  }

  it('lists the statuses the issue can reach, by target status', async () => {
    const { http } = routedHttp(() => transitions)
    expect(await createBackend({ http }).listTransitions({ key: 'PSAPAC-12' })).toEqual([
      { id: '2', name: 'In Progress', category: 'indeterminate' },
      { id: '3', name: 'Done', category: null },
    ])
  })

  it('lists a status once when two transitions reach it', async () => {
    const { http } = routedHttp(() => ({
      transitions: [
        { id: '21', name: 'Start', to: { id: '2', name: 'In Progress' } },
        { id: '22', name: 'Resume', to: { id: '2', name: 'In Progress' } },
        { id: '31', name: 'Finish', to: { id: '3', name: 'Done' } },
      ],
    }))
    const statuses = await createBackend({ http }).listTransitions({ key: 'PSAPAC-12' })
    expect(statuses.map((s) => s.id)).toEqual(['2', '3'])
  })

  it('moves by the transition that reaches the status id', async () => {
    const { http, requests } = routedHttp(({ method }) =>
      method === 'GET' ? transitions : undefined,
    )
    await createBackend({ http }).setStatus({ key: 'PSAPAC-12', statusId: '3' })
    expect(requests.at(-1)).toEqual({
      method: 'POST',
      path: '/rest/api/3/issue/PSAPAC-12/transitions',
      body: { transition: { id: '31' } },
    })
  })

  it('refuses a status change on an issue of another project with no request', async () => {
    const { http, requests } = routedHttp()
    const error = await failure(
      createBackend({ http }).setStatus({ key: 'OTHER-5', statusId: '3' }),
    )
    expect(error).toMatchObject({ code: 'validation_failed' })
    expect(requests).toEqual([])
  })
})

describe('sprints', () => {
  const boards = { values: [{ id: 7, name: 'Board', type: 'scrum' }] }
  const sprints = {
    total: 1,
    values: [{ id: 5, name: 'Sprint 5', state: 'active', startDate: '2026-10-01T00:00:00.000Z' }],
  }

  it('lists active and future sprints of the board, or all of them', async () => {
    const route = ({ path }: Request) =>
      path.startsWith('/rest/agile/1.0/board?') ? boards : sprints
    const first = routedHttp(route)
    const listed = await createBackend({ http: first.http }).listSprints({ all: false })
    expect(listed).toEqual([
      {
        id: 5,
        name: 'Sprint 5',
        state: 'active',
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: null,
      },
    ])
    expect(first.requests[1]?.path).toContain('/board/7/sprint?state=active,future')

    const second = routedHttp(route)
    await createBackend({ http: second.http }).listSprints({ all: true })
    expect(second.requests[1]?.path).not.toContain('state=')
  })

  it('says so when the project has no board that supports sprints', async () => {
    const { http } = routedHttp(() => ({ values: [] }))
    const error = await failure(createBackend({ http }).listSprints({ all: false }))
    expect(error).toMatchObject({ code: 'not_found' })
  })

  it('reads a sprint with its issues, and counts them, through core', async () => {
    const { http, requests } = routedHttp(({ path }) =>
      path === '/rest/agile/1.0/sprint/5'
        ? { id: 5, name: 'Sprint 5', state: 'active', goal: 'Ship it' }
        : { total: 0, issues: [] },
    )
    const report = await createBackend({ http }).getSprint({ id: 5 })
    expect(report.sprint).toEqual({
      id: 5,
      name: 'Sprint 5',
      state: 'active',
      startDate: null,
      endDate: null,
      goal: 'Ship it',
    })
    expect(report.stats).toMatchObject({ scope: 0, started: 0, completed: 0 })
    expect(requests.map((r) => `${r.method} ${r.path.split('?')[0] ?? ''}`).sort()).toEqual([
      'GET /rest/agile/1.0/sprint/5',
      'GET /rest/agile/1.0/sprint/5/issue',
    ])
  })

  it('moves an issue into a sprint and to the backlog', async () => {
    const { http, requests } = routedHttp()
    const backend = createBackend({ http })
    await backend.setSprint({ key: 'PSAPAC-12', sprintId: 5 })
    await backend.setSprint({ key: 'PSAPAC-12', sprintId: null })
    expect(requests).toEqual([
      { method: 'POST', path: '/rest/agile/1.0/sprint/5/issue', body: { issues: ['PSAPAC-12'] } },
      { method: 'POST', path: '/rest/agile/1.0/backlog/issue', body: { issues: ['PSAPAC-12'] } },
    ])
  })

  it('refuses a sprint move for an issue of another project with no request', async () => {
    const { http, requests } = routedHttp()
    const error = await failure(createBackend({ http }).setSprint({ key: 'OTHER-5', sprintId: 5 }))
    expect(error).toMatchObject({ code: 'validation_failed' })
    expect(requests).toEqual([])
  })
})

describe('the comment count', () => {
  const sprintRoute = ({ path }: Request) =>
    path === '/rest/agile/1.0/sprint/5'
      ? { id: 5, name: 'Sprint 5', state: 'active' }
      : { total: 0, issues: [] }
  const searchRoute = () => ({ issues: [], isLast: true })
  const progress: ProgressSender = {
    sendProgress: () => undefined,
    sendBatchProgress: () => undefined,
    isOpen: () => true,
    sendLateRead: () => undefined,
  }

  const fieldsOfSprint = (requests: Request[]) =>
    new URL(requests.find((r) => r.path.includes('/issue?'))?.path ?? '', SITE).searchParams
      .get('fields')
      ?.split(',') ?? []
  const fieldsOfSearch = (requests: Request[]) => (requests[0]?.body as { fields: string[] }).fields

  it('is left out of the Tree load and the Sprint page read while the Comments property is off', async () => {
    const search = routedHttp(searchRoute)
    await createBackend({ http: search.http }).listIssues(
      { phase: 'unresolved', loadId: 1 },
      progress,
    )
    expect(fieldsOfSearch(search.requests)).not.toContain('comment')

    const sprint = routedHttp(sprintRoute)
    await createBackend({ http: sprint.http }).getSprint({ id: 5 })
    expect(fieldsOfSprint(sprint.requests)).not.toContain('comment')
  })

  it('is asked for by the Tree load and the Sprint page read while the saved display shows it', async () => {
    await writeSettings({
      siteUrl: SITE,
      projectKey: 'PSAPAC',
      email: 'me@example.com',
      display: { properties: ['updated', 'comments'] },
    })
    const search = routedHttp(searchRoute)
    await createBackend({ http: search.http }).listIssues(
      { phase: 'unresolved', loadId: 1 },
      progress,
    )
    expect(fieldsOfSearch(search.requests)).toContain('comment')

    const sprint = routedHttp(sprintRoute)
    await createBackend({ http: sprint.http }).getSprint({ id: 5 })
    expect(fieldsOfSprint(sprint.requests)).toContain('comment')
  })
})

describe('users and options', () => {
  it('searches assignable users of the project and drops inactive ones', async () => {
    const { http, requests } = routedHttp(() => [
      {
        accountId: 'u1',
        displayName: 'Ann Lee',
        active: true,
        avatarUrls: { '48x48': 'https://cdn.example.test/a.png' },
      },
      { accountId: 'u2', displayName: 'Gone', active: false },
    ])
    const users = await createBackend({ http }).searchUsers({ query: 'an' })
    expect(users).toEqual([
      { accountId: 'u1', displayName: 'Ann Lee', avatarUrl: 'https://cdn.example.test/a.png' },
    ])
    expect(requests[0]?.path).toContain('project=PSAPAC&query=an')
  })

  it('reads one issue with its description and subtasks', async () => {
    const { http } = routedHttp(() => ({
      ...rawIssue('Story'),
      fields: { ...rawIssue('Story').fields, subtasks: [] },
    }))
    const issue = await createBackend({ http }).getIssue({ key: 'PSAPAC-12' })
    expect(issue).toMatchObject({ key: 'PSAPAC-12', description: null, subtasks: [] })
  })

  it('lists the priorities from the create metadata', async () => {
    const { http } = routedHttp(({ path }) =>
      path.includes('/issuetypes/')
        ? {
            total: 1,
            fields: [{ key: 'priority', allowedValues: [{ id: '1', name: 'High' }] }],
          }
        : { total: 1, issueTypes: [{ id: '10', name: 'Story' }] },
    )
    expect(await createBackend({ http }).listFieldOptions({ field: 'priority' })).toEqual([
      { id: '1', name: 'High' },
    ])
  })
})
