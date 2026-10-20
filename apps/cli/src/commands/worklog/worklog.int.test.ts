import { markdownToAdf } from '@jira-mgr/core/adf'
import { loadFixture, usePsapacState } from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { calls, forbidden, issueNotFound, serveExtras } from '../../test-extras.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = (id: string) => COMMANDS.find((c) => c.path.join(' ') === id)

usePsapacState()

const KEY = 'PSAPAC-666'
const WORKLOGS = `/rest/api/3/issue/${KEY}/worklog`
const AUTO = '?adjustEstimate=auto'
const ONE = `${WORKLOGS}/120440`

describe('jm worklog list', () => {
  it('lists the worklogs with their ids', async () => {
    const requests = serveExtras()
    const { code, data, f } = await runJson(['worklog', 'list', KEY])
    expect(code).toBe(0)
    expectShape(data, spec('worklog list')?.output.example)
    expect((data as { id: string; timeSpent: string }[]).map((w) => [w.id, w.timeSpent])).toEqual([
      ['120440', '1h'],
    ])
    expect(calls(requests)).toEqual([`GET ${WORKLOGS}?startAt=0&maxResults=50`])
    expect(f.stderr).toBe('')
  })

  it('reads an empty worklog comment as null', async () => {
    const [one] = (loadFixture('worklogs-psapac-666') as unknown as { worklogs: object[] }).worklogs
    serveExtras(({ method, path }) =>
      method === 'GET' && path.startsWith(WORKLOGS)
        ? Response.json({
            total: 1,
            worklogs: [{ ...one, comment: { version: 1, type: 'doc', content: [] } }],
          })
        : undefined,
    )
    const { code, data } = await runJson(['worklog', 'list', KEY])
    expect(code).toBe(0)
    expect((data as { comment: unknown }[]).map((w) => w.comment)).toEqual([null])
  })

  it('prints a table on a terminal', async () => {
    serveExtras()
    const { code, lines } = await runTty(['worklog', 'list', KEY])
    expect(code).toBe(0)
    expect(lines[0]).toMatch(/^ID +STARTED +TIME +AUTHOR +COMMENT$/)
    expect(lines[1]).toMatch(/^120440 {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2} {2}1h {2}/)
  })

  it('says so on stderr for an issue with no worklogs', async () => {
    serveExtras(({ method, path }) =>
      method === 'GET' && path.startsWith(WORKLOGS)
        ? Response.json({ total: 0, worklogs: [] })
        : undefined,
    )
    const { code, f } = await runTty(['worklog', 'list', KEY])
    expect(code).toBe(0)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('No worklogs.\n')
  })

  it('exits 3 for an issue that does not exist', async () => {
    serveExtras(issueNotFound)
    expect((await runJson(['worklog', 'list', KEY])).code).toBe(3)
  })
})

describe('jm worklog add', () => {
  it('logs a duration with adjustEstimate=auto and no other field', async () => {
    const requests = serveExtras()
    const { code, data, f } = await runJson(['worklog', 'add', KEY, '--time', '1h30m'])
    expect(code).toBe(0)
    expectShape(data, spec('worklog add')?.output.example)
    expect(calls(requests)).toEqual([`POST ${WORKLOGS}${AUTO}`])
    expect(requests[0]?.body).toEqual({ timeSpent: '1h 30m' })
    expect(f.stderr).toBe('')
  })

  it.each([
    ['90m', '90m'],
    ['1h 30m', '1h 30m'],
    ['1d2h', '1d 2h'],
  ])('reads the duration %s as %s', async (given, sent) => {
    const requests = serveExtras()
    expect((await runJson(['worklog', 'add', KEY, '--time', given])).code).toBe(0)
    expect(requests[0]?.body).toEqual({ timeSpent: sent })
  })

  it('refuses a decimal or missing duration before any request', async () => {
    const requests = serveExtras()
    expect((await runJson(['worklog', 'add', KEY, '--time', '1.5h'])).code).toBe(2)
    expect((await runJson(['worklog', 'add', KEY])).code).toBe(2)
    expect(requests).toEqual([])
  })

  it('sends --started as the UTC instant in the form the site wants', async () => {
    const requests = serveExtras()
    const { code } = await runJson([
      'worklog',
      'add',
      KEY,
      '--time',
      '2h',
      '--started',
      '2026-10-06T09:00:00+10:00',
    ])
    expect(code).toBe(0)
    expect(requests[0]?.body).toEqual({ timeSpent: '2h', started: '2026-10-05T23:00:00.000+0000' })
  })

  it('reads a local --started in the machine zone', async () => {
    const requests = serveExtras()
    await runJson(['worklog', 'add', KEY, '--time', '2h', '--started', '2026-10-06 09:00'])
    const sent = (requests[0]?.body as { started: string } | undefined)?.started
    expect(sent).toBe(new Date(2026, 9, 6, 9, 0).toISOString().replace('Z', '+0000'))
  })

  it('refuses a bad --started before any request', async () => {
    const requests = serveExtras()
    expect((await runJson(['worklog', 'add', KEY, '--time', '2h', '--started', 'soon'])).code).toBe(
      2,
    )
    expect(requests).toEqual([])
  })

  it('turns the --comment Markdown into ADF', async () => {
    const requests = serveExtras()
    const { code } = await runJson([
      'worklog',
      'add',
      KEY,
      '--time',
      '1h',
      '--comment',
      'Pair *work*',
    ])
    expect(code).toBe(0)
    expect(requests[0]?.body).toEqual({ timeSpent: '1h', comment: markdownToAdf('Pair *work*') })
    expect(requests[0]?.body).toEqual({
      timeSpent: '1h',
      comment: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Pair ' },
              { type: 'text', text: 'work', marks: [{ type: 'em' }] },
            ],
          },
        ],
      },
    })
  })

  it('prints the result on a terminal', async () => {
    serveExtras()
    const { code, f } = await runTty(['worklog', 'add', KEY, '--time', '1h'])
    expect(code).toBe(0)
    expect(f.stdout).toBe('Logged 1h (worklog 120440)\n')
  })

  it('exits 3 for an issue that does not exist', async () => {
    serveExtras(issueNotFound)
    expect((await runJson(['worklog', 'add', KEY, '--time', '1h'])).code).toBe(3)
  })
})

describe('jm worklog edit', () => {
  it('sends only the fields given, with adjustEstimate=auto', async () => {
    const requests = serveExtras()
    const { code, data } = await runJson(['worklog', 'edit', KEY, '120440', '--time', '2h'])
    expect(code).toBe(0)
    expectShape(data, spec('worklog edit')?.output.example)
    expect(calls(requests)).toEqual([`GET ${ONE}`, `PUT ${ONE}${AUTO}`])
    expect(requests[1]?.body).toEqual({ timeSpent: '2h' })
  })

  it('edits the start and the comment together', async () => {
    const requests = serveExtras()
    await runJson([
      'worklog',
      'edit',
      KEY,
      '120440',
      '--started',
      '2026-10-06T00:00:00Z',
      '--comment',
      'Redone',
    ])
    expect(requests[1]?.body).toEqual({
      started: '2026-10-06T00:00:00.000+0000',
      comment: markdownToAdf('Redone'),
    })
  })

  it('exits 2 when no field is given, before any request', async () => {
    const requests = serveExtras()
    const { code, error } = await runJson(['worklog', 'edit', KEY, '120440'])
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toContain('Nothing to change.')
    expect(requests).toEqual([])
  })

  it('prints the result on a terminal', async () => {
    serveExtras()
    const { f } = await runTty(['worklog', 'edit', KEY, '120440', '--time', '2h'])
    expect(f.stdout).toBe('Updated worklog 120440 (1h)\n')
  })

  it("maps the 403 on another user's worklog to exit 4", async () => {
    serveExtras(({ method }) => (method === 'PUT' ? forbidden() : undefined))
    const { code, error } = await runJson(['worklog', 'edit', KEY, '120440', '--time', '2h'])
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
  })

  it('exits 3 for a worklog that does not exist', async () => {
    serveExtras(issueNotFound)
    expect((await runJson(['worklog', 'edit', KEY, '1', '--time', '2h'])).code).toBe(3)
  })

  it('exits 3 for a worklog of another issue, with no write', async () => {
    const requests = serveExtras()
    const { code, error } = await runJson(['worklog', 'edit', KEY, '177190', '--time', '2h'])
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
    expect(calls(requests)).toEqual([`GET ${WORKLOGS}/177190`])
  })
})

describe('jm worklog delete', () => {
  it('deletes without --confirm, with adjustEstimate=auto', async () => {
    const requests = serveExtras()
    const { code, data } = await runJson(['worklog', 'delete', KEY, '120440'])
    expect(code).toBe(0)
    expectShape(data, spec('worklog delete')?.output.example)
    expect(data).toEqual({ key: KEY, worklogId: '120440' })
    expect(calls(requests)).toEqual([`GET ${ONE}`, `DELETE ${ONE}${AUTO}`])
  })

  it('prints the result on a terminal', async () => {
    serveExtras()
    const { f } = await runTty(['worklog', 'delete', KEY, '120440'])
    expect(f.stdout).toBe(`Deleted worklog 120440 from ${KEY}\n`)
  })

  it("maps the 403 on another user's worklog to exit 4", async () => {
    serveExtras(forbidden)
    const { code, error } = await runJson(['worklog', 'delete', KEY, '1'])
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
  })

  it('exits 3 for a worklog that does not exist', async () => {
    serveExtras(issueNotFound)
    expect((await runJson(['worklog', 'delete', KEY, '1'])).code).toBe(3)
  })

  it('exits 3 for a worklog of another issue, with no write', async () => {
    const requests = serveExtras()
    const { code, error } = await runJson(['worklog', 'delete', KEY, '177190'])
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
    expect(calls(requests)).toEqual([`GET ${WORKLOGS}/177190`])
  })
})

describe('worklog commands outside the project or logged out', () => {
  const foreign: [string, string[]][] = [
    ['add', ['worklog', 'add', 'OTHER-5', '--time', '1h']],
    ['edit', ['worklog', 'edit', 'OTHER-5', '1', '--time', '1h']],
    ['delete', ['worklog', 'delete', 'OTHER-5', '1']],
  ]

  it.each(foreign)('%s refuses a key outside PSAPAC with no request', async (_name, argv) => {
    const requests = serveExtras()
    const { code, error } = await runJson(argv)
    expect(code).toBe(2)
    expect(error?.message).toBe('OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.')
    expect(requests).toEqual([])
  })

  const loggedOut: [string, string[]][] = [
    ['list', ['worklog', 'list', KEY]],
    ['add', ['worklog', 'add', KEY, '--time', '1h']],
    ['edit', ['worklog', 'edit', KEY, '1', '--time', '1h']],
    ['delete', ['worklog', 'delete', KEY, '1']],
  ]

  it.each(loggedOut)('%s exits 4 when logged out, before any request', async (_name, argv) => {
    const requests = serveExtras()
    const { code, error } = await runJson(argv, { keychain: fakeSecurity().keychain })
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
    expect(requests).toEqual([])
  })
})
