import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { usePsapacState, type Recorded } from '@jira-mgr/core/test/msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runJson, runTty } from '../../test-read.js'
import { ME, serveWrites } from '../../test-write.js'

usePsapacState()

const base = ['--summary', 'x', '--customer', 'BHP', '--engagement', 'AI Governance']
const create = (...args: string[]) => ['issue', 'create', ...args]
const FIELDS = {
  summary: 'x',
  customfield_14849: { id: '16120' },
  customfield_14850: { id: '16450' },
}

const posts = (requests: Recorded[]) =>
  requests.filter((r) => r.method === 'POST' && r.path === '/rest/api/3/issue').map((r) => r.body)

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-create-input-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('jm issue create names', () => {
  /** Two Customers: one named "2", and one named "Two" whose id is "2". */
  const twoCustomers = {
    edit: (_type: string, fields: { key: string; name: string }[]) =>
      fields.map((field) => {
        if (field.key !== 'customfield_14849') return field
        const withValues = {
          ...field,
          allowedValues: [
            { id: '1', value: '2' },
            { id: '2', value: 'Two' },
          ],
        }
        return withValues
      }),
  }

  it('lets an option id win over another option named the same as that id', async () => {
    const { requests } = serveWrites({ createmeta: twoCustomers })
    const { code } = await runJson(
      create('--summary', 'x', '--customer', '2', '--engagement', 'AI Governance'),
    )
    expect(code).toBe(0)
    expect(posts(requests)).toMatchObject([{ fields: { customfield_14849: { id: '2' } } }])
  })

  it('falls back to the name when no id matches', async () => {
    const { requests } = serveWrites({ createmeta: twoCustomers })
    await runJson(create('--summary', 'x', '--customer', 'two', '--engagement', 'AI Governance'))
    expect(posts(requests)).toMatchObject([{ fields: { customfield_14849: { id: '2' } } }])
  })

  it('ignores spaces around a name or an id', async () => {
    const { requests } = serveWrites()
    const named = await runJson(
      create('--summary', 'x', '--customer', '  bhp ', '--engagement', ' AI Governance  '),
    )
    const byId = await runJson(
      create('--summary', 'x', '--customer', ' 16120 ', '--engagement', ' 16450 '),
    )
    expect([named.code, byId.code]).toEqual([0, 0])
    expect(posts(requests)).toMatchObject([{ fields: FIELDS }, { fields: FIELDS }])
  })

  it('reads me in any case, without searching for a user', async () => {
    const { requests } = serveWrites()
    const { code } = await runJson(create(...base, '--assignee', 'ME'))
    expect(code).toBe(0)
    expect(posts(requests)).toMatchObject([{ fields: { assignee: { accountId: ME } } }])
    expect(requests.some((r) => r.path.includes('/user/assignable/search'))).toBe(false)
  })
})

describe('jm issue create stdin, files and terminal output', () => {
  it('refuses stdin past 1 MiB before any write, and accepts exactly 1 MiB', async () => {
    const { requests } = serveWrites()
    const over = await runJson(create(...base, '--description-file', '-'), undefined, {
      stdin: 'x'.repeat(1024 * 1024 + 1),
    })
    expect(over.code).toBe(2)
    expect(over.error?.message).toBe('Stdin is larger than 1 MiB.')
    expect(posts(requests)).toEqual([])
    const exact = await runJson(create(...base, '--description-file', '-'), undefined, {
      stdin: 'x'.repeat(1024 * 1024),
    })
    expect(exact.code).toBe(0)
  })

  it('accepts a file of exactly 1 MiB', async () => {
    serveWrites()
    const file = join(dir, 'exact.md')
    await writeFile(file, 'x'.repeat(1024 * 1024))
    expect((await runJson(create(...base, '--description-file', file))).code).toBe(0)
  })

  it('strips control characters from a created key that cannot be read back, on a terminal', async () => {
    // The read-back refuses a key that is not an issue key, so the error names it.
    serveWrites({
      respond: ({ method, path }) =>
        method === 'POST' && path === '/rest/api/3/issue'
          ? Response.json({ id: '10050', key: 'PSAPAC-14\u001b]0;pwned\u0007' })
          : undefined,
    })
    const { code, f } = await runTty(create(...base))
    expect(code).toBe(5)
    expect(f.stdout).toBe('')
    expect(f.stderr).not.toMatch(/\p{Cc}(?<!\n)/u)
    expect(f.stderr).toContain('Created PSAPAC-14]0;pwned')
  })
})
