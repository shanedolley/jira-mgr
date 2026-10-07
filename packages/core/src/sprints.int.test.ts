import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import {
  failure,
  JIRA_SITE,
  loadFixture,
  noContent,
  serveRecorded,
  usePsapacState,
} from '../test/msw.js'
import { createHttpClient } from './http.js'
import { findBoard, listSprints, moveToBacklog, moveToSprint } from './sprints.js'

const client = createHttpClient({
  credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: 'a@b.co', token: 'x' }),
  sleep: () => Promise.resolve(),
})

usePsapacState()

interface Page {
  total: number
  values: unknown[]
}
const fixture = (name: string) => loadFixture(name) as unknown as Page

describe('findBoard', () => {
  it("finds the project's board from settings", async () => {
    const requests = serveRecorded(() => HttpResponse.json(fixture('board-psapac')))
    expect(await findBoard(client)).toEqual({
      id: 1706,
      name: 'PSAPAC All Delivery board',
      type: 'simple',
    })
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /rest/agile/1.0/board?projectKeyOrId=PSAPAC',
    ])
  })

  it('prefers a board that supports sprints over a Kanban board listed first', async () => {
    serveRecorded(() =>
      HttpResponse.json({
        values: [
          { id: 1, name: 'Flow', type: 'kanban' },
          { id: 2, name: 'Plan', type: 'scrum' },
          { id: 3, name: 'Simple', type: 'simple' },
        ],
      }),
    )
    expect(await findBoard(client)).toEqual({ id: 2, name: 'Plan', type: 'scrum' })
  })

  it('returns null when the only board is Kanban', async () => {
    serveRecorded(() => HttpResponse.json({ values: [{ id: 1, name: 'Flow', type: 'kanban' }] }))
    expect(await findBoard(client)).toBeNull()
  })

  it('takes another project key, and returns null when it has no board', async () => {
    const requests = serveRecorded(() => HttpResponse.json({ values: [] }))
    expect(await findBoard(client, 'KOT')).toBeNull()
    expect(requests[0]?.path).toBe('/rest/agile/1.0/board?projectKeyOrId=KOT')
  })

  it('refuses a project key that could alter the path, sending nothing', async () => {
    const requests = serveRecorded(noContent)
    expect((await failure(findBoard(client, 'A&x=1'))).code).toBe('validation_failed')
    expect((await failure(findBoard(client, '../x'))).code).toBe('validation_failed')
    expect(requests).toEqual([])
  })
})

describe('listSprints', () => {
  it('lists active and future sprints with their dates, paging until the total', async () => {
    const page = fixture('board-sprints-active-future')
    const requests = serveRecorded(({ path }) => {
      const startAt = Number(new URL(path, JIRA_SITE).searchParams.get('startAt'))
      return HttpResponse.json({
        ...page,
        values: startAt === 0 ? page.values : page.values.slice(0, 20),
      })
    })
    const sprints = await listSprints(client, 1706)
    expect(requests.map((r) => r.path)).toEqual([
      '/rest/agile/1.0/board/1706/sprint?state=active,future&startAt=0&maxResults=50',
      '/rest/agile/1.0/board/1706/sprint?state=active,future&startAt=50&maxResults=50',
    ])
    expect(sprints).toHaveLength(70)
    expect(sprints[0]).toEqual({
      id: 10170,
      name: 'PS Sprint 36 (05 Oct-18 Oct)',
      state: 'active',
      startDate: '2026-10-05T23:32:56.296Z',
      endDate: '2026-10-18T14:00:00.000Z',
    })
    expect(sprints[1]?.state).toBe('future')
  })

  it('maps an undated sprint to null dates', async () => {
    serveRecorded(() => HttpResponse.json(fixture('board-sprints-active-future')))
    const sprints = await listSprints(client, 1706)
    expect(sprints.find((s) => s.name === 'PS TEMPLATES')).toMatchObject({
      startDate: null,
      endDate: null,
    })
  })

  it('lists every sprint, closed ones too, when asked', async () => {
    const requests = serveRecorded(() =>
      HttpResponse.json({ ...fixture('board-sprints-all'), total: 50 }),
    )
    const sprints = await listSprints(client, 1706, { all: true })
    expect(requests.map((r) => r.path)).toEqual([
      '/rest/agile/1.0/board/1706/sprint?startAt=0&maxResults=50',
    ])
    expect(new Set(sprints.map((s) => s.state))).toEqual(new Set(['active', 'future', 'closed']))
  })

  it('refuses a bad board id before any request', async () => {
    const requests = serveRecorded(noContent)
    for (const id of [0, -1, 1.5, Number.NaN, '1706/../x' as never]) {
      expect((await failure(listSprints(client, id))).code).toBe('validation_failed')
    }
    expect(requests).toEqual([])
  })
})

describe('malformed sprint pages', () => {
  it('names the path without its query string in the error', async () => {
    serveRecorded(() => HttpResponse.json({ surprise: true }))
    const error = await failure(listSprints(client, 1706))
    expect(error.code).toBe('jira_error')
    expect(error.message).toContain('/rest/agile/1.0/board/1706/sprint.')
    expect(error.message).not.toContain('state=')
    expect(error.message).not.toContain('startAt')
  })
})

describe('sprint moves', () => {
  it('moves issues into a sprint', async () => {
    const requests = serveRecorded(noContent)
    await moveToSprint(client, 10171, ['PSAPAC-1', 'PSAPAC-2'])
    expect(requests).toMatchObject([
      {
        method: 'POST',
        path: '/rest/agile/1.0/sprint/10171/issue',
        body: { issues: ['PSAPAC-1', 'PSAPAC-2'] },
      },
    ])
  })

  it('moves issues out to the backlog', async () => {
    const requests = serveRecorded(noContent)
    await moveToBacklog(client, ['PSAPAC-1'])
    expect(requests).toMatchObject([
      { method: 'POST', path: '/rest/agile/1.0/backlog/issue', body: { issues: ['PSAPAC-1'] } },
    ])
  })

  it('refuses bad ids and keys, none, and more than 50, before any request', async () => {
    const requests = serveRecorded(noContent)
    const fifty = Array.from({ length: 51 }, (_, i) => `PSAPAC-${String(i + 1)}`)
    const refusals = [
      moveToSprint(client, 0, ['PSAPAC-1']),
      moveToSprint(client, 1.5, ['PSAPAC-1']),
      moveToSprint(client, 10171, []),
      moveToSprint(client, 10171, ['nope']),
      moveToSprint(client, 10171, fifty),
      moveToBacklog(client, []),
      moveToBacklog(client, ['PSAPAC-1', '../x']),
      moveToBacklog(client, fifty),
    ]
    for (const refusal of refusals) expect((await failure(refusal)).code).toBe('validation_failed')
    expect(requests).toEqual([])
  })

  it("maps Jira's 403 to permission_denied", async () => {
    serveRecorded(() =>
      HttpResponse.json({ errorMessages: ['No permission.'], errors: {} }, { status: 403 }),
    )
    expect((await failure(moveToSprint(client, 10171, ['PSAPAC-1']))).code).toBe(
      'permission_denied',
    )
  })
})
