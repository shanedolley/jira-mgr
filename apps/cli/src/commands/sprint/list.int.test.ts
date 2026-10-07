import { loadFixture, serveRecorded, usePsapacState, type Recorded } from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'sprint list')

usePsapacState()

interface SprintRow {
  id: number
  name: string
  state: string
  startDate: string | null
  endDate: string | null
}

const page = (name: string) => loadFixture(name) as unknown as { values: unknown[]; total: number }

/** Answers the board and the sprint list from the recorded pages, each served as the only page. */
function serveSprints(board = 'board-psapac'): Recorded[] {
  return serveRecorded(({ path }) => {
    if (path.startsWith('/rest/agile/1.0/board?')) return Response.json(loadFixture(board))
    const all = !path.includes('state=')
    const body = page(all ? 'board-sprints-all' : 'board-sprints-active-future')
    return Response.json({ ...body, total: body.values.length })
  })
}

describe('jm sprint list', () => {
  it('lists the active sprint and the dated future sprints, asking only for those', async () => {
    const requests = serveSprints()
    const { code, data, f } = await runJson(['sprint', 'list'])
    expect(code).toBe(0)
    expectShape(data, spec?.output.example)
    const sprints = data as SprintRow[]
    expect(sprints[0]).toEqual({
      id: 10170,
      name: 'PS Sprint 36 (05 Oct-18 Oct)',
      state: 'active',
      startDate: '2026-10-05T23:32:56.296Z',
      endDate: '2026-10-18T14:00:00.000Z',
    })
    expect(sprints.map((s) => s.state)).toEqual([
      'active',
      ...Array<string>(sprints.length - 1).fill('future'),
    ])
    expect(f.stderr).toBe('')
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /rest/agile/1.0/board?projectKeyOrId=PSAPAC',
      'GET /rest/agile/1.0/board/1706/sprint?state=active,future&startAt=0&maxResults=50',
    ])
  })

  it('hides an undated future sprint such as PS TEMPLATES', async () => {
    serveSprints()
    const { data } = await runJson(['sprint', 'list'])
    const sprints = data as SprintRow[]
    expect(sprints).toHaveLength(49)
    expect(sprints.some((s) => s.name === 'PS TEMPLATES')).toBe(false)
    expect(sprints.every((s) => s.startDate !== null || s.endDate !== null)).toBe(true)
    // Jira did send it: the filter is the command's, not the fixture's.
    const sent = page('board-sprints-active-future').values as SprintRow[]
    expect(sent.some((s) => s.name === 'PS TEMPLATES')).toBe(true)
  })

  it('keeps an active sprint with no dates, and hides only a future one', async () => {
    serveRecorded(({ path }) =>
      path.startsWith('/rest/agile/1.0/board?')
        ? Response.json(loadFixture('board-psapac'))
        : Response.json({
            total: 3,
            values: [
              { id: 1, name: 'Active undated', state: 'active' },
              { id: 2, name: 'Future undated', state: 'future' },
              { id: 3, name: 'Future dated', state: 'future', startDate: '2026-11-01T00:00:00Z' },
            ],
          }),
    )
    const { data } = await runJson(['sprint', 'list'])
    expect((data as SprintRow[]).map((s) => s.name)).toEqual(['Active undated', 'Future dated'])
  })

  it('--all lists every sprint, closed and undated ones too', async () => {
    const requests = serveSprints()
    const { code, data } = await runJson(['sprint', 'list', '--all'])
    expect(code).toBe(0)
    const sprints = data as SprintRow[]
    expect(new Set(sprints.map((s) => s.state))).toEqual(new Set(['active', 'future', 'closed']))
    expect(sprints).toContainEqual(
      expect.objectContaining({ name: 'PS TEMPLATES', startDate: null, endDate: null }),
    )
    expect(requests[1]?.path).toBe('/rest/agile/1.0/board/1706/sprint?startAt=0&maxResults=50')
  })

  it('exits 3 when the project has no board that supports sprints', async () => {
    serveRecorded(() => Response.json({ values: [{ id: 1, name: 'Flow', type: 'kanban' }] }))
    const { code, error } = await runJson(['sprint', 'list'])
    expect(code).toBe(3)
    expect(error).toMatchObject({
      code: 'not_found',
      message: 'The project has no board that supports sprints.',
    })
  })

  describe('on a terminal', () => {
    const WHEN = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}`

    it('prints id, state, local start and end, and name', async () => {
      serveSprints()
      const { code, lines, f } = await runTty(['sprint', 'list'], { columns: 120 })
      expect(code).toBe(0)
      expect(lines[0]).toMatch(/^ID +STATE +START +END +NAME$/)
      expect(lines[1]).toMatch(
        new RegExp(String.raw`^10170 +active +${WHEN} +${WHEN} +PS Sprint 36 \(05 Oct-18 Oct\)$`),
      )
      expect(lines[2]).toMatch(/^10171 +future /)
      expect(lines).toHaveLength(51)
      expect(f.stderr).toBe('')
    })

    it('shows a dash for an undated sprint under --all', async () => {
      serveSprints()
      const { lines } = await runTty(['sprint', 'list', '--all'], { columns: 120 })
      expect(lines.find((l) => l.includes('PS TEMPLATES'))).toMatch(
        /^11993 +future +- +- +PS TEMPLATES$/,
      )
    })

    it('prints nothing to stdout and a note to stderr when no sprint shows', async () => {
      serveRecorded(({ path }) =>
        path.startsWith('/rest/agile/1.0/board?')
          ? Response.json(loadFixture('board-psapac'))
          : Response.json({ total: 1, values: [{ id: 9, name: 'PS TEMPLATES', state: 'future' }] }),
      )
      const { code, f } = await runTty(['sprint', 'list'])
      expect(code).toBe(0)
      expect(f.stdout).toBe('')
      expect(f.stderr).toBe('No sprints.\n')
    })

    it('strips control characters from a sprint name', async () => {
      serveRecorded(({ path }) =>
        path.startsWith('/rest/agile/1.0/board?')
          ? Response.json(loadFixture('board-psapac'))
          : Response.json({
              total: 1,
              values: [
                {
                  id: 9,
                  name: 'Sp\u001bcrint',
                  state: 'active',
                  startDate: '2026-10-05T00:00:00Z',
                },
              ],
            }),
      )
      const { f } = await runTty(['sprint', 'list'])
      expect(f.stdout).not.toMatch(/\p{Cc}(?<!\n)/u)
      expect(f.stdout).toContain('Spcrint')
    })
  })

  describe('failures', () => {
    it('exits 4 when logged out', async () => {
      const requests = serveSprints()
      const { code, error } = await runJson(['sprint', 'list'], {
        keychain: fakeSecurity().keychain,
      })
      expect(code).toBe(4)
      expect(error?.code).toBe('permission_denied')
      expect(requests).toEqual([])
    })

    it('exits 4 when the token is refused', async () => {
      serveRecorded(() => Response.json({ errorMessages: ['no'] }, { status: 403 }))
      expect((await runJson(['sprint', 'list'])).code).toBe(4)
    })

    it('exits 5 on an error from the server and on an unexpected response', async () => {
      serveRecorded(() => Response.json({ errorMessages: ['boom'] }, { status: 500 }))
      expect((await runJson(['sprint', 'list'])).code).toBe(5)
      serveRecorded(() => Response.json({ surprise: true }))
      const { code, error } = await runJson(['sprint', 'list'])
      expect(code).toBe(5)
      expect(error?.code).toBe('jira_error')
    })
  })
})
