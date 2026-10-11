import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { failure, JIRA_SITE, loadFixture, server, usePsapacState } from '../test/msw.js'
import { createHttpClient } from './http.js'
import { createInboxCache, inboxJql, listInbox, type InboxEntry, type InboxState } from './inbox.js'

usePsapacState()

const client = createHttpClient({
  credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: 'a@b.co', token: 'x' }),
  sleep: () => Promise.resolve(),
})

const NEVER = '1970-01-01T00:00:00.000Z'
/** Shane Dolley, the account `myself.json` records. */
const ME = '712020:16f8dbe7-f120-4043-bcaf-e06ef7156d34'

const inbox = (allReadAt: string, reads: Record<string, string> = {}): InboxState => ({
  version: 1,
  allReadAt,
  reads,
})

interface Served {
  searches: { jql: string; nextPageToken?: string }[]
  /** Each changelog and comment path asked for, with its query. */
  reads: string[]
}

type Json = Record<string, unknown>

/** The changelogs and newest comments recorded from PSAPAC. */
const RECORDED = new Set([
  'changelog-psapac-3116',
  'changelog-psapac-2477',
  'changelog-psapac-3134',
  'changelog-psapac-3139',
  'comments-newest-psapac-2477',
  'comments-newest-psapac-3067',
])

/**
 * Answers the Inbox's calls from the recorded fixtures: `inbox-search` as the one page, the
 * changelogs and newest comments that were recorded, and for any other issue an empty changelog
 * and no comment. `override` replaces what one path answers.
 */
function serve(override: (path: string) => Json | Response | undefined = () => undefined): Served {
  const served: Served = { searches: [], reads: [] }
  server.use(
    http.post(`${JIRA_SITE}/rest/api/3/search/jql`, async ({ request }) => {
      served.searches.push((await request.json()) as Served['searches'][number])
      return HttpResponse.json({ ...(loadFixture('inbox-search') as Json), isLast: true })
    }),
    http.get(`${JIRA_SITE}/rest/api/3/myself`, () => HttpResponse.json(loadFixture('myself'))),
    http.get(`${JIRA_SITE}/rest/api/3/issue/:key/:what`, ({ request, params }) => {
      const { pathname, search } = new URL(request.url)
      served.reads.push(`${pathname}${search}`)
      const replaced = override(`${pathname}${search}`)
      if (replaced instanceof Response) return replaced
      if (replaced !== undefined) return HttpResponse.json(replaced)
      const fixture = `${params.what === 'changelog' ? 'changelog' : 'comments-newest'}-${(params.key as string).toLowerCase()}`
      if (RECORDED.has(fixture)) return HttpResponse.json(loadFixture(fixture))
      return HttpResponse.json(
        params.what === 'changelog'
          ? { startAt: 0, maxResults: 100, total: 0, isLast: true, values: [] }
          : { startAt: 0, maxResults: 1, total: 0, comments: [] },
      )
    }),
  )
  return served
}

const entry = (entries: InboxEntry[], key: string) => {
  const found = entries.find((e) => e.issue.key === key)
  if (found === undefined) throw new Error(`${key} is not in the Inbox.`)
  return found
}

/** The moment the recorded issues were last read: two days after the newest of them changed. */
const NOW = new Date('2026-10-11T00:00:00.000Z')

const list = (state: InboxState, cache = createInboxCache(), now = NOW) =>
  listInbox(client, { inbox: state, cache, now })

describe('listInbox', () => {
  it('searches the project for issues the user is assigned to, reported or watches', async () => {
    const served = serve()
    const entries = await list(inbox('2026-10-11T00:00:00.000Z'))

    expect(served.searches).toHaveLength(1)
    expect(served.searches[0]?.jql).toBe(
      'project = "PSAPAC" AND (assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= -14d ORDER BY updated DESC',
    )
    expect(served.searches[0]?.jql).toBe(inboxJql('PSAPAC'))
    // The recording holds eight issues, newest first, and every one is read at this watermark.
    expect(entries.map((e) => e.issue.key)).toEqual([
      'PSAPAC-3139',
      'PSAPAC-3116',
      'PSAPAC-3117',
      'PSAPAC-3134',
      'PSAPAC-2477',
      'PSAPAC-3067',
      'PSAPAC-3068',
      'PSAPAC-3124',
    ])
    expect(entries.every((e) => !e.unread && e.change === null)).toBe(true)
    // A read issue costs no changelog read.
    expect(served.reads).toEqual([])
  })

  it('names the newest change by someone else from the changelog', async () => {
    serve()
    const entries = await list(inbox('2026-10-08T00:00:00.000Z'))

    // The recording: Automation for Jira set three fields last, after Shane's parent change.
    expect(entry(entries, 'PSAPAC-3139')).toMatchObject({
      unread: true,
      change: {
        by: 'Automation for Jira',
        summary: 'Time remaining (h): set to 0',
        at: '2026-10-10T08:59:53.900Z',
      },
    })
    expect(entry(entries, 'PSAPAC-3134').change).toMatchObject({
      by: 'Automation for Jira',
      at: '2026-10-08T23:43:30.408Z',
    })
  })

  it("counts an issue as read when every change since the mark is the user's own", async () => {
    serve()
    const entries = await list(inbox('2026-10-08T00:00:00.000Z'))

    // PSAPAC-3116's two newest histories are Shane's status changes, and the user is Shane.
    expect(entry(entries, 'PSAPAC-3116')).toMatchObject({ unread: false, change: null })
    expect(ME).toBe((loadFixture('myself') as { accountId: string }).accountId)
  })

  it('does not count a change made before the mark', async () => {
    serve()
    const entries = await list(inbox('2026-10-10T08:59:53.900Z'))
    // The mark is the history's own time, so 3139's automation change no longer counts.
    expect(entry(entries, 'PSAPAC-3139')).toMatchObject({ unread: false, change: null })
  })

  it('names the newest comment when the changelog holds no change by someone else', async () => {
    const served = serve()
    // PSAPAC-2477's last history is 2026-10-05; John Shea commented on 2026-10-08.
    const entries = await list(inbox('2026-10-07T00:00:00.000Z'))

    expect(entry(entries, 'PSAPAC-2477')).toMatchObject({
      unread: true,
      change: { by: 'John Shea', summary: 'Comment by John Shea', at: '2026-10-08T03:58:59.724Z' },
    })
    expect(served.reads).toContain(
      '/rest/api/3/issue/PSAPAC-2477/comment?orderBy=-created&maxResults=1',
    )
  })

  it('prefers the changelog to a comment, and reads no comment then', async () => {
    const served = serve()
    const entries = await list(inbox('2026-10-04T00:00:00.000Z'))

    // Sharon Warner's two changes on 2026-10-05 are histories; the comment would be John Shea's.
    expect(entry(entries, 'PSAPAC-2477').change).toMatchObject({ by: 'Sharon Warner' })
    expect(served.reads.filter((p) => p.includes('/PSAPAC-2477/comment'))).toEqual([])
  })

  it('counts an issue read when nothing by someone else follows the mark', async () => {
    serve()
    // PSAPAC-3067 has no comment and an empty changelog here: its update is not attributable.
    const entries = await list(inbox('2026-10-06T00:00:00.000Z'))
    expect(entry(entries, 'PSAPAC-3067')).toMatchObject({ unread: false, change: null })
  })

  it('ignores a comment by the user and a comment older than the mark', async () => {
    serve((path) => {
      if (!path.includes('/PSAPAC-2477/comment')) return undefined
      const comment = (loadFixture('comments-newest-psapac-2477') as { comments: Json[] })
        .comments[0]
      const shane = { accountId: ME, displayName: 'Shane Dolley' }
      return {
        comments: [{ ...comment, author: shane, updateAuthor: shane }],
      }
    })
    const mine = await list(inbox('2026-10-07T00:00:00.000Z'))
    expect(entry(mine, 'PSAPAC-2477')).toMatchObject({ unread: false, change: null })

    serve()
    const old = await list(inbox('2026-10-08T03:58:59.724Z'))
    expect(entry(old, 'PSAPAC-2477')).toMatchObject({ unread: false, change: null })
  })

  it('ignores a change from before the Inbox window, whatever the read mark says', async () => {
    serve()
    // 2026-10-30 less 14 days is 2026-10-16, after the last change recorded on PSAPAC-2477.
    const entries = await list(
      inbox(NEVER),
      createInboxCache(),
      new Date('2026-10-30T00:00:00.000Z'),
    )

    expect(entry(entries, 'PSAPAC-2477')).toMatchObject({ unread: false, change: null })
    expect(entry(entries, 'PSAPAC-3139')).toMatchObject({ unread: false, change: null })
  })

  it('reads nothing for an issue whose own mark is its updated time', async () => {
    const served = serve()
    const entries = await list(
      inbox('2026-10-10T00:00:00.000Z', { 'PSAPAC-3139': '2026-10-10T09:01:06.795Z' }),
    )

    expect(entry(entries, 'PSAPAC-3139').unread).toBe(false)
    expect(served.reads.filter((p) => p.includes('PSAPAC-3139'))).toEqual([])
    // Its siblings, marked by the watermark only, are read from the changelog.
    expect(served.reads.filter((p) => p.includes('PSAPAC-3117/changelog'))).toHaveLength(1)
  })

  it('shows every issue in the window as unread when no file exists', async () => {
    serve((path) =>
      // Only the shape matters: a change by someone else on every issue.
      path.includes('/changelog')
        ? {
            startAt: 0,
            maxResults: 100,
            total: 1,
            values: [
              {
                created: '2026-10-09T00:00:00.000+0000',
                author: { accountId: 'other', displayName: 'Ben Carey' },
                items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }],
              },
            ],
          }
        : undefined,
    )
    const entries = await list(inbox(NEVER))
    expect(entries.filter((e) => e.unread)).toHaveLength(8)
    expect(entry(entries, 'PSAPAC-3139').change?.summary).toBe('Status: To Do to In Progress')
  })

  it('keeps what it read while an issue is unchanged, and reads again when it changes', async () => {
    const served = serve()
    const cache = createInboxCache()
    const state = inbox('2026-10-08T00:00:00.000Z')
    await list(state, cache)
    const first = served.reads.length
    expect(first).toBeGreaterThan(0)
    expect(served.searches).toHaveLength(1)

    await list(state, cache)
    expect(served.searches).toHaveLength(2)
    expect(served.reads).toHaveLength(first)
  })

  it('does not keep a failed read', async () => {
    let fail = true
    serve((path) => {
      if (path.includes('/PSAPAC-3139/changelog') && fail) {
        return HttpResponse.json({ errorMessages: ['Gone.'] }, { status: 404 })
      }
      return undefined
    })
    const cache = createInboxCache()
    const state = inbox('2026-10-10T00:00:00.000Z')

    expect((await failure(list(state, cache))).code).toBe('not_found')
    fail = false
    expect(entry(await list(state, cache), 'PSAPAC-3139').unread).toBe(true)
  })

  it('reads the last page of a long changelog', async () => {
    const histories = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => ({
        created: `2026-10-09T00:${String(Math.floor((from + i) / 60)).padStart(2, '0')}:${String((from + i) % 60).padStart(2, '0')}.000+0000`,
        author: { accountId: 'other', displayName: `Writer ${String(from + i)}` },
        items: [{ field: 'labels', fromString: '', toString: String(from + i) }],
      }))
    const served = serve((path) => {
      if (!path.includes('/PSAPAC-3139/changelog')) return undefined
      const start = Number(new URL(`${JIRA_SITE}${path}`).searchParams.get('startAt'))
      return {
        startAt: start,
        maxResults: 100,
        total: 250,
        values: histories(start, Math.min(250, start + 100)),
      }
    })
    const entries = await list(inbox('2026-10-08T00:00:00.000Z'))

    expect(served.reads.filter((p) => p.includes('/PSAPAC-3139/changelog'))).toEqual([
      '/rest/api/3/issue/PSAPAC-3139/changelog?startAt=0&maxResults=100',
      '/rest/api/3/issue/PSAPAC-3139/changelog?startAt=150&maxResults=100',
    ])
    expect(entry(entries, 'PSAPAC-3139').change?.by).toBe('Writer 249')
  })

  it('writes what the change was in words', async () => {
    const change = (items: Json[]) => ({
      startAt: 0,
      maxResults: 100,
      total: 1,
      values: [
        {
          created: '2026-10-10T09:00:00.000+0000',
          author: { accountId: 'other', displayName: 'Ben Carey' },
          items,
        },
      ],
    })
    const summarise = async (items: Json[]) => {
      serve((path) => (path.includes('/PSAPAC-3139/changelog') ? change(items) : undefined))
      const entries = await list(inbox('2026-10-10T00:00:00.000Z'))
      return entry(entries, 'PSAPAC-3139').change?.summary
    }
    const long = 'x'.repeat(60)

    expect(
      await summarise([{ field: 'status', fromString: 'To Do', toString: 'In Progress' }]),
    ).toBe('Status: To Do to In Progress')
    expect(
      await summarise([{ field: 'assignee', fromString: null, toString: 'Shane Dolley' }]),
    ).toBe('Assignee: set to Shane Dolley')
    expect(
      await summarise([{ field: 'assignee', fromString: 'Shane Dolley', toString: null }]),
    ).toBe('Assignee: Shane Dolley cleared')
    expect(await summarise([{ field: 'description', fromString: 'a', toString: 'b' }])).toBe(
      'Description changed',
    )
    expect(await summarise([{ field: 'IssueParentAssociation', toString: 'PSAPAC-3116' }])).toBe(
      'Parent: set to PSAPAC-3116',
    )
    expect(await summarise([{ field: 'summary', fromString: long, toString: 'new' }])).toBe(
      `Summary: ${'x'.repeat(40)}... to new`,
    )
    expect(
      await summarise([
        { field: 'status', fromString: 'To Do', toString: 'Done' },
        { field: 'resolution', fromString: null, toString: 'Done' },
      ]),
    ).toBe('Status: To Do to Done and 1 more')
  })

  it('pages through a search that spans pages', async () => {
    const page = loadFixture('inbox-search') as { issues: Json[] }
    const served: string[] = []
    server.use(
      http.post(`${JIRA_SITE}/rest/api/3/search/jql`, async ({ request }) => {
        const { nextPageToken } = (await request.json()) as { nextPageToken?: string }
        served.push(nextPageToken ?? 'first')
        return nextPageToken === undefined
          ? HttpResponse.json({
              issues: page.issues.slice(0, 3),
              nextPageToken: 't2',
              isLast: false,
            })
          : HttpResponse.json({ issues: page.issues.slice(3), isLast: true })
      }),
    )
    const entries = await list(inbox('2026-10-11T00:00:00.000Z'))
    expect(served).toEqual(['first', 't2'])
    expect(entries).toHaveLength(8)
  })
})
