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
import { getFieldOptions, searchAssignableUsers, suggestLabels } from './lookups.js'

const client = createHttpClient({
  credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: 'a@b.co', token: 'x' }),
  sleep: () => Promise.resolve(),
})

usePsapacState()

describe('suggestLabels', () => {
  it('returns the recorded suggestions as plain label text', async () => {
    const requests = serveRecorded(() => HttpResponse.json(loadFixture('label-suggestions')))
    const labels = await suggestLabels(client, 'cu')
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /rest/api/3/jql/autocompletedata/suggestions?fieldName=labels&fieldValue=cu',
    ])
    expect(labels).toHaveLength(15)
    expect(labels.slice(0, 2)).toEqual(['CU:Allowance', 'CU:Auditability'])
  })

  it('encodes spaces and special characters in the prefix', async () => {
    const requests = serveRecorded(() => HttpResponse.json({ results: [] }))
    await suggestLabels(client, 'a b&c=d#e+f%g/é')
    const sent = new URL(requests[0]?.path ?? '', JIRA_SITE).searchParams
    expect(requests[0]?.path).toBe(
      '/rest/api/3/jql/autocompletedata/suggestions?fieldName=labels&fieldValue=a%20b%26c%3Dd%23e%2Bf%25g%2F%C3%A9',
    )
    expect(sent.get('fieldValue')).toBe('a b&c=d#e+f%g/é')
    expect([...sent.keys()]).toEqual(['fieldName', 'fieldValue'])
  })

  it('sends a prefix that holds ".." or a backslash', async () => {
    const requests = serveRecorded(() => HttpResponse.json({ results: [] }))
    await suggestLabels(client, 'a..b\\c')
    expect(requests.map((r) => r.path)).toEqual([
      '/rest/api/3/jql/autocompletedata/suggestions?fieldName=labels&fieldValue=a..b%5Cc',
    ])
  })

  it('refuses an overlong prefix before any request', async () => {
    const requests = serveRecorded(noContent)
    expect((await failure(suggestLabels(client, 'x'.repeat(201)))).code).toBe('validation_failed')
    expect(requests).toEqual([])
  })
})

describe('searchAssignableUsers', () => {
  it('maps the recorded users to account id, name and avatar', async () => {
    const requests = serveRecorded(() => HttpResponse.json(loadFixture('assignable-users')))
    const users = await searchAssignableUsers(client, 'sh')
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /rest/api/3/user/assignable/search?project=PSAPAC&query=sh&maxResults=50',
    ])
    expect(users).toHaveLength(36)
    expect(users[0]).toEqual({
      accountId: '712020:16f8dbe7-f120-4043-bcaf-e06ef7156d34',
      displayName: 'Shane Dolley',
      avatarUrl:
        'https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/712020:16f8dbe7-f120-4043-bcaf-e06ef7156d34/6ab8151a-c741-4f8b-9869-4671e4d38fce/48',
    })
    expect(Object.keys(users[0] ?? {})).not.toContain('emailAddress')
  })

  it('drops inactive users and tolerates a missing avatar', async () => {
    serveRecorded(() =>
      HttpResponse.json([
        { accountId: 'a', displayName: 'Active', active: true },
        { accountId: 'b', displayName: 'Gone', active: false },
      ]),
    )
    expect(await searchAssignableUsers(client, '')).toEqual([
      { accountId: 'a', displayName: 'Active', avatarUrl: null },
    ])
  })

  it('encodes the query and takes another project', async () => {
    const requests = serveRecorded(() => HttpResponse.json([]))
    await searchAssignableUsers(client, "o'brien & co é", { projectKey: 'KOT' })
    expect(requests[0]?.path).toBe(
      '/rest/api/3/user/assignable/search?project=KOT&query=o%27brien%20%26%20co%20%C3%A9&maxResults=50',
    )
  })

  it('sends a query that holds ".."', async () => {
    const requests = serveRecorded(() => HttpResponse.json([]))
    await searchAssignableUsers(client, 'j..smith')
    expect(requests[0]?.path).toBe(
      '/rest/api/3/user/assignable/search?project=PSAPAC&query=j..smith&maxResults=50',
    )
  })

  it('refuses a project key that could alter the query, sending nothing', async () => {
    const requests = serveRecorded(noContent)
    expect((await failure(searchAssignableUsers(client, 'a', { projectKey: 'A&x=1' }))).code).toBe(
      'validation_failed',
    )
    expect(requests).toEqual([])
  })
})

describe('getFieldOptions', () => {
  /** Serves the recorded createmeta, and the statuses fixture. */
  function serveMeta(): Recorded[] {
    const types = loadFixture('createmeta-issuetypes') as { issueTypes: { id: string }[] }
    const byType = new Map(
      [
        ['11500', 'task'],
        ['11501', 'bug'],
        ['11502', 'story'],
        ['11503', 'epic'],
        ['11504', 'subtask'],
      ].map(([id, name]) => [`/rest/api/3/issue/createmeta/PSAPAC/issuetypes/${id ?? ''}`, name]),
    )
    return serveRecorded(({ path }) => {
      const pathname = path.split('?')[0] ?? ''
      if (pathname === '/rest/api/3/issue/createmeta/PSAPAC/issuetypes') {
        return HttpResponse.json({ ...types, total: types.issueTypes.length })
      }
      if (pathname === '/rest/api/3/project/PSAPAC/statuses') {
        return HttpResponse.json(loadFixture('project-statuses'))
      }
      const name = byType.get(pathname)
      const fixture = name === undefined ? undefined : (loadFixture(`createmeta-${name}`) as object)
      return fixture === undefined
        ? HttpResponse.json({}, { status: 404 })
        : HttpResponse.json({ ...fixture, total: (fixture as { fields: unknown[] }).fields.length })
    })
  }

  it('lists the 42 Customer options from the create metadata', async () => {
    const requests = serveMeta()
    const options = await getFieldOptions(client, 'customer')
    expect(options).toHaveLength(42)
    expect(options[0]).toEqual({ id: '25068', name: 'ACU' })
    expect(requests.map((r) => r.path)).toEqual([
      '/rest/api/3/issue/createmeta/PSAPAC/issuetypes?startAt=0&maxResults=50',
      '/rest/api/3/issue/createmeta/PSAPAC/issuetypes/11500?startAt=0&maxResults=50',
    ])
  })

  it('lists the 21 Engagement options', async () => {
    serveMeta()
    const options = await getFieldOptions(client, 'engagement')
    expect(options).toHaveLength(21)
    expect(options[0]).toEqual({ id: '16450', name: 'AI Governance' })
  })

  it("lists the project's 11 priorities, not the site's 20", async () => {
    serveMeta()
    const options = await getFieldOptions(client, 'priority')
    expect(options).toHaveLength(11)
    expect(options).toContainEqual({ id: '1', name: 'Blocker' })
  })

  it('lists the issue types', async () => {
    serveMeta()
    const options = await getFieldOptions(client, 'issueType')
    expect(options.map((o) => o.name).sort()).toEqual(['Bug', 'Epic', 'Story', 'Subtask', 'Task'])
  })

  it('lists each status once across the issue types', async () => {
    const requests = serveMeta()
    const options = await getFieldOptions(client, 'status')
    expect(requests.map((r) => r.path)).toEqual(['/rest/api/3/project/PSAPAC/statuses'])
    expect(options.map((o) => o.name).sort()).toEqual([
      'Done',
      'Hold',
      'In Progress',
      'Opportunity',
      'Review',
      'To Do',
    ])
  })

  it('fails with validation_failed when no issue type lists the field', async () => {
    serveRecorded(({ path }) =>
      path.includes('/issuetypes/')
        ? HttpResponse.json({ total: 0, fields: [] })
        : HttpResponse.json({ total: 1, issueTypes: [{ id: '11500', name: 'Task' }] }),
    )
    expect((await failure(getFieldOptions(client, 'customer'))).code).toBe('validation_failed')
  })

  it('refuses an unknown field before any request', async () => {
    const requests = serveRecorded(noContent)
    expect((await failure(getFieldOptions(client, 'assignee' as never))).code).toBe(
      'validation_failed',
    )
    expect(requests).toEqual([])
  })
})

describe('responses', () => {
  it.each([
    ['labels', () => suggestLabels(client, 'a')],
    ['users', () => searchAssignableUsers(client, 'a')],
    ['statuses', () => getFieldOptions(client, 'status')],
  ])('throws jira_error for a malformed %s response', async (_name, run) => {
    serveRecorded(() => HttpResponse.json({ surprise: true }))
    expect((await failure(run())).code).toBe('jira_error')
  })
})
