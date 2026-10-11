import { writeFile } from 'node:fs/promises'

import { moveView, writeViews } from '@jira-mgr/core/state'
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
      ['created-by-me', 'Created by me'],
      ['current-sprint', 'Current sprint'],
      ['active', 'Active'],
      ['backlog', 'Backlog'],
    ])
    expect(f.stderr).toBe('')
  })

  it('lists the views in the file with their filters and toggles', async () => {
    await writeViews([BUGS])
    const f = fakeIo()
    expect(await run(['view', 'list'], f.io)).toBe(0)
    expect(JSON.parse(f.stdout)).toEqual({ data: [BUGS] })
  })

  it('lists the views in the order the app saved them', async () => {
    await writeViews([{ ...BUGS, id: 'z-last', name: 'Z' }, BUGS])
    await moveView('bugs', 0)
    const f = fakeIo()
    expect(await run(['view', 'list'], f.io)).toBe(0)
    const { data } = JSON.parse(f.stdout) as { data: { id: string }[] }
    expect(data.map((v) => v.id)).toEqual(['bugs', 'z-last'])
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

  it('keeps the new filter keys when it lists the file, and describes them in the table', async () => {
    const wide = {
      id: 'wide',
      name: 'Wide',
      filters: {
        customer: ['BHP'],
        creator: ['me'],
        dates: { due: 'overdue' as const },
        not: { status: ['Hold'], label: ['etl'] },
      },
      toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
    }
    await writeViews([wide])
    const json = fakeIo()
    expect(await run(['view', 'list'], json.io)).toBe(0)
    expect(JSON.parse(json.stdout)).toEqual({ data: [wide] })
    const tty = fakeIo({ stdoutIsTTY: true, env: { NO_COLOR: '1' } })
    expect(await run(['view', 'list'], tty.io)).toBe(0)
    expect(tty.stdout.split('\n')[1]).toMatch(
      /^wide +Wide +customer=BHP; creator=me; not\.status=Hold; not\.label=etl; due=overdue$/,
    )
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
