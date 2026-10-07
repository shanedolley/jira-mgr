import { loadFixture, serveRecorded, usePsapacState } from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'link types')

usePsapacState()

const serveTypes = () => serveRecorded(() => Response.json(loadFixture('issuelinktype')))

describe('jm link types', () => {
  it('lists every link type with its id, name and both phrases', async () => {
    const requests = serveTypes()
    const { code, data, f } = await runJson(['link', 'types'])
    expect(code).toBe(0)
    expectShape(data, spec?.output.example)
    const types = data as { id: string; name: string; inward: string; outward: string }[]
    expect(types).toHaveLength(21)
    expect(types[0]).toEqual({
      id: '10000',
      name: 'Blocks',
      inward: 'is blocked by',
      outward: 'blocks',
    })
    expect(f.stderr).toBe('')
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /rest/api/3/issueLinkType'])
  })

  it('prints a table on a terminal with the phrases `jm link add` reads', async () => {
    serveTypes()
    const { code, lines, f } = await runTty(['link', 'types'])
    expect(code).toBe(0)
    expect(lines[0]).toMatch(/^ID +NAME +OUTWARD +INWARD$/)
    expect(lines.find((l) => l.startsWith('10000'))).toMatch(
      /^10000 +Blocks +blocks +is blocked by$/,
    )
    expect(lines).toHaveLength(23)
    expect(f.stderr).toBe('')
  })

  it('prints nothing to stdout and a note to stderr when the site has none', async () => {
    serveRecorded(() => Response.json({ issueLinkTypes: [] }))
    const { code, f } = await runTty(['link', 'types'])
    expect(code).toBe(0)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('No link types.\n')
  })

  it('strips control characters from a type name on a terminal', async () => {
    serveRecorded(() =>
      Response.json({
        issueLinkTypes: [{ id: '1', name: 'Bl\u001bcocks', inward: 'in', outward: 'out' }],
      }),
    )
    const { f } = await runTty(['link', 'types'])
    expect(f.stdout).not.toMatch(/\p{Cc}(?<!\n)/u)
    expect(f.stdout).toContain('Blcocks')
  })

  it('exits 4 when logged out', async () => {
    const requests = serveTypes()
    const { code, error } = await runJson(['link', 'types'], { keychain: fakeSecurity().keychain })
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
    expect(requests).toEqual([])
  })

  it('exits 5 on an error from the server and on an unexpected response', async () => {
    serveRecorded(() => Response.json({ errorMessages: ['boom'] }, { status: 500 }))
    expect((await runJson(['link', 'types'])).code).toBe(5)
    serveRecorded(() => Response.json({ surprise: true }))
    const { code, error } = await runJson(['link', 'types'])
    expect(code).toBe(5)
    expect(error?.code).toBe('jira_error')
  })
})
