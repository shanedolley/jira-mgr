import { loadFixture, usePsapacState, type Recorded } from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { calls, forbidden, serveExtras } from '../../test-extras.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'sprint set')

usePsapacState()

const BOARD = 'GET /rest/agile/1.0/board?projectKeyOrId=PSAPAC'
const SPRINTS = 'GET /rest/agile/1.0/board/1706/sprint?state=active,future&startAt=0&maxResults=50'
const ACTIVE = 10170
const ACTIVE_NAME = 'PS Sprint 36 (05 Oct-18 Oct)'
const move = (id: number) => `POST /rest/agile/1.0/sprint/${String(id)}/issue`
const BACKLOG = 'POST /rest/agile/1.0/backlog/issue'

const keys = (n: number) => Array.from({ length: n }, (_, i) => `PSAPAC-${String(i + 1)}`)

describe('jm sprint set', () => {
  it('moves issues to the active sprint with `current`', async () => {
    const requests = serveExtras()
    const { code, data, f } = await runJson(['sprint', 'set', 'current', 'PSAPAC-12', 'psapac-13'])
    expect(code).toBe(0)
    expectShape(data, spec?.output.example)
    expect(data).toEqual({
      sprint: { id: ACTIVE, name: ACTIVE_NAME },
      keys: ['PSAPAC-12', 'PSAPAC-13'],
    })
    expect(calls(requests)).toEqual([BOARD, SPRINTS, move(ACTIVE)])
    expect(requests[2]?.body).toEqual({ issues: ['PSAPAC-12', 'PSAPAC-13'] })
    expect(f.stderr).toBe('')
  })

  it('finds a sprint by id', async () => {
    const requests = serveExtras()
    const { code, data } = await runJson(['sprint', 'set', '10171', 'PSAPAC-12'])
    expect(code).toBe(0)
    expect(data).toEqual({
      sprint: { id: 10171, name: 'PS Sprint 37 (19 Oct- 01 Nov)' },
      keys: ['PSAPAC-12'],
    })
    expect(requests[2]).toMatchObject({
      method: 'POST',
      path: '/rest/agile/1.0/sprint/10171/issue',
    })
  })

  it('finds a sprint by name in any case, with spaces around it', async () => {
    const requests = serveExtras()
    const { code, data } = await runJson([
      'sprint',
      'set',
      '  ps sprint 36 (05 OCT-18 oct) ',
      'PSAPAC-12',
    ])
    expect(code).toBe(0)
    expect(data).toMatchObject({ sprint: { id: ACTIVE } })
    expect(calls(requests)).toEqual([BOARD, SPRINTS, move(ACTIVE)])
  })

  it('moves to the backlog with `backlog`, in any case, without reading the board', async () => {
    const requests = serveExtras()
    const { code, data } = await runJson(['sprint', 'set', 'BackLog', 'PSAPAC-12', 'PSAPAC-13'])
    expect(code).toBe(0)
    expect(data).toEqual({ sprint: null, keys: ['PSAPAC-12', 'PSAPAC-13'] })
    expect(calls(requests)).toEqual([BACKLOG])
    expect(requests[0]?.body).toEqual({ issues: ['PSAPAC-12', 'PSAPAC-13'] })
  })

  it('exits 2 for an unknown sprint, listing the choices, with nothing moved', async () => {
    const requests = serveExtras()
    const { code, error } = await runJson(['sprint', 'set', 'Sprint 99', 'PSAPAC-12'])
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toMatch(
      /^No active or future sprint matches "Sprint 99"\. Choose one of: PS Sprint 36 \(05 Oct-18 Oct\) \(10170\), .* and \d+ more\.$/,
    )
    const choices = (error?.details as { choices: { id: number }[] }).choices
    expect(choices[0]).toEqual({ id: ACTIVE, name: ACTIVE_NAME, state: 'active' })
    expect(choices.length).toBeGreaterThan(40)
    expect(calls(requests)).toEqual([BOARD, SPRINTS])
  })

  it('refuses a closed sprint, which the active and future listing leaves out', async () => {
    const all = loadFixture('board-sprints-all') as unknown as {
      values: { id: number; state: string }[]
    }
    const closed = all.values.find((s) => s.state === 'closed')
    if (closed === undefined) throw new Error('The recorded sprints have no closed one.')
    const requests = serveExtras()
    const { code, error } = await runJson(['sprint', 'set', String(closed.id), 'PSAPAC-12'])
    expect(code).toBe(2)
    expect(error?.message).toContain('No active or future sprint matches')
    expect(calls(requests)).toEqual([BOARD, SPRINTS])
  })

  const sprintsOf =
    (values: object[]) =>
    ({ method, path }: Recorded) =>
      method === 'GET' && path.startsWith('/rest/agile/1.0/board/1706/sprint')
        ? Response.json({ total: values.length, values })
        : undefined
  const sprint = (id: number, name: string, state: string) => ({
    id,
    name,
    state,
    startDate: '2026-10-05T00:00:00.000Z',
    endDate: '2026-10-18T00:00:00.000Z',
  })

  it('exits 2 for `current` with two active sprints, listing them', async () => {
    const requests = serveExtras(
      sprintsOf([
        sprint(1, 'Alpha', 'active'),
        sprint(2, 'Beta', 'active'),
        sprint(3, 'Gamma', 'future'),
      ]),
    )
    const { code, error } = await runJson(['sprint', 'set', 'current', 'PSAPAC-12'])
    expect(code).toBe(2)
    expect(error?.message).toBe(
      'More than one sprint is active. Choose one of: Alpha (1), Beta (2).',
    )
    expect(error?.details).toEqual({
      choices: [
        { id: 1, name: 'Alpha', state: 'active' },
        { id: 2, name: 'Beta', state: 'active' },
      ],
    })
    expect(calls(requests)).toEqual([BOARD, SPRINTS])
  })

  it('exits 2 for `current` with no active sprint', async () => {
    serveExtras(sprintsOf([sprint(3, 'Gamma', 'future')]))
    const { code, error } = await runJson(['sprint', 'set', 'current', 'PSAPAC-12'])
    expect(code).toBe(2)
    expect(error?.message).toBe('No sprint is active. Choose one of: Gamma (3).')
  })

  it('exits 2 for a name two sprints share, listing both', async () => {
    serveExtras(sprintsOf([sprint(1, 'Twin', 'active'), sprint(2, 'twin', 'future')]))
    const { code, error } = await runJson(['sprint', 'set', 'TWIN', 'PSAPAC-12'])
    expect(code).toBe(2)
    expect(error?.message).toBe(
      'More than one sprint matches "TWIN". Choose one of: Twin (1), twin (2).',
    )
  })

  it('lets an id win over a sprint named with the same digits', async () => {
    const requests = serveExtras(
      sprintsOf([sprint(7, 'Seven', 'active'), sprint(8, '7', 'future')]),
    )
    const { code, data } = await runJson(['sprint', 'set', '7', 'PSAPAC-12'])
    expect(code).toBe(0)
    expect(data).toMatchObject({ sprint: { id: 7 } })
    expect(calls(requests).at(-1)).toBe(move(7))
  })

  it('exits 3 when the project has no board that supports sprints', async () => {
    serveExtras(({ method, path }) =>
      method === 'GET' && path.startsWith('/rest/agile/1.0/board?')
        ? Response.json({ values: [{ id: 1, name: 'Flow', type: 'kanban' }] })
        : undefined,
    )
    const { code, error } = await runJson(['sprint', 'set', 'current', 'PSAPAC-12'])
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
  })

  it('moves 50 keys in one request and refuses 51 before any request', async () => {
    const requests = serveExtras()
    const fifty = await runJson(['sprint', 'set', 'backlog', ...keys(50)])
    expect(fifty.code).toBe(0)
    expect((requests[0]?.body as { issues: string[] }).issues).toHaveLength(50)
    const before = requests.length
    const over = await runJson(['sprint', 'set', 'current', ...keys(51)])
    expect(over.code).toBe(2)
    expect(over.error?.message).toBe('Got 51 issue keys. Jira moves at most 50 at a time.')
    expect(requests).toHaveLength(before)
  })

  it('needs at least one key, before any request', async () => {
    const requests = serveExtras()
    expect((await runJson(['sprint', 'set', 'current'])).code).toBe(2)
    expect(requests).toEqual([])
  })

  it('prints the move on a terminal', async () => {
    serveExtras()
    const sprint = await runTty(['sprint', 'set', 'current', 'PSAPAC-12', 'PSAPAC-13'])
    expect(sprint.code).toBe(0)
    expect(sprint.f.stdout).toBe(`Moved PSAPAC-12, PSAPAC-13 to ${ACTIVE_NAME}\n`)
    const backlog = await runTty(['sprint', 'set', 'backlog', 'PSAPAC-12'])
    expect(backlog.f.stdout).toBe('Moved PSAPAC-12 to the backlog\n')
  })

  it('prints jm: and nothing on stdout for an unknown sprint on a terminal', async () => {
    serveExtras()
    const { code, f } = await runTty(['sprint', 'set', 'Sprint 99', 'PSAPAC-12'])
    expect(code).toBe(2)
    expect(f.stdout).toBe('')
    expect(f.stderr).toMatch(/^jm: No active or future sprint matches "Sprint 99"/)
  })

  it('maps a Jira 403 on the move to exit 4', async () => {
    serveExtras(({ method }) => (method === 'POST' ? forbidden() : undefined))
    const { code, error } = await runJson(['sprint', 'set', 'backlog', 'PSAPAC-12'])
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
  })
})

describe('jm sprint set outside the project or logged out', () => {
  it.each([
    ['the first key', ['PSAPAC-12', 'OTHER-5']],
    ['the only key', ['OTHER-5']],
  ])(
    'refuses %s outside PSAPAC with no request, for a sprint and for the backlog',
    async (_name, given) => {
      const requests = serveExtras()
      for (const target of ['current', 'backlog']) {
        const { code, error } = await runJson(['sprint', 'set', target, ...given])
        expect(code).toBe(2)
        expect(error?.message).toBe('OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.')
      }
      expect(requests).toEqual([])
    },
  )

  it.each(['current', 'backlog'])(
    'exits 4 when logged out, before any request: %s',
    async (target) => {
      const requests = serveExtras()
      const { code, error } = await runJson(['sprint', 'set', target, 'PSAPAC-12'], {
        keychain: fakeSecurity().keychain,
      })
      expect(code).toBe(4)
      expect(error?.code).toBe('permission_denied')
      expect(requests).toEqual([])
    },
  )
})
