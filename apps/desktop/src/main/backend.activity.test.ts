import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AdfDoc } from '@jira-mgr/core/adf'
import type { HttpClient } from '@jira-mgr/core/http'
import { writeSettings } from '@jira-mgr/core/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBackend, type BackendDeps } from './backend'

const SITE = 'https://team.atlassian.net'
const KEY = 'PSAPAC-12'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-desktop-activity-'))
  process.env.JM_STATE_DIR = dir
  await writeSettings({ siteUrl: SITE, projectKey: 'PSAPAC', email: 'me@example.com' })
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

const person = { accountId: 'u1', displayName: 'Me' }
const NOW = '2026-10-10T01:00:00.000+0000'

const rawComment = { id: '7', author: person, body: doc('Hello'), created: NOW, updated: NOW }
const rawWorklog = {
  id: '9',
  author: person,
  timeSpent: '1h',
  timeSpentSeconds: 3600,
  started: NOW,
  created: NOW,
  updated: NOW,
}
const linkType = { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }
const rawAttachment = (id: string, filename = 'report.xlsx', size = 10) => ({
  id,
  filename,
  size,
  mimeType: 'application/vnd.ms-excel',
  created: NOW,
  author: person,
  content: `${SITE}/rest/api/3/attachment/content/${id}`,
})

interface Request {
  method: string
  path: string
  body?: unknown
}

/** An HTTP client that answers from memory and records each request in order. */
function fakeJira(
  options: { link?: { inward: string; outward: string }; attachments?: unknown[] } = {},
) {
  const requests: Request[] = []
  const http: HttpClient = {
    request(method, path, init) {
      requests.push({ method, path, body: init?.body })
      if (path.startsWith('/rest/api/3/attachment/meta')) {
        return Promise.resolve({ enabled: true, uploadLimit: 100_000_000 })
      }
      if (method === 'GET' && path.includes('/comment')) {
        return Promise.resolve({ total: 1, comments: [rawComment] })
      }
      if (path.includes('/comment')) return Promise.resolve(method === 'DELETE' ? null : rawComment)
      if (method === 'GET' && path.includes('/worklog/')) return Promise.resolve(rawWorklog)
      if (method === 'GET' && path.includes('/worklog')) {
        return Promise.resolve({ total: 1, worklogs: [rawWorklog] })
      }
      if (path.includes('/worklog')) return Promise.resolve(method === 'DELETE' ? null : rawWorklog)
      if (path === '/rest/api/3/issueLinkType') {
        return Promise.resolve({ issueLinkTypes: [linkType] })
      }
      if (method === 'GET' && path.startsWith('/rest/api/3/issueLink/')) {
        return Promise.resolve({
          id: '3',
          type: linkType,
          inwardIssue: { key: options.link?.inward ?? KEY },
          outwardIssue: { key: options.link?.outward ?? 'PSAPAC-13' },
        })
      }
      if (method === 'GET' && path.includes('fields=issuelinks')) {
        return Promise.resolve({
          fields: {
            issuelinks: [
              {
                id: '3',
                type: linkType,
                outwardIssue: {
                  key: 'PSAPAC-13',
                  fields: { summary: 'Other', status: { name: 'To Do' } },
                },
              },
            ],
          },
        })
      }
      if (path.startsWith('/rest/api/3/issueLink')) return Promise.resolve(null)
      if (method === 'GET' && path.includes('fields=attachment')) {
        return Promise.resolve({
          fields: { attachment: options.attachments ?? [rawAttachment('5')] },
        })
      }
      if (method === 'POST' && path.endsWith('/attachments')) {
        return Promise.resolve([rawAttachment('6', 'new.zip')])
      }
      if (path.startsWith('/rest/api/3/attachment/content/')) {
        return Promise.resolve({
          contentType: 'application/vnd.ms-excel',
          bytes: new Uint8Array([1, 2, 3]),
        })
      }
      return Promise.reject(new Error(`unexpected ${method} ${path}`))
    },
  }
  return { http, requests }
}

const backendFor = (http: HttpClient, deps: BackendDeps = {}) => createBackend({ http, ...deps })

describe('comments', () => {
  it('lists, adds, edits and deletes through core', async () => {
    const { http, requests } = fakeJira()
    const backend = backendFor(http)
    expect(await backend.listComments({ key: KEY })).toHaveLength(1)
    await backend.addComment({ key: KEY, body: doc('New') })
    await backend.editComment({ key: KEY, commentId: '7', body: doc('Edited') })
    await backend.deleteComment({ key: KEY, commentId: '7' })
    expect(requests.map((r) => `${r.method} ${r.path.split('?')[0] ?? ''}`)).toEqual([
      `GET /rest/api/3/issue/${KEY}/comment`,
      `POST /rest/api/3/issue/${KEY}/comment`,
      `PUT /rest/api/3/issue/${KEY}/comment/7`,
      `DELETE /rest/api/3/issue/${KEY}/comment/7`,
    ])
  })

  it('refuses a write to another project before any request', async () => {
    const { http, requests } = fakeJira()
    const backend = backendFor(http)
    await expect(backend.addComment({ key: 'OTHER-1', body: doc('x') })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    await expect(
      backend.editComment({ key: 'OTHER-1', commentId: '7', body: doc('x') }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(backend.deleteComment({ key: 'OTHER-1', commentId: '7' })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    expect(requests).toEqual([])
  })
})

describe('worklogs', () => {
  it('adds with adjustEstimate=auto and sends the start as an instant', async () => {
    const { http, requests } = fakeJira()
    await backendFor(http).addWorklog({
      key: KEY,
      timeSpent: '1h 30m',
      started: '2026-10-10T01:00:00.000Z',
    })
    expect(requests).toEqual([
      {
        method: 'POST',
        path: `/rest/api/3/issue/${KEY}/worklog?adjustEstimate=auto`,
        body: { timeSpent: '1h 30m', started: '2026-10-10T01:00:00.000+0000' },
      },
    ])
  })

  it('reads the worklog through the issue before an edit or a delete', async () => {
    const { http, requests } = fakeJira()
    const backend = backendFor(http)
    await backend.editWorklog({ key: KEY, worklogId: '9', timeSpent: '2h' })
    await backend.deleteWorklog({ key: KEY, worklogId: '9' })
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET /rest/api/3/issue/${KEY}/worklog/9`,
      `PUT /rest/api/3/issue/${KEY}/worklog/9?adjustEstimate=auto`,
      `GET /rest/api/3/issue/${KEY}/worklog/9`,
      `DELETE /rest/api/3/issue/${KEY}/worklog/9?adjustEstimate=auto`,
    ])
  })

  it('refuses a write to another project before any request', async () => {
    const { http, requests } = fakeJira()
    const backend = backendFor(http)
    await expect(backend.addWorklog({ key: 'OTHER-1', timeSpent: '1h' })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    expect(requests).toEqual([])
  })
})

describe('links', () => {
  it('sends the blocker as inwardIssue for an outward choice', async () => {
    const { http, requests } = fakeJira()
    await backendFor(http).addLink({
      key: KEY,
      typeId: '1',
      direction: 'outward',
      otherKey: 'PSAPAC-13',
    })
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/rest/api/3/issueLink',
        body: {
          type: { id: '1' },
          inwardIssue: { key: KEY },
          outwardIssue: { key: 'PSAPAC-13' },
        },
      },
    ])
  })

  it('sends the other issue as the blocker for an inward choice', async () => {
    const { http, requests } = fakeJira()
    await backendFor(http).addLink({
      key: KEY,
      typeId: '1',
      direction: 'inward',
      otherKey: 'PSAPAC-13',
    })
    expect(requests[0]?.body).toMatchObject({
      inwardIssue: { key: 'PSAPAC-13' },
      outwardIssue: { key: KEY },
    })
  })

  it('refuses another project at either end, and a link to itself, before any request', async () => {
    const { http, requests } = fakeJira()
    const backend = backendFor(http)
    for (const [key, otherKey] of [
      ['OTHER-1', 'PSAPAC-13'],
      [KEY, 'OTHER-1'],
      [KEY, KEY],
    ] as const) {
      await expect(
        backend.addLink({ key, typeId: '1', direction: 'outward', otherKey }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    }
    expect(requests).toEqual([])
  })

  it('lists the links with every link type', async () => {
    const { http } = fakeJira()
    const result = await backendFor(http).listLinks({ key: KEY })
    expect(result.types).toEqual([linkType])
    expect(result.links).toMatchObject([
      { id: '3', direction: 'outward', issue: { key: 'PSAPAC-13', status: 'To Do' } },
    ])
  })

  it('removes a link that touches the issue, after reading it', async () => {
    const { http, requests } = fakeJira()
    await backendFor(http).removeLink({ key: KEY, linkId: '3' })
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /rest/api/3/issueLink/3',
      'DELETE /rest/api/3/issueLink/3',
    ])
  })

  it('refuses a link that does not touch the issue, and one with an end outside the project', async () => {
    const stray = fakeJira({ link: { inward: 'PSAPAC-20', outward: 'PSAPAC-21' } })
    await expect(
      backendFor(stray.http).removeLink({ key: KEY, linkId: '3' }),
    ).rejects.toMatchObject({ code: 'not_found' })
    const foreign = fakeJira({ link: { inward: KEY, outward: 'OTHER-5' } })
    await expect(
      backendFor(foreign.http).removeLink({ key: KEY, linkId: '3' }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    // The mirror: the foreign issue is the inward end, this one the outward end.
    const mirror = fakeJira({ link: { inward: 'OTHER-5', outward: KEY } })
    await expect(
      backendFor(mirror.http).removeLink({ key: KEY, linkId: '3' }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    for (const { requests } of [stray, foreign, mirror]) {
      expect(requests.some((r) => r.method === 'DELETE')).toBe(false)
    }
  })
})

describe('attachments', () => {
  it('lists the attachments without Jira content URLs', async () => {
    const { http } = fakeJira()
    const [first] = await backendFor(http).listAttachments({ key: KEY })
    expect(first).toMatchObject({ id: '5', filename: 'report.xlsx' })
    expect(JSON.stringify(first)).not.toContain('/rest/api')
  })

  it('attaches a file of any type, declaring the type the browser reported', async () => {
    const { http, requests } = fakeJira()
    const item = await backendFor(http).addAttachmentFile({
      key: KEY,
      filename: 'new.zip',
      mimeType: 'application/zip',
      bytes: new Uint8Array([1, 2]),
    })
    expect(item.filename).toBe('new.zip')
    const upload = requests.find((r) => r.method === 'POST')
    const file = (upload?.body as FormData).get('file') as File
    expect(file.name).toBe('new.zip')
    expect(file.type).toBe('application/zip')
  })

  it('leaves the type undeclared when the browser reported none or an invalid one', async () => {
    const { http, requests } = fakeJira()
    const backend = backendFor(http)
    for (const mimeType of ['', 'not a type']) {
      await backend.addAttachmentFile({
        key: KEY,
        filename: 'a.bin',
        mimeType,
        bytes: new Uint8Array([1]),
      })
    }
    const types = requests
      .filter((r) => r.method === 'POST')
      .map((r) => ((r.body as FormData).get('file') as File).type)
    expect(types).toEqual(['', ''])
  })

  it('refuses an unsafe name, and another project, before any request', async () => {
    const { http, requests } = fakeJira()
    const backend = backendFor(http)
    for (const filename of ['a/b.txt', 'a\\b.txt', '‮gpj.exe', '..']) {
      await expect(
        backend.addAttachmentFile({
          key: KEY,
          filename,
          mimeType: '',
          bytes: new Uint8Array([1]),
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    }
    await expect(
      backend.addAttachmentFile({
        key: 'OTHER-1',
        filename: 'a.txt',
        mimeType: '',
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    expect(requests).toEqual([])
  })
})

describe('download', () => {
  it('writes to the path the dialog returned, and offers the attachment name as the default', async () => {
    const { http } = fakeJira()
    const offered: string[] = []
    const written: { path: string; bytes: Uint8Array }[] = []
    const backend = backendFor(http, {
      chooseSavePath: (name) => {
        offered.push(name)
        return Promise.resolve('/Users/me/Downloads/chosen.xlsx')
      },
      writeFile: (path, bytes) => {
        written.push({ path, bytes })
        return Promise.resolve()
      },
    })
    const result = await backend.downloadAttachment({ key: KEY, attachmentId: '5' })
    expect(result).toEqual({ saved: true, filename: 'chosen.xlsx' })
    expect(offered).toEqual(['report.xlsx'])
    expect(written).toEqual([
      { path: '/Users/me/Downloads/chosen.xlsx', bytes: new Uint8Array([1, 2, 3]) },
    ])
  })

  it('writes nothing and fetches nothing when the user cancels', async () => {
    const { http, requests } = fakeJira()
    let wrote = false
    const backend = backendFor(http, {
      chooseSavePath: () => Promise.resolve(null),
      writeFile: () => {
        wrote = true
        return Promise.resolve()
      },
    })
    expect(await backend.downloadAttachment({ key: KEY, attachmentId: '5' })).toEqual({
      saved: false,
    })
    expect(wrote).toBe(false)
    expect(requests.some((r) => r.path.includes('/attachment/content/'))).toBe(false)
  })

  it('refuses an attachment of another issue, and offers a path-free default for a hostile name', async () => {
    const { http } = fakeJira({ attachments: [rawAttachment('5', '../../etc/x‮exe')] })
    const offered: string[] = []
    const backend = backendFor(http, {
      chooseSavePath: (name) => {
        offered.push(name)
        return Promise.resolve(null)
      },
    })
    await expect(
      backend.downloadAttachment({ key: KEY, attachmentId: '99' }),
    ).rejects.toMatchObject({ code: 'not_found' })
    await backend.downloadAttachment({ key: KEY, attachmentId: '5' })
    expect(offered).toEqual(['x_exe'])
  })

  it('refuses another project before any request', async () => {
    const { http, requests } = fakeJira()
    const backend = backendFor(http, { chooseSavePath: () => Promise.resolve(null) })
    await expect(
      backend.downloadAttachment({ key: 'OTHER-1', attachmentId: '5' }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    expect(requests).toEqual([])
  })

  it('refuses a file over the limit before it opens the dialog', async () => {
    const { http } = fakeJira({ attachments: [rawAttachment('5', 'big.iso', 100_000_001)] })
    let asked = false
    const backend = backendFor(http, {
      chooseSavePath: () => {
        asked = true
        return Promise.resolve(null)
      },
    })
    await expect(backend.downloadAttachment({ key: KEY, attachmentId: '5' })).rejects.toMatchObject(
      { code: 'validation_failed' },
    )
    expect(asked).toBe(false)
  })

  it('says so when the file cannot be written', async () => {
    const { http } = fakeJira()
    const backend = backendFor(http, {
      chooseSavePath: () => Promise.resolve('/nowhere/x'),
      writeFile: () => Promise.reject(new Error('EACCES: /nowhere/x')),
    })
    const failure = await backend
      .downloadAttachment({ key: KEY, attachmentId: '5' })
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'internal' })
    expect((failure as Error).message).not.toContain('EACCES')
  })
})
