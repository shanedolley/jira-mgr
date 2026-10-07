import { HttpResponse, type JsonBodyType } from 'msw'
import { describe, expect, it } from 'vitest'

import { failure, JIRA_SITE, loadFixture, noContent, serveRecorded } from '../test/msw.js'
import { markdownToAdf } from './adf.js'
import {
  addAttachment,
  addComment,
  addLink,
  addWorklog,
  deleteComment,
  deleteWorklog,
  editComment,
  editWorklog,
  listAttachments,
  listComments,
  listLinks,
  listLinkTypes,
  listWorklogs,
  removeAttachment,
  removeLink,
  type AddLinkInput,
} from './extras.js'
import { createHttpClient } from './http.js'

const client = createHttpClient({
  credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: 'a@b.co', token: 'x' }),
  sleep: () => Promise.resolve(),
})

const body = markdownToAdf('Checked **twice**.')
const fixture = (name: string) => loadFixture(name) as Record<string, unknown>
const first = (name: string, list: string) => (fixture(name)[list] as JsonBodyType[])[0] ?? null

const forbidden = () =>
  HttpResponse.json(
    { errorMessages: ['You can only edit or delete your own entries.'], errors: {} },
    { status: 403 },
  )

describe('comments', () => {
  it('lists the comments of the recorded issue with ADF bodies and UTC times', async () => {
    const requests = serveRecorded(() => HttpResponse.json(fixture('comments-psapac-666')))
    const comments = await listComments(client, 'PSAPAC-666')
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /rest/api/3/issue/PSAPAC-666/comment?startAt=0&maxResults=50',
    ])
    expect(comments.map((c) => c.id)).toEqual(['1521295', '1539888', '1550451'])
    expect(comments[0]).toMatchObject({
      author: {
        accountId: '712020:e741f0cf-583b-48aa-8b81-6bc8e44cd370',
        displayName: 'Sharon Warner',
      },
      body: { type: 'doc', version: 1 },
      created: '2025-09-15T01:07:43.091Z',
    })
  })

  it('reads every page', async () => {
    const one = first('comments-psapac-666', 'comments')
    const requests = serveRecorded(({ path }) => {
      const startAt = Number(new URL(path, JIRA_SITE).searchParams.get('startAt'))
      return HttpResponse.json({ total: 51, comments: startAt === 0 ? Array(50).fill(one) : [one] })
    })
    expect(await listComments(client, 'PSAPAC-666')).toHaveLength(51)
    expect(requests.map((r) => r.path)).toEqual([
      '/rest/api/3/issue/PSAPAC-666/comment?startAt=0&maxResults=50',
      '/rest/api/3/issue/PSAPAC-666/comment?startAt=50&maxResults=50',
    ])
  })

  it('adds a comment with the ADF body', async () => {
    const requests = serveRecorded(() =>
      HttpResponse.json(first('comments-psapac-666', 'comments')),
    )
    const comment = await addComment(client, 'PSAPAC-666', body)
    expect(requests).toMatchObject([
      { method: 'POST', path: '/rest/api/3/issue/PSAPAC-666/comment', body: { body } },
    ])
    expect(comment.id).toBe('1521295')
  })

  it('edits a comment with a PUT of the new body', async () => {
    const requests = serveRecorded(() =>
      HttpResponse.json(first('comments-psapac-666', 'comments')),
    )
    await editComment(client, 'PSAPAC-666', '1521295', body)
    expect(requests).toMatchObject([
      { method: 'PUT', path: '/rest/api/3/issue/PSAPAC-666/comment/1521295', body: { body } },
    ])
  })

  it('deletes a comment', async () => {
    const requests = serveRecorded(noContent)
    await deleteComment(client, 'PSAPAC-666', '1521295')
    expect(requests).toMatchObject([
      { method: 'DELETE', path: '/rest/api/3/issue/PSAPAC-666/comment/1521295' },
    ])
  })

  it("passes Jira's 403 for another user's comment through as permission_denied", async () => {
    serveRecorded(forbidden)
    expect((await failure(editComment(client, 'PSAPAC-666', '1', body))).code).toBe(
      'permission_denied',
    )
    expect((await failure(deleteComment(client, 'PSAPAC-666', '1'))).code).toBe('permission_denied')
  })

  it('refuses a bad key, id or body before any request', async () => {
    const requests = serveRecorded(noContent)
    const bad = { type: 'paragraph' } as never
    const refusals = [
      listComments(client, 'psapac-1'),
      addComment(client, 'PSAPAC-1', bad),
      addComment(client, '../x', body),
      editComment(client, 'PSAPAC-1', '12/../3', body),
      editComment(client, 'PSAPAC-1', '0', body),
      deleteComment(client, 'PSAPAC-1', ''),
    ]
    for (const refusal of refusals) expect((await failure(refusal)).code).toBe('validation_failed')
    expect(requests).toEqual([])
  })
})

describe('worklogs', () => {
  it('lists the worklogs of the recorded issue', async () => {
    const requests = serveRecorded(() => HttpResponse.json(fixture('worklogs-psapac-666')))
    const worklogs = await listWorklogs(client, 'PSAPAC-666')
    expect(requests.map((r) => r.path)).toEqual([
      '/rest/api/3/issue/PSAPAC-666/worklog?startAt=0&maxResults=50',
    ])
    expect(worklogs).toHaveLength(1)
    expect(worklogs[0]).toMatchObject({
      id: '120440',
      timeSpent: '1h',
      timeSpentSeconds: 3600,
      started: '2025-10-07T22:32:10.657Z',
      author: { displayName: 'John Shea' },
      comment: { type: 'doc' },
    })
  })

  it('maps a worklog with no comment to null', async () => {
    const one = { ...(first('worklogs-psapac-666', 'worklogs') as object), comment: undefined }
    serveRecorded(() => HttpResponse.json({ total: 1, worklogs: [one] }))
    expect((await listWorklogs(client, 'PSAPAC-666'))[0]?.comment).toBeNull()
  })

  it("adds a worklog with adjustEstimate=auto and Jira's started format", async () => {
    const requests = serveRecorded(() =>
      HttpResponse.json(first('worklogs-psapac-666', 'worklogs')),
    )
    // 11:02:03 at +1000 is 01:02:03 UTC, and Jira wants an offset, not a Z.
    await addWorklog(client, 'PSAPAC-666', {
      timeSpent: '1h 30m',
      started: new Date('2026-10-07T11:02:03.456+10:00'),
      comment: body,
    })
    expect(requests).toMatchObject([
      {
        method: 'POST',
        path: '/rest/api/3/issue/PSAPAC-666/worklog?adjustEstimate=auto',
        body: { timeSpent: '1h 30m', started: '2026-10-07T01:02:03.456+0000', comment: body },
      },
    ])
  })

  it('leaves started and comment out when not given', async () => {
    const requests = serveRecorded(() =>
      HttpResponse.json(first('worklogs-psapac-666', 'worklogs')),
    )
    await addWorklog(client, 'PSAPAC-666', { timeSpent: '15m' })
    expect(requests[0]?.body).toEqual({ timeSpent: '15m' })
  })

  it('edits only the fields given, with adjustEstimate=auto', async () => {
    const requests = serveRecorded(() =>
      HttpResponse.json(first('worklogs-psapac-666', 'worklogs')),
    )
    await editWorklog(client, 'PSAPAC-666', '120440', { timeSpent: '2h' })
    expect(requests).toMatchObject([
      {
        method: 'PUT',
        path: '/rest/api/3/issue/PSAPAC-666/worklog/120440?adjustEstimate=auto',
        body: { timeSpent: '2h' },
      },
    ])
    expect(requests[0]?.body).toEqual({ timeSpent: '2h' })
  })

  it('deletes a worklog with adjustEstimate=auto', async () => {
    const requests = serveRecorded(noContent)
    await deleteWorklog(client, 'PSAPAC-666', '120440')
    expect(requests).toMatchObject([
      {
        method: 'DELETE',
        path: '/rest/api/3/issue/PSAPAC-666/worklog/120440?adjustEstimate=auto',
      },
    ])
  })

  it("passes Jira's 403 for another user's worklog through as permission_denied", async () => {
    serveRecorded(forbidden)
    expect((await failure(editWorklog(client, 'PSAPAC-666', '1', { timeSpent: '1h' }))).code).toBe(
      'permission_denied',
    )
    expect((await failure(deleteWorklog(client, 'PSAPAC-666', '1'))).code).toBe('permission_denied')
  })

  it('refuses bad input before any request', async () => {
    const requests = serveRecorded(noContent)
    const refusals = [
      addWorklog(client, 'PSAPAC-666', { timeSpent: '1.5h' }),
      addWorklog(client, 'PSAPAC-666', { timeSpent: '90' }),
      addWorklog(client, 'PSAPAC-666', { timeSpent: '' }),
      addWorklog(client, 'PSAPAC-666', { timeSpent: '1h', started: new Date('nope') }),
      addWorklog(client, 'PSAPAC-666', { timeSpent: '1h', started: '2026-10-07' as never }),
      addWorklog(client, 'PSAPAC-666', { timeSpent: '1h', extra: 1 } as never),
      addWorklog(client, 'bad', { timeSpent: '1h' }),
      editWorklog(client, 'PSAPAC-666', '120440', {}),
      editWorklog(client, 'PSAPAC-666', '1/2', { timeSpent: '1h' }),
      deleteWorklog(client, 'PSAPAC-666', 'abc'),
    ]
    for (const refusal of refusals) expect((await failure(refusal)).code).toBe('validation_failed')
    expect(requests).toEqual([])
  })
})

describe('links', () => {
  it('lists the links of an issue, each seen from it', async () => {
    const requests = serveRecorded(() => HttpResponse.json(fixture('issue-links-psapac-666')))
    const links = await listLinks(client, 'PSAPAC-666')
    expect(requests.map((r) => r.path)).toEqual(['/rest/api/3/issue/PSAPAC-666?fields=issuelinks'])
    expect(links.map((l) => [l.id, l.direction, l.issue.key])).toEqual([
      ['551838', 'outward', 'PSAPAC-664'],
      ['551839', 'outward', 'PSAPAC-663'],
      ['551840', 'outward', 'PSAPAC-669'],
    ])
    expect(links[0]).toMatchObject({
      type: { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
      issue: {
        summary: 'Value Consulting - Check in session (Draft 2) 23rd Sept 2025',
        status: 'Done',
      },
    })
  })

  it('reads the same link as inward from the other issue', async () => {
    serveRecorded(() => HttpResponse.json(fixture('issue-links-psapac-664')))
    const links = await listLinks(client, 'PSAPAC-664')
    expect(links.map((l) => [l.id, l.direction, l.issue.key])).toEqual([
      ['551838', 'inward', 'PSAPAC-666'],
      ['551841', 'inward', 'PSAPAC-665'],
    ])
  })

  it('lists all 21 link types, the tool-owned ones too', async () => {
    const requests = serveRecorded(() => HttpResponse.json(fixture('issuelinktype')))
    const types = await listLinkTypes(client)
    expect(requests.map((r) => r.path)).toEqual(['/rest/api/3/issueLinkType'])
    expect(types).toHaveLength(21)
    expect(types.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'Blocks',
        'Polaris issue link',
        'Zephyr Capture testing',
        'migration_parent',
      ]),
    )
    expect(types.find((t) => t.name === 'Cloners')).toMatchObject({
      inward: 'cloned to',
      outward: 'cloned from',
    })
  })

  const link = (input: AddLinkInput) => {
    const requests = serveRecorded(() => new HttpResponse(null, { status: 201 }))
    return addLink(client, input).then(() => requests)
  }

  it('says "A blocks B" with direction outward', async () => {
    const requests = await link({
      type: { name: 'Blocks' },
      key: 'PSAPAC-1',
      direction: 'outward',
      otherKey: 'PSAPAC-2',
    })
    expect(requests).toMatchObject([
      {
        method: 'POST',
        path: '/rest/api/3/issueLink',
        body: {
          type: { name: 'Blocks' },
          inwardIssue: { key: 'PSAPAC-1' },
          outwardIssue: { key: 'PSAPAC-2' },
        },
      },
    ])
  })

  it('says "A is blocked by B" with direction inward, by type id', async () => {
    const requests = await link({
      type: { id: '10000' },
      key: 'PSAPAC-1',
      direction: 'inward',
      otherKey: 'PSAPAC-2',
    })
    expect(requests[0]?.body).toEqual({
      type: { id: '10000' },
      inwardIssue: { key: 'PSAPAC-2' },
      outwardIssue: { key: 'PSAPAC-1' },
    })
  })

  // Pins the mapping as it stands: the first issue of a sentence is sent as `inwardIssue`.
  // Verified live on 2026-10-07: POST inwardIssue PSAPAC-3068, outwardIssue PSAPAC-3067 made
  // 3068 "blocks" 3067 (link 642179, created and deleted).
  it.each([
    ['outward', 'PSAPAC-1', 'PSAPAC-2'],
    ['inward', 'PSAPAC-2', 'PSAPAC-1'],
  ] as const)(
    'addLink direction %s sends inwardIssue %s and outwardIssue %s for key PSAPAC-1 and other PSAPAC-2',
    async (direction, inward, outward) => {
      const requests = await link({
        type: { name: 'Blocks' },
        key: 'PSAPAC-1',
        direction,
        otherKey: 'PSAPAC-2',
      })
      expect(requests[0]?.body).toEqual({
        type: { name: 'Blocks' },
        inwardIssue: { key: inward },
        outwardIssue: { key: outward },
      })
    },
  )

  it('removes a link by id', async () => {
    const requests = serveRecorded(noContent)
    await removeLink(client, '551838')
    expect(requests).toMatchObject([{ method: 'DELETE', path: '/rest/api/3/issueLink/551838' }])
  })

  it('refuses bad input before any request', async () => {
    const requests = serveRecorded(noContent)
    const ok = {
      type: { name: 'Blocks' },
      key: 'PSAPAC-1',
      direction: 'outward',
      otherKey: 'PSAPAC-2',
    }
    const refusals = [
      addLink(client, { ...ok, key: 'x' } as never),
      addLink(client, { ...ok, otherKey: '../PSAPAC-2' } as never),
      addLink(client, { ...ok, direction: 'sideways' } as never),
      addLink(client, { ...ok, type: {} } as never),
      addLink(client, { ...ok, type: { name: '' } } as never),
      addLink(client, { ...ok, type: { id: '1/../2' } } as never),
      addLink(client, { ...ok, type: { id: '1', name: 'Blocks' } } as never),
      removeLink(client, '12/3'),
      removeLink(client, ''),
      listLinks(client, 'nope'),
    ]
    for (const refusal of refusals) expect((await failure(refusal)).code).toBe('validation_failed')
    expect(requests).toEqual([])
  })
})

describe('attachments', () => {
  const meta =
    (overrides: object = {}) =>
    () =>
      HttpResponse.json({ ...fixture('attachment-meta'), ...overrides })
  const uploaded = () =>
    HttpResponse.json([
      (fixture('issue-attachments-psapac-3017').fields as { attachment: unknown[] }).attachment[0],
    ])

  /** Answers the meta call, and the upload with the recorded attachment. */
  const serve = (metaResponse: () => Response = meta()) =>
    serveRecorded(({ method }) => (method === 'GET' ? metaResponse() : uploaded()))

  it('lists the attachments of the recorded issue', async () => {
    const requests = serveRecorded(() =>
      HttpResponse.json(fixture('issue-attachments-psapac-3017')),
    )
    const attachments = await listAttachments(client, 'PSAPAC-3017')
    expect(requests.map((r) => r.path)).toEqual(['/rest/api/3/issue/PSAPAC-3017?fields=attachment'])
    expect(attachments).toHaveLength(2)
    expect(attachments[0]).toMatchObject({
      id: '652124',
      filename: '1f4a1.png',
      size: 1376,
      mimeType: 'image/png',
      created: '2026-09-22T04:25:44.289Z',
      author: { displayName: 'Sharon Warner' },
      contentUrl: `${JIRA_SITE}/rest/api/3/attachment/content/652124`,
    })
  })

  it('uploads a file as multipart after reading the limit', async () => {
    const requests = serve()
    const result = await addAttachment(client, 'PSAPAC-3017', {
      filename: 'notes.txt',
      content: new TextEncoder().encode('hello'),
    })
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /rest/api/3/attachment/meta',
      'POST /rest/api/3/issue/PSAPAC-3017/attachments',
    ])
    const upload = requests[1]
    expect(upload?.headers.get('x-atlassian-token')).toBe('no-check')
    const file = (upload?.body as FormData).get('file') as File
    expect(file.name).toBe('notes.txt')
    expect(await file.text()).toBe('hello')
    expect(result.map((a) => a.id)).toEqual(['652124'])
  })

  it('accepts a Blob', async () => {
    const requests = serve()
    await addAttachment(client, 'PSAPAC-3017', {
      filename: 'a.png',
      content: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    })
    const file = (requests[1]?.body as FormData).get('file') as File
    expect([file.name, file.size, file.type]).toEqual(['a.png', 3, 'image/png'])
  })

  it('refuses a file over the 100 MB limit from the recorded meta, sending nothing', async () => {
    const requests = serve()
    class Huge extends Blob {
      override get size() {
        return 100_000_001
      }
    }
    const error = await failure(
      addAttachment(client, 'PSAPAC-3017', { filename: 'big.bin', content: new Huge([]) }),
    )
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('100000000')
    expect(requests.map((r) => r.method)).toEqual(['GET'])
  })

  it('accepts a file of exactly the limit', async () => {
    const requests = serve(meta({ uploadLimit: 5 }))
    await addAttachment(client, 'PSAPAC-3017', { filename: 'a.bin', content: new Uint8Array(5) })
    expect(requests.map((r) => r.method)).toEqual(['GET', 'POST'])
    const error = await failure(
      addAttachment(client, 'PSAPAC-3017', { filename: 'a.bin', content: new Uint8Array(6) }),
    )
    expect(error.code).toBe('validation_failed')
  })

  it('refuses an upload when the site has attachments off', async () => {
    const requests = serve(meta({ enabled: false }))
    const error = await failure(
      addAttachment(client, 'PSAPAC-3017', { filename: 'a.bin', content: new Uint8Array(1) }),
    )
    expect(error.code).toBe('validation_failed')
    expect(requests.map((r) => r.method)).toEqual(['GET'])
  })

  it('removes an attachment by id', async () => {
    const requests = serveRecorded(noContent)
    await removeAttachment(client, '652124')
    expect(requests).toMatchObject([{ method: 'DELETE', path: '/rest/api/3/attachment/652124' }])
  })

  it('refuses bad input before any request', async () => {
    const requests = serve()
    const bytes = new Uint8Array(1)
    const refusals = [
      addAttachment(client, 'nope', { filename: 'a', content: bytes }),
      addAttachment(client, 'PSAPAC-1', { filename: '', content: bytes }),
      addAttachment(client, 'PSAPAC-1', { filename: 'a', content: 'text' as never }),
      removeAttachment(client, '1/../2'),
      removeAttachment(client, ''),
    ]
    for (const refusal of refusals) expect((await failure(refusal)).code).toBe('validation_failed')
    expect(requests).toEqual([])
  })
})

describe('responses', () => {
  it.each([
    ['comment', (c: typeof client) => addComment(c, 'PSAPAC-1', body)],
    ['worklog', (c: typeof client) => addWorklog(c, 'PSAPAC-1', { timeSpent: '1h' })],
    ['links', (c: typeof client) => listLinks(c, 'PSAPAC-1')],
    ['link types', (c: typeof client) => listLinkTypes(c)],
    ['attachments', (c: typeof client) => listAttachments(c, 'PSAPAC-1')],
  ])('throws jira_error for a malformed %s response', async (_name, run) => {
    serveRecorded(() => HttpResponse.json({ surprise: true }))
    expect((await failure(run(client))).code).toBe('jira_error')
  })
})
