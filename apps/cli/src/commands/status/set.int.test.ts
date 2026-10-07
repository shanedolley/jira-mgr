import { loadFixture, usePsapacState } from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'
import { serveWrites } from '../../test-write.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'status set')

usePsapacState()

const KEY = 'PSAPAC-3066'
const TRANSITIONS = `/rest/api/3/issue/${KEY}/transitions`

/** The recorded issue sits in Done (id 11824); its transitions are the recorded Story ones. */
const set = (status: string) => ['status', 'set', KEY, status]
const calls = (requests: { method: string; path: string }[]) =>
  requests.map((r) => `${r.method} ${r.path.split('?')[0] ?? ''}`)

describe('jm status set', () => {
  it('moves to a status named in any case and reports the canonical name', async () => {
    const { requests } = serveWrites()
    const { code, data, f } = await runJson(set('in progress'))
    expect(code).toBe(0)
    expectShape(data, spec?.output.example)
    expect(data).toEqual({ key: KEY, status: 'In Progress', changed: true })
    expect(calls(requests)).toEqual([
      `GET /rest/api/3/issue/${KEY}`,
      `GET ${TRANSITIONS}`,
      `POST ${TRANSITIONS}`,
    ])
    expect(requests[2]?.body).toEqual({ transition: { id: '21' } })
    expect(f.stderr).toBe('')
  })

  it('moves to a status given by id', async () => {
    const { requests } = serveWrites()
    const { code, data } = await runJson(set('11823'))
    expect(code).toBe(0)
    expect(data).toEqual({ key: KEY, status: 'In Progress', changed: true })
    expect(requests[2]?.body).toEqual({ transition: { id: '21' } })
  })

  it('ignores spaces around the status, for a move and for the current status', async () => {
    const { requests } = serveWrites()
    const moved = await runJson(set('  in progress '))
    expect(moved.data).toEqual({ key: KEY, status: 'In Progress', changed: true })
    expect(requests[2]?.body).toEqual({ transition: { id: '21' } })
    const same = await runJson(set(' done '))
    expect(same.data).toEqual({ key: KEY, status: 'Done', changed: false })
    const byId = await runJson(set(' 11824 '))
    expect(byId.data).toEqual({ key: KEY, status: 'Done', changed: false })
  })

  it('reads the key in any case', async () => {
    const { requests } = serveWrites()
    const { code } = await runJson(['status', 'set', 'psapac-3066', 'To Do'])
    expect(code).toBe(0)
    expect(requests[2]?.body).toEqual({ transition: { id: '11' } })
  })

  it('does nothing when the issue is already in the status, by name or id', async () => {
    const { requests } = serveWrites()
    for (const status of ['done', 'Done', '11824']) {
      const { code, data } = await runJson(set(status))
      expect(code).toBe(0)
      expect(data).toEqual({ key: KEY, status: 'Done', changed: false })
    }
    expect(calls(requests)).toEqual(Array<string>(3).fill(`GET /rest/api/3/issue/${KEY}`))
  })

  it('exits 2 listing the available statuses for one the issue cannot reach', async () => {
    const { requests } = serveWrites()
    const { code, error } = await runJson(set('Opportunity'))
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toBe(
      `${KEY} cannot move to "Opportunity". Available: Hold, Review, To Do, In Progress, Done.`,
    )
    expect(error?.details).toEqual({
      available: ['Hold', 'Review', 'To Do', 'In Progress', 'Done'],
    })
    expect(calls(requests)).toEqual([`GET /rest/api/3/issue/${KEY}`, `GET ${TRANSITIONS}`])
  })

  it('matches the status a transition reaches, not the transition name', async () => {
    const { requests } = serveWrites({
      respond: ({ method, path }) =>
        method === 'GET' && path.endsWith('/transitions')
          ? Response.json(loadFixture('transitions-epic'))
          : undefined,
    })
    const { code, data } = await runJson(set('Review'))
    expect(code).toBe(0)
    expect(data).toEqual({ key: KEY, status: 'Review', changed: true })
    expect(requests[2]?.body).toEqual({ transition: { id: '3' } })
  })

  it('prints the result on a terminal', async () => {
    serveWrites()
    const moved = await runTty(set('To Do'))
    expect(moved.code).toBe(0)
    expect(moved.f.stdout).toBe(`${KEY} is now To Do\n`)
    const same = await runTty(set('Done'))
    expect(same.f.stdout).toBe(`${KEY} is already Done\n`)
    expect(same.f.stderr).toBe('')
  })

  it('prints jm: and nothing on stdout for an unreachable status on a terminal', async () => {
    serveWrites()
    const { code, f } = await runTty(set('Opportunity'))
    expect(code).toBe(2)
    expect(f.stdout).toBe('')
    expect(f.stderr).toMatch(/^jm: .*Available: Hold, Review/)
  })

  it('exits 3 for an issue that does not exist', async () => {
    serveWrites({
      respond: () => Response.json({ errorMessages: ['Issue does not exist'] }, { status: 404 }),
    })
    const { code, error } = await runJson(set('Done'))
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
  })

  it('maps a Jira 400 on the transition to exit 2', async () => {
    serveWrites({
      respond: ({ method, path }) =>
        method === 'POST' && path.endsWith('/transitions')
          ? Response.json({ errors: { resolution: 'Resolution is required.' } }, { status: 400 })
          : undefined,
    })
    const { code, error } = await runJson(set('Hold'))
    expect(code).toBe(2)
    expect(error?.message).toContain('resolution: Resolution is required.')
  })

  it('exits 4 when logged out, before any request', async () => {
    const { requests } = serveWrites()
    const { code, error } = await runJson(set('Done'), { keychain: fakeSecurity().keychain })
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
    expect(requests).toEqual([])
  })

  it('exits 2 for a malformed key or a missing status, before any request', async () => {
    const { requests } = serveWrites()
    expect((await runJson(['status', 'set', '3066', 'Done'])).code).toBe(2)
    expect((await runJson(['status', 'set', KEY])).code).toBe(2)
    expect(requests).toEqual([])
  })
})
