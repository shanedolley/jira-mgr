import { writeFile } from 'node:fs/promises'

import { writeViews } from '@jira-mgr/core/state'
import { describe, expect, it } from 'vitest'

import { run } from '../../run.js'
import { COMMANDS } from '../../schema.js'
import { useEmptyState } from '../../test-auth.js'
import { fakeIo } from '../../test-io.js'
import { expectShape } from '../../test-shape.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'view list')

useEmptyState()

const BUGS = {
  id: 'bugs',
  name: 'Bugs',
  filters: { type: ['Bug'], status: ['To Do', 'In Progress'], text: 'login' },
  toggles: { hideDone: false, assigneeMe: true, hideEmptyCustomers: false },
}

describe('jm view list', () => {
  it('lists the starter views when no views file exists, with no client, Keychain or request', async () => {
    const f = fakeIo()
    // No client or Keychain is injected, and the command never asks for one.
    expect(await run(['view', 'list'], f.io)).toBe(0)
    const { data } = JSON.parse(f.stdout) as { data: { id: string; name: string }[] }
    expectShape(data, spec?.output.example)
    expect(data.map((v) => [v.id, v.name])).toEqual([
      ['my-issues', 'My issues'],
      ['current-sprint', 'Current sprint'],
    ])
    expect(f.stderr).toBe('')
  })

  it('lists the views in the file with their filters and toggles', async () => {
    await writeViews([BUGS])
    const f = fakeIo()
    expect(await run(['view', 'list'], f.io)).toBe(0)
    expect(JSON.parse(f.stdout)).toEqual({ data: [BUGS] })
  })

  it('prints a table of id, name and what each view sets on a terminal', async () => {
    await writeViews([
      BUGS,
      {
        id: 'plain',
        name: 'Plain',
        filters: {},
        toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
      },
    ])
    const f = fakeIo({ stdoutIsTTY: true, env: { NO_COLOR: '1' } })
    expect(await run(['view', 'list'], f.io)).toBe(0)
    const lines = f.stdout.split('\n')
    expect(lines[0]).toMatch(/^ID +NAME +FILTERS$/)
    expect(lines[1]).toMatch(
      /^bugs +Bugs +status=To Do,In Progress; type=Bug; text=login; mine; show done; empty customers$/,
    )
    expect(lines[2]).toMatch(/^plain +Plain *$/)
  })

  it('prints a note to stderr when every view is deleted', async () => {
    await writeViews([])
    const f = fakeIo({ stdoutIsTTY: true, env: { NO_COLOR: '1' } })
    expect(await run(['view', 'list'], f.io)).toBe(0)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('No saved views.\n')
    const piped = fakeIo()
    expect(await run(['view', 'list'], piped.io)).toBe(0)
    expect(JSON.parse(piped.stdout)).toEqual({ data: [] })
    expect(piped.stderr).toBe('')
  })

  it('exits 2 when the views file is not valid', async () => {
    await writeFile(`${process.env.JM_STATE_DIR ?? ''}/views.json`, '{"not":"an array"}')
    const f = fakeIo()
    expect(await run(['view', 'list'], f.io)).toBe(2)
    expect(JSON.parse(f.stdout)).toMatchObject({ error: { code: 'validation_failed' } })
  })
})
