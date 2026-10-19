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

interface IssuesPage {
  startAt: number
  total: number
  issues: { key: string }[]
}

/** The active sprint as PSAPAC sent it, and its 60 issues in the two pages Jira served. */
const sprintFixture = () => loadFixture('sprint-psapac-10170') as unknown as { goal: string }
const issuePages = () =>
  [
    loadFixture('sprint-issues-psapac-10170'),
    loadFixture('sprint-issues-psapac-10170-2'),
  ] as unknown as IssuesPage[]

/** Answers the sprint, and its issues page by page as the recorded pages came: 50, then 10. */
function serveSprint(pages: IssuesPage[] = issuePages()): Recorded[] {
  return serveRecorded(({ path }) => {
    const url = new URL(path, JIRA_SITE)
    if (!url.pathname.endsWith('/issue')) return HttpResponse.json(sprintFixture())
    const startAt = Number(url.searchParams.get('startAt'))
    const page = pages.find((p) => p.startAt === startAt)
    return HttpResponse.json(page ?? { ...pages[0], startAt, issues: [] })
  })
}

/** The sprint with no issues. */
const emptySprint = (): IssuesPage[] => [{ startAt: 0, total: 0, issues: [] }]

describe('getSprint', () => {
  it('reads one sprint with its goal', async () => {
    const requests = serveSprint()
    expect(await getSprint(client, 10170)).toEqual({
      id: 10170,
      name: 'PS Sprint 36 (05 Oct-18 Oct)',
      state: 'active',
      startDate: '2026-10-05T23:32:56.296Z',
      endDate: '2026-10-18T14:00:00.000Z',
      goal: sprintFixture().goal,
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
  it('reads both recorded pages, asking for the fields Issue needs by their resolved ids', async () => {
    const requests = serveSprint()
    const issues = await listSprintIssues(client, 10170)
    expect(issues).toHaveLength(60)
    expect(new Set(issues.map((i) => i.key)).size).toBe(60)
    expect(requests.map((r) => new URL(r.path, JIRA_SITE).searchParams.get('startAt'))).toEqual([
      '0',
      '50',
    ])
    const first = new URL(requests[0]?.path ?? '', JIRA_SITE)
    expect(first.pathname).toBe('/rest/agile/1.0/sprint/10170/issue')
    expect(first.searchParams.get('fields')?.split(',')).toEqual(
      expect.arrayContaining(['summary', 'status', 'customfield_14849', 'customfield_10600']),
    )
    expect(requests.every((r) => r.method === 'GET')).toBe(true)
  })

  it('asks for the comment field only when told to', async () => {
    const without = serveSprint()
    await listSprintIssues(client, 10170)
    const fieldsOf = (request?: { path: string }) =>
      new URL(request?.path ?? '', JIRA_SITE).searchParams.get('fields')?.split(',') ?? []
    expect(fieldsOf(without[0])).not.toContain('comment')

    const withComments = serveSprint()
    await listSprintIssues(client, 10170, { comments: true })
    expect(fieldsOf(withComments[0])).toContain('comment')
  })

  it('reads an empty sprint as no issues', async () => {
    serveSprint(emptySprint())
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
    serveSprint()
    const { sprint, issues, stats } = await readSprint(client, 10170)
    expect(sprint.name).toBe('PS Sprint 36 (05 Oct-18 Oct)')
    expect(stats.scope).toBe(issues.length)
    expect(stats.scope).toBe(60)
    // Recorded: 23 To Do or Hold, 30 In Progress or Review, 7 Done.
    expect(stats.started).toBe(30)
    expect(stats.completed).toBe(7)
    // Every single-valued breakdown covers each issue once, so its groups add up to the scope.
    for (const groups of [stats.assignees, stats.priorities, stats.customers, stats.engagements]) {
      expect(groups.reduce((sum, g) => sum + g.total, 0)).toBe(stats.scope)
    }
    expect(stats.assignees[0]).toMatchObject({ name: 'John Shea', total: 22 })
  })

  it('reads an empty sprint as zero counts', async () => {
    serveSprint(emptySprint())
    const { issues, stats } = await readSprint(client, 10170)
    expect(issues).toEqual([])
    expect(stats).toMatchObject({ scope: 0, started: 0, completed: 0, assignees: [], labels: [] })
  })
})
