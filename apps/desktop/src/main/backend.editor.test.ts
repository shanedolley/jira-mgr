import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JiraMgrError } from '@jira-mgr/core'
import type { AdfDoc } from '@jira-mgr/core/adf'
import type { HttpClient } from '@jira-mgr/core/http'
import { writeFields, writeSettings } from '@jira-mgr/core/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBackend } from './backend'

const SITE = 'https://team.atlassian.net'
const KEY = 'PSAPAC-12'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-desktop-editor-'))
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])
const mediaOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

interface Att {
  id: string
  filename?: string
  size?: number
  mimeType?: string
}

const rawAttachment = ({ id, filename, size, mimeType }: Att) => ({
  id,
  filename: filename ?? `image-${id}.png`,
  size: size ?? PNG.length,
  mimeType: mimeType ?? 'image/png',
  created: '2026-10-01T00:00:00.000+0000',
  content: `${SITE}/rest/api/3/attachment/content/${id}`,
})

const doc = (text: string): AdfDoc => ({
  version: 1,
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const rawIssue = (description: unknown) => ({
  id: '1',
  key: KEY,
  fields: {
    summary: 'An issue',
    issuetype: { id: '1', name: 'Story', subtask: false, hierarchyLevel: 0 },
    status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
    labels: [],
    created: '2026-10-01T00:00:00.000Z',
    updated: '2026-10-01T00:00:00.000Z',
    description,
  },
})

interface FakeOptions {
  attachments?: Att[]
  /** Attachments the list shows from its second read on. */
  later?: Att[]
  /** The media id of each attachment, by id. */
  media?: Record<string, string>
  content?: Record<string, Uint8Array>
  description?: unknown
}

/** An HTTP client that answers from memory and records each request in order. */
function fakeJira(options: FakeOptions = {}) {
  const requests: string[] = []
  const bodies: unknown[] = []
  let lists = 0
  let reading = 0
  let peak = 0
  const gates: (() => void)[] = []
  let gated = false
  const http: HttpClient = {
    async request(method, path, init) {
      requests.push(`${method} ${path}`)
      if (init?.body !== undefined) bodies.push(init.body)
      const id = /\/attachment\/content\/(\d+)/.exec(path)?.[1]
      if (id !== undefined && init?.as === 'mediaId')
        return options.media?.[id] ?? mediaOf(Number(id))
      if (id !== undefined && init?.as === 'bytes') {
        reading++
        peak = Math.max(peak, reading)
        if (gated) await new Promise<void>((resolve) => gates.push(resolve))
        reading--
        return { contentType: 'image/png', bytes: options.content?.[id] ?? PNG }
      }
      if (method === 'GET' && path.includes('fields=attachment')) {
        lists++
        const list = lists > 1 && options.later !== undefined ? options.later : options.attachments
        return { fields: { attachment: (list ?? []).map(rawAttachment) } }
      }
      if (method === 'GET' && path.startsWith(`/rest/api/3/issue/${KEY}`)) {
        return rawIssue(options.description ?? null)
      }
      if (method === 'GET' && path === '/rest/api/3/attachment/meta') {
        return { enabled: true, uploadLimit: 100_000_000 }
      }
      if (method === 'POST' && path.endsWith('/attachments')) {
        const file = (init?.body as FormData).get('file') as File
        return [
          rawAttachment({
            id: '900',
            filename: `Jira-${file.name}`,
            size: file.size,
            mimeType: file.type,
          }),
        ]
      }
      return undefined
    },
  }
  return {
    http,
    requests,
    bodies,
    lists: () => lists,
    peak: () => peak,
    gate() {
      gated = true
    },
    open() {
      gated = false
      for (const release of gates.splice(0)) release()
    },
    pending: () => gates.length,
  }
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  )

const writes = (requests: string[]) => requests.filter((r) => r.startsWith('PUT'))

describe('setDescription', () => {
  it("writes when Jira's description matches the base", async () => {
    const jira = fakeJira({ description: doc('old') })
    const result = await createBackend({ http: jira.http }).setDescription({
      key: KEY,
      description: doc('new'),
      base: doc('old'),
    })
    expect(result).toEqual({ saved: true })
    expect(writes(jira.requests)).toEqual([`PUT /rest/api/3/issue/${KEY}`])
    expect(jira.bodies).toEqual([{ fields: { description: doc('new') } }])
  })

  it("returns Jira's description and writes nothing when it differs", async () => {
    const jira = fakeJira({ description: doc('theirs') })
    const result = await createBackend({ http: jira.http }).setDescription({
      key: KEY,
      description: doc('mine'),
      base: doc('old'),
    })
    expect(result).toEqual({ saved: false, current: doc('theirs') })
    expect(writes(jira.requests)).toEqual([])
  })

  it('treats a key-order difference as no change', async () => {
    const reordered = { content: doc('old').content, type: 'doc', version: 1 }
    const jira = fakeJira({ description: reordered })
    const result = await createBackend({ http: jira.http }).setDescription({
      key: KEY,
      description: doc('new'),
      base: doc('old'),
    })
    expect(result).toEqual({ saved: true })
  })

  it('clears the description with null, and compares null to none', async () => {
    const jira = fakeJira({ description: null })
    const backend = createBackend({ http: jira.http })
    expect(await backend.setDescription({ key: KEY, description: null, base: null })).toEqual({
      saved: true,
    })
    expect(jira.bodies).toEqual([{ fields: { description: null } }])
  })

  it('refuses an issue of another project before any request', async () => {
    const jira = fakeJira()
    const error = await failure(
      createBackend({ http: jira.http }).setDescription({
        key: 'OTHER-1',
        description: null,
        base: null,
      }),
    )
    expect(error).toMatchObject({ code: 'validation_failed' })
    expect(jira.requests).toEqual([])
  })
})

describe('addImage', () => {
  const args = { key: KEY, filename: 'shot.png', mimeType: 'image/png', bytes: PNG } as const

  it("uploads with the type, then returns the image node built from Jira's filename", async () => {
    const jira = fakeJira()
    const { node } = await createBackend({ http: jira.http }).addImage({
      ...args,
      width: 640,
      height: 480,
    })
    expect(jira.requests).toEqual([
      'GET /rest/api/3/attachment/meta',
      `POST /rest/api/3/issue/${KEY}/attachments`,
      'GET /rest/api/3/attachment/content/900',
    ])
    const part = (jira.bodies[0] as FormData).get('file') as File
    expect([part.name, part.type]).toEqual(['shot.png', 'image/png'])
    expect(node).toEqual({
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [
        {
          type: 'media',
          attrs: {
            type: 'file',
            id: mediaOf(900),
            collection: '',
            alt: 'Jira-shot.png',
            width: 640,
            height: 480,
          },
        },
      ],
    })
  })

  it('refuses bytes whose magic number does not match the claimed type', async () => {
    const jira = fakeJira()
    const backend = createBackend({ http: jira.http })
    expect(await failure(backend.addImage({ ...args, bytes: JPEG }))).toMatchObject({
      code: 'validation_failed',
    })
    expect(await failure(backend.addImage({ ...args, filename: 'a/b.png' }))).toMatchObject({
      code: 'validation_failed',
    })
    expect(jira.requests).toEqual([])
  })

  it('lets the new image show without listing the attachments again', async () => {
    const jira = fakeJira({ attachments: [] })
    const backend = createBackend({ http: jira.http })
    const { node } = await backend.addImage(args)
    const mediaId = (node.content?.[0]?.attrs as { id: string }).id
    jira.requests.length = 0
    const image = await backend.image({ key: KEY, mediaId })
    expect(image.mimeType).toBe('image/png')
    expect(jira.requests).toEqual(['GET /rest/api/3/attachment/content/900?redirect=false'])
  })
})

describe('image', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i): Att => ({ id: String(100 + i) }))

  it('resolves image attachments in batches of 4 and stops at the batch that finds the id', async () => {
    const jira = fakeJira({ attachments: many(10) })
    const backend = createBackend({ http: jira.http })
    const result = await backend.image({ key: KEY, mediaId: mediaOf(105) })
    expect(result.mimeType).toBe('image/png')
    const resolved = jira.requests.filter((r) => /content\/\d+$/.test(r))
    expect(resolved).toEqual(
      [100, 101, 102, 103, 104, 105, 106, 107].map(
        (n) => `GET /rest/api/3/attachment/content/${String(n)}`,
      ),
    )
    // The next image costs nothing for what is already resolved.
    jira.requests.length = 0
    await backend.image({ key: KEY, mediaId: mediaOf(101) })
    expect(jira.requests).toEqual(['GET /rest/api/3/attachment/content/101?redirect=false'])
  })

  it('skips attachments that are not images when resolving', async () => {
    const jira = fakeJira({
      attachments: [{ id: '100', mimeType: 'application/pdf' }, { id: '101' }],
    })
    await createBackend({ http: jira.http }).image({ key: KEY, mediaId: mediaOf(101) })
    expect(jira.requests.some((r) => r.endsWith('/content/100'))).toBe(false)
  })

  it('re-reads the list once for an unknown id, shares the re-read, and caches the miss for 30 seconds', async () => {
    let clock = 1_000
    const jira = fakeJira({ attachments: many(1), later: many(2) })
    const backend = createBackend({ http: jira.http, now: () => clock })
    const lookups = await Promise.all([
      failure(backend.image({ key: KEY, mediaId: mediaOf(999) })),
      failure(backend.image({ key: KEY, mediaId: mediaOf(999) })),
    ])
    expect(lookups).toEqual([
      expect.objectContaining({ code: 'not_found' }),
      expect.objectContaining({ code: 'not_found' }),
    ])
    expect(jira.lists()).toBe(2)
    // A second miss inside the window sends nothing.
    jira.requests.length = 0
    clock += 29_000
    expect(await failure(backend.image({ key: KEY, mediaId: mediaOf(999) }))).toMatchObject({
      code: 'not_found',
    })
    expect(jira.requests).toEqual([])
    // After the window it asks again, and the list is read again.
    clock += 2_000
    await failure(backend.image({ key: KEY, mediaId: mediaOf(999) }))
    expect(jira.lists()).toBe(3)
  })

  it('finds an image attached in Jira since the list was read', async () => {
    const jira = fakeJira({ attachments: many(1), later: many(2) })
    const backend = createBackend({ http: jira.http })
    await backend.image({ key: KEY, mediaId: mediaOf(100) })
    const result = await backend.image({ key: KEY, mediaId: mediaOf(101) })
    expect(result.mimeType).toBe('image/png')
    expect(jira.lists()).toBe(2)
  })

  it('refuses an attachment over 20 MB or of another type before fetching it', async () => {
    const jira = fakeJira({
      attachments: [
        { id: '100', size: 20_000_001 },
        { id: '101', mimeType: 'image/svg+xml' },
      ],
    })
    const backend = createBackend({ http: jira.http })
    for (const n of [100, 101]) {
      expect(await failure(backend.image({ key: KEY, mediaId: mediaOf(n) }))).toMatchObject({
        code: 'validation_failed',
      })
    }
    expect(jira.requests.some((r) => r.includes('redirect=false'))).toBe(false)
  })

  it('refuses fetched bytes that are not one of the four types', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const jira = fakeJira({ attachments: [{ id: '100' }], content: { '100': svg } })
    expect(
      await failure(createBackend({ http: jira.http }).image({ key: KEY, mediaId: mediaOf(100) })),
    ).toMatchObject({ code: 'validation_failed' })
  })

  it('types the image by its bytes, whatever Jira declared', async () => {
    const jira = fakeJira({ attachments: [{ id: '100' }], content: { '100': JPEG } })
    const result = await createBackend({ http: jira.http }).image({
      key: KEY,
      mediaId: mediaOf(100),
    })
    expect(result.mimeType).toBe('image/jpeg')
  })

  it('runs at most 4 reads at once', async () => {
    const jira = fakeJira({ attachments: many(8) })
    jira.gate()
    const backend = createBackend({ http: jira.http })
    const all = Promise.all(
      Array.from({ length: 8 }, (_, i) => backend.image({ key: KEY, mediaId: mediaOf(100 + i) })),
    )
    await expect.poll(jira.pending).toBe(4)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(jira.peak()).toBe(4)
    // Opening the gate lets every queued read through, so keep opening until all eight are done.
    const state = { done: false }
    void all.finally(() => {
      state.done = true
    })
    while (!state.done) {
      jira.open()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await all
    expect(jira.peak()).toBe(4)
  })

  it('does not let one unreadable attachment fail the images beside it', async () => {
    const jira = fakeJira({ attachments: many(3) })
    const real = jira.http.request.bind(jira.http)
    const flaky: typeof jira.http = {
      request: (method, path, init) =>
        init?.as === 'mediaId' && path.endsWith('/100')
          ? Promise.reject(new JiraMgrError('jira_error', 'No redirect for 100.'))
          : real(method, path, init),
    }
    const backend = createBackend({ http: flaky })
    const ok = await backend.image({ key: KEY, mediaId: mediaOf(101) })
    expect(ok.mimeType).toBe('image/png')
    // When the wanted image is missing and a read failed, the failure is the answer.
    expect(await failure(backend.image({ key: KEY, mediaId: mediaOf(999) }))).toMatchObject({
      code: 'jira_error',
    })
  })

  it('clears the media index on logout', async () => {
    const jira = fakeJira({ attachments: many(2) })
    const keychain = {
      get: () => Promise.resolve('token'),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      deleteAll: () => Promise.resolve(),
    }
    const backend = createBackend({ http: jira.http, keychain })
    await backend.image({ key: KEY, mediaId: mediaOf(101) })
    expect(jira.lists()).toBe(1)
    await backend.logout()
    jira.requests.length = 0
    await backend.image({ key: KEY, mediaId: mediaOf(101) })
    expect(jira.lists()).toBe(2)
    expect(jira.requests.filter((r) => /content\/\d+$/.test(r)).length).toBeGreaterThan(0)
  })
})
