import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JIRA_SITE, loadFixture, server } from '../test/msw.js'
import { JiraMgrError } from './errors.js'
import { createHttpClient } from './http.js'
import {
  getIssue,
  searchIssuePages,
  searchIssues,
  searchText,
  TEXT_QUERY_MAX,
  type SearchPage,
} from './search.js'
import { writeFields, writeSettings } from './state.js'

const IDS = {
  customer: 'customfield_14849',
  engagement: 'customfield_14850',
  sprint: 'customfield_10600',
  startDate: 'customfield_13808',
  timeRemaining: 'customfield_21785',
}

const client = createHttpClient({
  credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: 'a@b.co', token: 'x' }),
})

interface SearchBody {
  jql: string
  fields: string[]
  maxResults: number
  nextPageToken?: string
}

interface Page {
  issues: { key: string; fields: Record<string, unknown> }[]
  nextPageToken?: string
  isLast: boolean
}

const MAX_REQUESTS = 8

const recorded = (name: string) => loadFixture(name) as unknown as Page

/**
 * Serves the recorded pages and returns the request bodies. The recording has no last page, so
 * the second page of each phase is served as the last: the token dropped and `isLast` set.
 */
function serveSearch(): SearchBody[] {
  const requests: SearchBody[] = []
  server.use(
    http.post(`${JIRA_SITE}/rest/api/3/search/jql`, async ({ request }) => {
      const body = (await request.json()) as SearchBody
      requests.push(body)
      // A loop that ignores the token would never end, so fail it instead.
      if (requests.length > MAX_REQUESTS) {
        return tooMany()
      }
      const phase = body.jql.includes('!= Done') ? 'unresolved' : 'done'
      const first = recorded(`search-${phase}-1`)
      if (body.nextPageToken === undefined) return HttpResponse.json(first)
      if (body.nextPageToken !== first.nextPageToken) {
        return HttpResponse.json({ errorMessages: ['Unknown token.'] }, { status: 400 })
      }
      return HttpResponse.json({ issues: recorded(`search-${phase}-2`).issues, isLast: true })
    }),
  )
  return requests
}

/** Answers every search with `body`, and fails after `MAX_REQUESTS` so a loop ends. */
function serveRaw(body: unknown): SearchBody[] {
  const requests: SearchBody[] = []
  server.use(
    http.post(`${JIRA_SITE}/rest/api/3/search/jql`, async ({ request }) => {
      requests.push((await request.json()) as SearchBody)
      if (requests.length > MAX_REQUESTS) return tooMany()
      return HttpResponse.json(body as Record<string, unknown>)
    }),
  )
  return requests
}

const tooMany = () => HttpResponse.json({ errorMessages: ['Paging did not end.'] }, { status: 400 })

async function collect(pages: AsyncGenerator<SearchPage>): Promise<SearchPage[]> {
  const all: SearchPage[] = []
  for await (const page of pages) all.push(page)
  return all
}

async function failure(promise: Promise<unknown>): Promise<JiraMgrError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(JiraMgrError)
  return error as JiraMgrError
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-search-'))
  process.env.JM_STATE_DIR = dir
  await writeSettings({ siteUrl: JIRA_SITE, projectKey: 'PSAPAC' })
  await writeFields({
    site: JIRA_SITE,
    project: 'PSAPAC',
    resolvedAt: '2026-10-07T00:00:00.000Z',
    ids: IDS,
  })
})

afterEach(async () => {
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

describe('searchIssues', () => {
  it('maps a recorded issue with Customer, Engagement, Sprint, parent and estimates', async () => {
    serveSearch()
    const issues = await searchIssues(client)
    const issue = issues.find((i) => i.key === 'PSAPAC-3117')

    expect(issue).toEqual({
      id: '1449958',
      key: 'PSAPAC-3117',
      summary: expect.any(String) as string,
      issueType: { id: '11502', name: 'Story', subtask: false, hierarchyLevel: 0 },
      status: { id: '11822', name: 'To Do', category: 'new' },
      resolution: null,
      parentKey: 'PSAPAC-3116',
      assignee: {
        accountId: '712020:16f8dbe7-f120-4043-bcaf-e06ef7156d34',
        displayName: 'Shane Dolley',
        avatarUrl: expect.stringContaining('/48') as string,
      },
      creator: null,
      labels: ['PSAPAC'],
      links: [],
      priority: { id: '4', name: 'Minor' },
      customer: { id: '16451', value: 'Collibra (Internal team)' },
      engagement: { id: '22264', value: 'Non Collibra Engagement' },
      sprints: [
        {
          id: 10170,
          name: 'PS Sprint 36 (05 Oct-18 Oct)',
          state: 'active',
          endDate: '2026-10-18T14:00:00.000Z',
        },
      ],
      startDate: '2026-10-05',
      dueDate: '2026-10-18',
      originalEstimateSeconds: 28800,
      remainingEstimateSeconds: 22200,
      timeSpentSeconds: 6600,
      timeRemainingHours: null,
      created: '2026-10-06T00:49:43.825Z',
      updated: '2026-10-06T01:56:17.325Z',
    })
  })

  it('requests and maps the Creator and the links, with the status category of each linked issue', async () => {
    const requests = serveSearch()
    await searchIssues(client)
    expect(requests[0]?.fields).toEqual(expect.arrayContaining(['creator', 'issuelinks']))

    const raw = recorded('search-unresolved-1').issues.find((i) => i.key === 'PSAPAC-3117')
    if (raw === undefined) throw new Error('PSAPAC-3117 is missing from the fixture.')
    const issue = structuredClone(raw)
    const end = (key: string, category?: string) => ({
      key,
      fields: category === undefined ? {} : { status: { statusCategory: { key: category } } },
    })
    Object.assign(issue.fields, {
      creator: { accountId: 'acc-1', displayName: 'Ada', emailAddress: 'ada@example.com' },
      issuelinks: [
        { type: { name: 'Blocks' }, inwardIssue: end('PSAPAC-1', 'indeterminate') },
        { type: { name: 'Blocks' }, outwardIssue: end('PSAPAC-2', 'done') },
        { type: { name: 'Relates' }, outwardIssue: end('PSAPAC-3') },
        { type: { name: 'Blocks' }, outwardIssue: end('PSAPAC-4', 'surprise') },
        { type: { name: 'Blocks' } },
      ],
    })
    serveRaw({ issues: [issue], isLast: true })

    const [mapped] = await searchIssues(client)

    expect(mapped?.creator).toEqual({ accountId: 'acc-1', displayName: 'Ada' })
    expect(mapped?.links).toEqual([
      { type: 'Blocks', direction: 'inward', key: 'PSAPAC-1', category: 'indeterminate' },
      { type: 'Blocks', direction: 'outward', key: 'PSAPAC-2', category: 'done' },
      { type: 'Relates', direction: 'outward', key: 'PSAPAC-3', category: 'undefined' },
      { type: 'Blocks', direction: 'outward', key: 'PSAPAC-4', category: 'undefined' },
    ])
  })

  it('reads a malformed creator as none, and still maps the page', async () => {
    const raw = recorded('search-unresolved-1').issues.find((i) => i.key === 'PSAPAC-3117')
    if (raw === undefined) throw new Error('PSAPAC-3117 is missing from the fixture.')
    const issue = structuredClone(raw)
    Object.assign(issue.fields, { creator: { accountId: 5, displayName: null } })
    serveRaw({ issues: [issue], isLast: true })

    const [mapped] = await searchIssues(client)

    expect(mapped).toMatchObject({ key: 'PSAPAC-3117', creator: null })
  })

  describe('commentCount', () => {
    /** An issue of the recording with `comment` set to what Jira sends: the bodies and the total. */
    async function mapWith(comment: unknown) {
      const raw = recorded('search-unresolved-1').issues.find((i) => i.key === 'PSAPAC-3117')
      if (raw === undefined) throw new Error('PSAPAC-3117 is missing from the fixture.')
      const issue = structuredClone(raw)
      if (comment !== undefined) Object.assign(issue.fields, { comment })
      serveRaw({ issues: [issue], isLast: true })
      const [mapped] = await searchIssues(client, { comments: true })
      return mapped
    }

    it('keeps the total of the comment field and drops the bodies', async () => {
      const mapped = await mapWith({
        comments: [{ id: '1', body: { type: 'doc', version: 1, content: [] } }],
        self: 'https://example.invalid/comment',
        maxResults: 1,
        total: 120,
        startAt: 0,
      })

      expect(mapped?.commentCount).toBe(120)
      expect(mapped).not.toHaveProperty('comment')
    })

    it('reads a total of 0 as 0', async () => {
      expect((await mapWith({ comments: [], total: 0 }))?.commentCount).toBe(0)
    })

    it('leaves the count out when Jira sent no comment field, as every recording before it', async () => {
      const mapped = await mapWith(undefined)
      expect(mapped).toMatchObject({ key: 'PSAPAC-3117' })
      expect(mapped).not.toHaveProperty('commentCount')
    })

    it('leaves the count out for junk and still maps the page', async () => {
      for (const junk of [null, 'many', { total: 'many' }, { total: -1 }, { total: 1.5 }, []]) {
        const mapped = await mapWith(junk)
        expect(mapped).toMatchObject({ key: 'PSAPAC-3117' })
        expect(mapped).not.toHaveProperty('commentCount')
      }
    })

    it('asks Jira for the comment field only when told to', async () => {
      const without = serveSearch()
      await searchIssues(client, { pageSize: 10 })
      expect(without[0]?.fields).not.toContain('comment')

      const withComments = serveSearch()
      await searchIssues(client, { pageSize: 10, comments: true })
      expect(withComments[0]?.fields).toContain('comment')
      expect(withComments[0]?.fields.filter((f) => f !== 'comment')).toEqual(without[0]?.fields)
    })
  })

  it('maps an Epic with no parent, no sprint and no estimate to nulls and an empty list', async () => {
    serveSearch()
    const epic = (await searchIssues(client)).find((i) => i.key === 'PSAPAC-3116')

    expect(epic).toMatchObject({
      issueType: { name: 'Epic' },
      parentKey: null,
      sprints: [],
      originalEstimateSeconds: null,
      remainingEstimateSeconds: null,
      timeSpentSeconds: null,
    })
  })

  it.each([null, []])(
    'maps an issue with no assignee, Customer, Engagement, sprint (%j) or timetracking to nulls',
    async (sprint) => {
      const raw = recorded('search-unresolved-1').issues.find((i) => i.key === 'PSAPAC-3117')
      if (raw === undefined) throw new Error('PSAPAC-3117 is missing from the fixture.')
      const issue = structuredClone(raw)
      Object.assign(issue.fields, {
        assignee: null,
        [IDS.customer]: null,
        [IDS.engagement]: null,
        [IDS.sprint]: sprint,
      })
      delete issue.fields.timetracking
      serveRaw({ issues: [issue], isLast: true })

      const [mapped] = await searchIssues(client)

      expect(mapped).toMatchObject({
        key: 'PSAPAC-3117',
        assignee: null,
        customer: null,
        engagement: null,
        sprints: [],
        originalEstimateSeconds: null,
        remainingEstimateSeconds: null,
        timeSpentSeconds: null,
      })
    },
  )

  it.each([undefined, null])('reads a sprint whose endDate is %j as null', async (endDate) => {
    const raw = recorded('search-unresolved-1').issues.find((i) => i.key === 'PSAPAC-3117')
    if (raw === undefined) throw new Error('PSAPAC-3117 is missing from the fixture.')
    const issue = structuredClone(raw)
    Object.assign(issue.fields, {
      [IDS.sprint]: [{ id: 1, name: 'Sprint 1', state: 'future', endDate }],
    })
    serveRaw({ issues: [issue], isLast: true })

    const [mapped] = await searchIssues(client)

    expect(mapped?.sprints).toEqual([{ id: 1, name: 'Sprint 1', state: 'future', endDate: null }])
  })

  it('maps a Done issue with its resolution and a Subtask with its hierarchy level', async () => {
    serveSearch()
    const issues = await searchIssues(client)

    expect(issues.find((i) => i.key === 'PSAPAC-3103')).toMatchObject({
      resolution: 'Done',
      status: { name: 'Done', category: 'done' },
    })
    expect(issues.find((i) => i.key === 'PSAPAC-3122')).toMatchObject({
      issueType: { name: 'Subtask', subtask: true, hierarchyLevel: -1 },
      timeRemainingHours: -1,
    })
  })

  it('asks only for the needed fields, by the resolved custom field ids, and no description', async () => {
    const requests = serveSearch()
    await searchIssues(client, { pageSize: 10 })

    const body = requests[0]
    expect(body?.maxResults).toBe(10)
    expect(body?.fields).toEqual(
      expect.arrayContaining([...Object.values(IDS), 'summary', 'timetracking', 'parent']),
    )
    expect(body?.fields).not.toContain('description')
    expect(body?.fields).not.toContain('comment')
    expect(body?.jql).toBe('project = "PSAPAC" AND statusCategory != Done ORDER BY key DESC')
  })

  it('follows nextPageToken until isLast', async () => {
    const requests = serveSearch()
    const issues = await searchIssues(client)

    // Two pages in each phase: the second request of a phase carries the first page's token.
    expect(requests.map((r) => r.nextPageToken)).toEqual([
      undefined,
      recorded('search-unresolved-1').nextPageToken,
      undefined,
      recorded('search-done-1').nextPageToken,
    ])
    expect(issues).toHaveLength(40)
  })

  it('loads every unresolved issue before the first Done issue', async () => {
    const requests = serveSearch()
    const pages = await collect(searchIssuePages(client))

    expect(pages.map((p) => p.phase)).toEqual(['unresolved', 'unresolved', 'done', 'done'])
    expect(requests.map((r) => r.jql.includes('!= Done'))).toEqual([true, true, false, false])
    expect(requests[2]?.jql).toBe('project = "PSAPAC" AND statusCategory = Done ORDER BY key DESC')
    for (const page of pages) {
      for (const issue of page.issues) {
        expect(issue.status.category === 'done').toBe(page.phase === 'done')
      }
    }
  })

  it('reports a running count that rises across pages and phases, with no total', async () => {
    serveSearch()
    const pages = await collect(searchIssuePages(client))

    expect(pages.map((p) => p.loaded)).toEqual([10, 20, 30, 40])
    expect(pages.every((p) => !('total' in p))).toBe(true)
  })

  it('stops paging when the signal aborts', async () => {
    const requests = serveSearch()
    const controller = new AbortController()
    const reason = new Error('stop')
    const pages = searchIssuePages(client, { signal: controller.signal })

    await pages.next()
    controller.abort(reason)

    await expect(pages.next()).rejects.toBe(reason)
    expect(requests).toHaveLength(1)
  })

  it('fails with jira_error when an issue lacks its summary', async () => {
    serveRaw({ issues: [{ id: '1', key: 'PSAPAC-1', fields: { labels: [] } }], isLast: true })

    const error = await failure(searchIssues(client))
    expect(error.code).toBe('jira_error')
  })

  it('fails with jira_error when Jira has more pages but sends no token', async () => {
    const requests = serveRaw({ issues: [], isLast: false })

    const error = await failure(searchIssues(client))
    expect(error.code).toBe('jira_error')
    expect(requests).toHaveLength(1)
  })

  it('fails with jira_error when Jira repeats a page token', async () => {
    const requests = serveRaw({ issues: [], nextPageToken: 'same', isLast: false })

    const error = await failure(searchIssues(client))
    expect(error.code).toBe('jira_error')
    expect(requests).toHaveLength(2)
  })

  it('escapes a backslash and a quote in the project key', async () => {
    const key = 'A"B\\C'
    await writeSettings({ siteUrl: JIRA_SITE, projectKey: key })
    await writeFields({
      site: JIRA_SITE,
      project: key,
      resolvedAt: '2026-10-07T00:00:00.000Z',
      ids: IDS,
    })
    const requests = serveSearch()

    await searchIssues(client)

    expect(requests[0]?.jql).toBe(
      'project = "A\\"B\\\\C" AND statusCategory != Done ORDER BY key DESC',
    )
  })

  it('skips a phase left out of `phases` without sending a request for it', async () => {
    const requests = serveSearch()
    const issues = await searchIssues(client, { phases: ['unresolved'] })
    expect(issues).toHaveLength(20)
    expect(requests).toHaveLength(2)
    expect(requests.every((r) => r.jql.includes('!= Done'))).toBe(true)

    const done = serveSearch()
    await searchIssues(client, { phases: ['done'] })
    expect(done.every((r) => r.jql.includes('= Done') && !r.jql.includes('!='))).toBe(true)
    expect(done).toHaveLength(2)
  })

  it('fails with permission_denied when settings hold no project', async () => {
    await writeSettings({ siteUrl: JIRA_SITE })
    const requests = serveSearch()

    const error = await failure(searchIssues(client))
    expect(error.code).toBe('permission_denied')
    expect(requests).toHaveLength(0)
  })
})

describe('getIssue', () => {
  const serveIssue = (body: unknown = loadFixture('issue-psapac-3066'), status = 200) => {
    const paths: string[] = []
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/issue/:key`, ({ request }) => {
        const url = new URL(request.url)
        paths.push(`${url.pathname}${url.search}`)
        return HttpResponse.json(body as Record<string, unknown>, { status })
      }),
    )
    return paths
  }

  it('reads one issue with its description and subtasks from a recorded response', async () => {
    const paths = serveIssue()
    const issue = await getIssue(client, 'PSAPAC-3066')

    expect(paths).toHaveLength(1)
    expect(paths[0]).toMatch(/^\/rest\/api\/3\/issue\/PSAPAC-3066\?fields=summary,/)
    expect(paths[0]).toContain(',customfield_14849,')
    // A single read always asks for the comment count.
    expect(paths[0]).toMatch(/,comment,description,subtasks$/)
    expect(issue).toMatchObject({
      key: 'PSAPAC-3066',
      summary: expect.any(String) as string,
      status: { name: 'Done', category: 'done' },
      customer: { id: '16120', value: 'BHP' },
      parentKey: 'PSAPAC-2832',
      subtasks: [{ key: 'PSAPAC-3122', summary: 'test', status: 'To Do', done: false }],
    })
    expect(issue.description).toMatchObject({ type: 'doc', version: 1 })
    expect(JSON.stringify(issue.description)).toContain('Done when both forums have run.')
  })

  it('marks a subtask done by its status category, and not done when the category is missing', async () => {
    const recorded = loadFixture('issue-psapac-3066') as {
      fields: { subtasks: { key: string; fields: { status: Record<string, unknown> } }[] }
    }
    const [first] = recorded.fields.subtasks
    if (first === undefined) throw new Error('The fixture has no subtask.')
    const withStatus = (key: string, status: Record<string, unknown>) => ({
      ...first,
      key,
      fields: { ...first.fields, status },
    })
    const named = { name: 'Done' }
    serveIssue({
      ...recorded,
      fields: {
        ...recorded.fields,
        subtasks: [
          withStatus('PSAPAC-1', { ...named, statusCategory: { key: 'done' } }),
          withStatus('PSAPAC-2', { name: 'In Progress', statusCategory: { key: 'indeterminate' } }),
          withStatus('PSAPAC-3', named),
        ],
      },
    })
    const { subtasks } = await getIssue(client, 'PSAPAC-3066')
    expect(subtasks.map(({ key, done }) => [key, done])).toEqual([
      ['PSAPAC-1', true],
      ['PSAPAC-2', false],
      ['PSAPAC-3', false],
    ])
  })

  it('returns a null description and no subtasks when the issue has none', async () => {
    const recorded = loadFixture('issue-psapac-3066') as { fields: Record<string, unknown> }
    serveIssue({ ...recorded, fields: { ...recorded.fields, description: null, subtasks: [] } })
    expect(await getIssue(client, 'PSAPAC-3066')).toMatchObject({ description: null, subtasks: [] })
  })

  it('returns a null description when the description key is absent', async () => {
    const recorded = loadFixture('issue-psapac-3066') as { fields: Record<string, unknown> }
    const fields = Object.fromEntries(
      Object.entries(recorded.fields).filter(([key]) => key !== 'description'),
    )
    serveIssue({ ...recorded, fields })
    const issue = await getIssue(client, 'PSAPAC-3066')
    expect(issue.description).toBeNull()
    expect(Object.hasOwn(issue, 'description')).toBe(true)
  })

  it('reads the total of the comment field the read asked for, and leaves the bodies out', async () => {
    const recorded = loadFixture('issue-psapac-3066') as { fields: Record<string, unknown> }
    const comment = {
      comments: [{ id: '1', body: 'x' }],
      self: 'x',
      maxResults: 1,
      total: 3,
      startAt: 0,
    }
    serveIssue({ ...recorded, fields: { ...recorded.fields, comment } })
    const issue = await getIssue(client, 'PSAPAC-3066')
    expect(issue.commentCount).toBe(3)
    expect(issue).not.toHaveProperty('comment')
  })

  it('leaves the comment count out when the recorded response holds no comment field', async () => {
    serveIssue()
    expect(await getIssue(client, 'PSAPAC-3066')).not.toHaveProperty('commentCount')
  })

  it('maps an unknown issue to not_found', async () => {
    serveIssue({ errorMessages: ['Issue does not exist or you do not have permission.'] }, 404)
    expect((await failure(getIssue(client, 'PSAPAC-99999'))).code).toBe('not_found')
  })

  it('refuses a malformed key before any request', async () => {
    const paths = serveIssue()
    expect((await failure(getIssue(client, 'PSAPAC-1/../x'))).code).toBe('validation_failed')
    expect(paths).toEqual([])
  })

  it('throws jira_error when the description is not an ADF document', async () => {
    const recorded = loadFixture('issue-psapac-3066') as { fields: Record<string, unknown> }
    serveIssue({ ...recorded, fields: { ...recorded.fields, description: 'plain text' } })
    expect((await failure(getIssue(client, 'PSAPAC-3066'))).code).toBe('jira_error')
  })
})

describe('searchText', () => {
  it('scopes `text ~` to the project, asks for one page and maps the issues', async () => {
    const requests = serveRaw({ issues: recorded('search-unresolved-1').issues, isLast: true })
    const issues = await searchText(client, 'rollout plan')

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      jql: 'project = "PSAPAC" AND text ~ "rollout plan" ORDER BY updated DESC',
      maxResults: 50,
    })
    expect(requests[0]?.nextPageToken).toBeUndefined()
    expect(requests[0]?.fields).toContain(IDS.customer)
    expect(issues.map((i) => i.key)).toContain('PSAPAC-3117')
  })

  it.each([
    [
      'a quote and a backslash',
      String.raw`say "hi" \ now`,
      String.raw`text ~ "say \\\"hi\\\" \\\\ now"`,
    ],
    ['Lucene operators', 'a+b*c?', String.raw`text ~ "a\\+b\\*c\\?"`],
    ['a JQL clause', '" OR project = X', String.raw`text ~ "\\\" OR project = X"`],
  ])('escapes %s, so the text cannot change the query', async (_name, input, clause) => {
    const requests = serveRaw({ issues: [], isLast: true })
    await searchText(client, input)
    expect(requests[0]?.jql).toBe(`project = "PSAPAC" AND ${clause} ORDER BY updated DESC`)
  })

  it.each([
    ['a tab', 'a\tb'],
    ['a NUL', 'a\u0000b'],
    ['a newline', 'a\nb'],
    ['a DEL', 'a\u007fb'],
  ])('turns %s into a space, which Jira would refuse in the string', async (_name, input) => {
    const requests = serveRaw({ issues: [], isLast: true })
    await searchText(client, input)
    expect(requests[0]?.jql).toBe('project = "PSAPAC" AND text ~ "a b" ORDER BY updated DESC')
  })

  it.each([
    ['empty', ''],
    ['only control characters', '\t\u0000\n'],
    ['blank', '   '],
    ['over-long', 'x'.repeat(TEXT_QUERY_MAX + 1)],
  ])('refuses %s text before any request', async (_name, input) => {
    const requests = serveRaw({ issues: [], isLast: true })
    expect((await failure(searchText(client, input))).code).toBe('validation_failed')
    expect(requests).toEqual([])
  })

  it('passes the abort signal to the request', async () => {
    serveRaw({ issues: [], isLast: true })
    const controller = new AbortController()
    controller.abort()
    await expect(searchText(client, 'late', { signal: controller.signal })).rejects.toThrow()
  })

  it('throws jira_error when Jira sends an unexpected response', async () => {
    serveRaw({ nothing: true })
    expect((await failure(searchText(client, 'x'))).code).toBe('jira_error')
  })
})
