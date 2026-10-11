import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import {
  failure,
  JIRA_SITE,
  loadFixture,
  noContent,
  serveRecorded,
  usePsapacState,
  type Recorded,
} from '../test/msw.js'
import { createHttpClient } from './http.js'
import { getSprint, listSprintIssues, listSprints, readSprint } from './sprints.js'

const client = createHttpClient({
  credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: 'a@b.co', token: 'x' }),
  sleep: () => Promise.resolve(),
})

usePsapacState()

interface RawIssue {
  key: string
  fields: { status: { statusCategory: { key: string } } }
}

/** The 20 recorded issues: 8 To Do, 2 In Progress and 10 Done. */
const recordedIssues = (): RawIssue[] => [
  ...(loadFixture('search-unresolved-1') as unknown as { issues: RawIssue[] }).issues,
  ...(loadFixture('search-done-1') as unknown as { issues: RawIssue[] }).issues,
]

const ACTIVE = {
  id: 10170,
  name: 'PS Sprint 36 (05 Oct-18 Oct)',
  state: 'active',
  startDate: '2026-10-05T23:32:56.296Z',
  endDate: '2026-10-18T14:00:00.000Z',
  goal: 'Ship the onboarding flow',
  originBoardId: 1706,
}

/** Answers the sprint, and its issues `perPage` at a time as the agile endpoint does. */
function serveSprint(issues: RawIssue[], perPage = 7): Recorded[] {
  return serveRecorded(({ path }) => {
    const url = new URL(path, JIRA_SITE)
    if (!url.pathname.endsWith('/issue')) return HttpResponse.json(ACTIVE)
    const startAt = Number(url.searchParams.get('startAt'))
    return HttpResponse.json({
      startAt,
      maxResults: perPage,
      total: issues.length,
      issues: issues.slice(startAt, startAt + perPage),
    })
  })
}

describe('getSprint', () => {
  it('reads one sprint with its goal', async () => {
    const requests = serveSprint([])
    expect(await getSprint(client, 10170)).toEqual({
      id: 10170,
      name: 'PS Sprint 36 (05 Oct-18 Oct)',
      state: 'active',
      startDate: '2026-10-05T23:32:56.296Z',
      endDate: '2026-10-18T14:00:00.000Z',
      goal: 'Ship the onboarding flow',
    })
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /rest/agile/1.0/sprint/10170',
    ])
  })

  it('reads an empty goal and missing dates as null', async () => {
    serveRecorded(() => HttpResponse.json({ id: 7, name: 'Plan', state: 'future', goal: '' }))
    expect(await getSprint(client, 7)).toEqual({
      id: 7,
      name: 'Plan',
      state: 'future',
      startDate: null,
      endDate: null,
      goal: null,
    })
  })

  it('is the sprint `listSprints` gives for the same id, so `jm sprint list` shows it too', async () => {
    const page = loadFixture('board-sprints-active-future') as unknown as {
      values: { id: number; goal?: string }[]
    }
    serveRecorded(({ path }) =>
      path.startsWith('/rest/agile/1.0/board/')
        ? HttpResponse.json(page)
        : HttpResponse.json(page.values.find((s) => s.id === 10170)),
    )
    const listed = (await listSprints(client, 1706)).find((s) => s.state === 'active')
    expect(listed?.id).toBe(10170)
    const { goal, ...detail } = await getSprint(client, 10170)
    expect(goal).toBe(page.values.find((s) => s.id === 10170)?.goal)
    expect(goal).toContain('BHP')
    expect(listed).not.toHaveProperty('goal')
    expect(detail).toEqual(listed)
  })

  it('answers not_found for an unknown sprint, and refuses a bad id before any request', async () => {
    serveRecorded(() =>
      HttpResponse.json({ errorMessages: ['Sprint does not exist.'], errors: {} }, { status: 404 }),
    )
    expect((await failure(getSprint(client, 99))).code).toBe('not_found')
    const requests = serveRecorded(noContent)
    for (const id of [0, -1, 1.5, Number.NaN, '5/../x' as never]) {
      expect((await failure(getSprint(client, id))).code).toBe('validation_failed')
    }
    expect(requests).toEqual([])
  })
})

describe('listSprintIssues', () => {
  it('reads every page, asking for the fields Issue needs by their resolved ids', async () => {
    const requests = serveSprint(recordedIssues(), 7)
    const issues = await listSprintIssues(client, 10170)
    expect(issues).toHaveLength(20)
    expect(new Set(issues.map((i) => i.key)).size).toBe(20)
    expect(requests.map((r) => new URL(r.path, JIRA_SITE).searchParams.get('startAt'))).toEqual([
      '0',
      '7',
      '14',
    ])
    const first = new URL(requests[0]?.path ?? '', JIRA_SITE)
    expect(first.pathname).toBe('/rest/agile/1.0/sprint/10170/issue')
    expect(first.searchParams.get('fields')?.split(',')).toEqual(
      expect.arrayContaining(['summary', 'status', 'customfield_14849', 'customfield_10600']),
    )
    expect(requests.every((r) => r.method === 'GET')).toBe(true)
  })

  it('reads an empty sprint as no issues', async () => {
    serveSprint([])
    expect(await listSprintIssues(client, 10170)).toEqual([])
  })

  it('names the path without its query when a page is malformed', async () => {
    serveRecorded(() => HttpResponse.json({ total: 1, issues: [{ key: 'PSAPAC-1' }] }))
    const error = await failure(listSprintIssues(client, 10170))
    expect(error.code).toBe('jira_error')
    expect(error.message).toContain('/rest/agile/1.0/sprint/10170/issue.')
    expect(error.message).not.toContain('fields=')
  })

  it('refuses a bad sprint id before any request', async () => {
    const requests = serveRecorded(noContent)
    for (const id of [0, 1.5, '5&x=1' as never]) {
      expect((await failure(listSprintIssues(client, id))).code).toBe('validation_failed')
    }
    expect(requests).toEqual([])
  })
})

describe('readSprint', () => {
  it('counts exactly the issues the sprint holds, by status category', async () => {
    serveSprint(recordedIssues(), 7)
    const { sprint, issues, stats } = await readSprint(client, 10170)
    expect(sprint.name).toBe('PS Sprint 36 (05 Oct-18 Oct)')
    expect(stats.scope).toBe(issues.length)
    expect(stats.scope).toBe(20)
    expect(stats.started).toBe(2)
    expect(stats.completed).toBe(10)
    // Every single-valued breakdown covers each issue once, so its groups add up to the scope.
    for (const groups of [stats.assignees, stats.priorities, stats.customers, stats.engagements]) {
      expect(groups.reduce((sum, g) => sum + g.total, 0)).toBe(stats.scope)
    }
  })

  it('reads an empty sprint as zero counts', async () => {
    serveSprint([])
    const { issues, stats } = await readSprint(client, 10170)
    expect(issues).toEqual([])
    expect(stats).toMatchObject({ scope: 0, started: 0, completed: 0, assignees: [], labels: [] })
  })
})
