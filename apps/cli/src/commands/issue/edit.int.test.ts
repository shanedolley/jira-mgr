import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { markdownToAdf } from '@jira-mgr/core/adf'
import { usePsapacState, type Recorded } from '@jira-mgr/core/test/msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'
import { ME, serveWrites } from '../../test-write.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'issue edit')

usePsapacState()

const PATH = '/rest/api/3/issue/PSAPAC-3066'
const edit = (...args: string[]) => ['issue', 'edit', 'PSAPAC-3066', ...args]

/** The body of the one PUT, or a failure when there was none. */
function put(requests: Recorded[]): unknown {
  const puts = requests.filter((r) => r.method === 'PUT')
  expect(puts).toHaveLength(1)
  expect(puts[0]?.path).toBe(PATH)
  return puts[0]?.body
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-edit-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('jm issue edit', () => {
  it('sends only the field given and reports it', async () => {
    const { requests } = serveWrites()
    const { code, data, f } = await runJson(edit('--summary', 'A better summary'))
    expect(code).toBe(0)
    expectShape(data, spec?.output.example)
    expect(data).toEqual({ key: 'PSAPAC-3066', changed: ['summary'] })
    expect(requests).toHaveLength(1)
    expect(put(requests)).toEqual({ fields: { summary: 'A better summary' } })
    expect(f.stderr).toBe('')
  })

  it('reads the key in any case', async () => {
    const { requests } = serveWrites()
    const { code, data } = await runJson(['issue', 'edit', 'psapac-3066', '--summary', 'x'])
    expect(code).toBe(0)
    expect((data as { key: string }).key).toBe('PSAPAC-3066')
    put(requests)
  })

  it.each([
    ['--assignee', 'me', { assignee: { accountId: ME } }, 'assignee'],
    [
      '--assignee',
      '5ce7d58b8ad0f60dca0108df',
      { assignee: { accountId: '5ce7d58b8ad0f60dca0108df' } },
      'assignee',
    ],
    ['--assignee', 'none', { assignee: null }, 'assignee'],
    ['--assignee', 'NONE', { assignee: null }, 'assignee'],
    ['--start', '2026-10-01', { customfield_13808: '2026-10-01' }, 'start'],
    ['--start', 'none', { customfield_13808: null }, 'start'],
    ['--due', '2026-10-14', { duedate: '2026-10-14' }, 'due'],
    ['--due', 'none', { duedate: null }, 'due'],
    ['--time-remaining', '6.5', { customfield_21785: 6.5 }, 'time-remaining'],
    ['--time-remaining', 'none', { customfield_21785: null }, 'time-remaining'],
    ['--priority', 'minor', { priority: { id: '4' } }, 'priority'],
    ['--priority', '4', { priority: { id: '4' } }, 'priority'],
    ['--parent', 'psapac-2832', { parent: { key: 'PSAPAC-2832' } }, 'parent'],
    ['--customer', 'bhp', { customfield_14849: { id: '16120' } }, 'customer'],
    ['--customer', '16120', { customfield_14849: { id: '16120' } }, 'customer'],
    ['--engagement', 'ai governance', { customfield_14850: { id: '16450' } }, 'engagement'],
    ['--type', 'task', { issuetype: { name: 'Task' } }, 'type'],
    ['--type', 'Bug', { issuetype: { name: 'Bug' } }, 'type'],
    ['--type', 'Story', { issuetype: { name: 'Story' } }, 'type'],
    ['--clear-description', undefined, { description: null }, 'description'],
    [
      '--description',
      'Fixed **it**.',
      { description: markdownToAdf('Fixed **it**.') },
      'description',
    ],
  ] as const)('%s %s sends one field', async (flag, value, fields, changed) => {
    const { requests } = serveWrites()
    const { code, data } = await runJson(edit(flag, ...(value === undefined ? [] : [value])))
    expect(code).toBe(0)
    expect(put(requests)).toEqual({ fields })
    expect((data as { changed: string[] }).changed).toEqual([changed])
  })

  it('edits the estimate through update, so the remaining estimate stays', async () => {
    const { requests } = serveWrites()
    const { code, data } = await runJson(edit('--estimate', '2d 4h'))
    expect(code).toBe(0)
    expect(put(requests)).toEqual({
      fields: {},
      update: { timetracking: [{ edit: { originalEstimate: '2d 4h' } }] },
    })
    expect((data as { changed: string[] }).changed).toEqual(['estimate'])
  })

  it('sends several changes in one request and lists each once', async () => {
    const { requests } = serveWrites()
    const { code, data } = await runJson(
      edit(
        '--assignee',
        'me',
        '--due',
        '2026-10-14',
        '--add-label',
        'etl',
        '--remove-label',
        'old',
      ),
    )
    expect(code).toBe(0)
    expect(put(requests)).toEqual({
      fields: { assignee: { accountId: ME }, duedate: '2026-10-14' },
      update: { labels: [{ add: 'etl' }, { remove: 'old' }] },
    })
    expect(data).toEqual({ key: 'PSAPAC-3066', changed: ['assignee', 'due', 'label'] })
  })

  it('resolves a name to one assignable user', async () => {
    const { requests } = serveWrites({
      respond: ({ path }) =>
        path.startsWith('/rest/api/3/user/assignable/search')
          ? Response.json([{ accountId: ME, displayName: 'Shane Dolley', active: true }])
          : undefined,
    })
    const { code } = await runJson(edit('--assignee', 'Shane Dolley'))
    expect(code).toBe(0)
    expect(put(requests)).toEqual({ fields: { assignee: { accountId: ME } } })
  })
})

describe('jm issue edit labels', () => {
  it('--label replaces the labels', async () => {
    const { requests } = serveWrites()
    const { code } = await runJson(edit('--label', 'a', '--label', 'b'))
    expect(code).toBe(0)
    expect(put(requests)).toEqual({ fields: { labels: ['a', 'b'] } })
  })

  it('--add-label adds and --remove-label removes, each repeatable', async () => {
    const { requests } = serveWrites()
    const added = await runJson(edit('--add-label', 'a', '--add-label', 'b'))
    const removed = await runJson(edit('--remove-label', 'c', '--remove-label', 'd'))
    expect([added.code, removed.code]).toEqual([0, 0])
    const bodies = requests.filter((r) => r.method === 'PUT').map((r) => r.body)
    expect(bodies).toEqual([
      { fields: {}, update: { labels: [{ add: 'a' }, { add: 'b' }] } },
      { fields: {}, update: { labels: [{ remove: 'c' }, { remove: 'd' }] } },
    ])
  })

  it('--label conflicts with --add-label and --remove-label, before any request', async () => {
    const { requests, meta } = serveWrites()
    for (const other of ['--add-label', '--remove-label']) {
      const { code, error } = await runJson(edit('--label', 'a', other, 'b'))
      expect(code).toBe(2)
      expect(error?.message).toMatch(/cannot be used with option/)
    }
    expect([requests, meta]).toEqual([[], []])
  })

  it('refuses a label with a space', async () => {
    const { requests } = serveWrites()
    const { code, error } = await runJson(edit('--add-label', 'two words'))
    expect(code).toBe(2)
    expect(error?.message).toContain('A label holds no spaces.')
    expect(requests).toEqual([])
  })
})

describe('jm issue edit type', () => {
  it.each(['Epic', 'Subtask', 'Initiative'])('refuses %s before any request', async (type) => {
    const { requests, meta } = serveWrites()
    const { code, error } = await runJson(edit('--type', type))
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toContain('Story, Task, Bug')
    expect([requests, meta]).toEqual([[], []])
  })
})

describe('jm issue edit description', () => {
  it('reads Markdown from a file and from stdin', async () => {
    const { requests } = serveWrites()
    const file = join(dir, 'd.md')
    await writeFile(file, 'From a *file*.')
    await runJson(edit('--description-file', file))
    await runJson(edit('--description-file', '-'), undefined, { stdin: 'From **stdin**.' })
    const bodies = requests.filter((r) => r.method === 'PUT').map((r) => r.body)
    expect(bodies).toEqual([
      { fields: { description: markdownToAdf('From a *file*.') } },
      { fields: { description: markdownToAdf('From **stdin**.') } },
    ])
  })

  it('sends a valid --adf file and refuses an invalid or missing one', async () => {
    const { requests } = serveWrites()
    const adf = markdownToAdf('Raw ADF')
    const good = join(dir, 'good.json')
    const bad = join(dir, 'bad.json')
    await writeFile(good, JSON.stringify(adf))
    await writeFile(bad, JSON.stringify({ type: 'paragraph' }))
    expect((await runJson(edit('--adf', good))).code).toBe(0)
    expect((await runJson(edit('--adf', bad))).code).toBe(2)
    expect((await runJson(edit('--adf', join(dir, 'none.json')))).code).toBe(2)
    expect(requests.filter((r) => r.method === 'PUT').map((r) => r.body)).toEqual([
      { fields: { description: adf } },
    ])
  })

  it('refuses two description inputs, and --clear-description beside one, before any request', async () => {
    const { requests, meta } = serveWrites()
    const file = join(dir, 'd.md')
    await writeFile(file, 'x')
    for (const flags of [
      ['--description', 'x', '--adf', file],
      ['--description', 'x', '--description-file', file],
      ['--clear-description', '--description', 'x'],
      ['--clear-description', '--adf', file],
    ]) {
      const { code, error } = await runJson(edit(...flags))
      expect(code).toBe(2)
      expect(error?.message).toMatch(/cannot be used with option/)
    }
    expect([requests, meta]).toEqual([[], []])
  })
})

describe('jm issue edit output and failures', () => {
  it('exits 2 with nothing to change, before any request', async () => {
    const { requests, meta } = serveWrites()
    const { code, error } = await runJson(edit())
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toContain('Nothing to change.')
    expect([requests, meta]).toEqual([[], []])
  })

  it('prints the changed fields on a terminal', async () => {
    serveWrites()
    const { code, f } = await runTty(edit('--assignee', 'none', '--due', '2026-10-14'))
    expect(code).toBe(0)
    expect(f.stdout).toBe('Updated PSAPAC-3066: assignee, due\n')
    expect(f.stderr).toBe('')
  })

  it('maps a Jira 400 to exit 2 naming the field', async () => {
    serveWrites({
      respond: ({ method }) =>
        method === 'PUT'
          ? Response.json(
              { errors: { customfield_21785: 'Field cannot be set. It is not on the screen.' } },
              { status: 400 },
            )
          : undefined,
    })
    const { code, error } = await runJson(edit('--time-remaining', '2'))
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toContain('customfield_21785: Field cannot be set.')
  })

  it('maps a Jira 404 to exit 3', async () => {
    serveWrites({
      respond: ({ method }) =>
        method === 'PUT'
          ? Response.json({ errorMessages: ['Issue does not exist'] }, { status: 404 })
          : undefined,
    })
    const { code, error } = await runJson(edit('--summary', 'x'))
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
  })

  it('refuses an unknown Customer, listing the choices, and sends nothing', async () => {
    const { requests } = serveWrites()
    const { code, error } = await runJson(edit('--customer', 'Nobody'))
    expect(code).toBe(2)
    expect(error?.message).toMatch(/^No Customer matches "Nobody"\. Choose one of: .*BHP \(16120\)/)
    expect(requests).toEqual([])
  })

  it('exits 4 when logged out, before any request', async () => {
    const { requests, meta } = serveWrites()
    const { code, error } = await runJson(edit('--customer', 'BHP'), {
      keychain: fakeSecurity().keychain,
    })
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
    expect([requests, meta]).toEqual([[], []])
  })

  it('exits 2 for a malformed key before any request', async () => {
    const { requests, meta } = serveWrites()
    expect((await runJson(['issue', 'edit', '3066', '--summary', 'x'])).code).toBe(2)
    expect((await runJson(['issue', 'edit', '--summary', 'x'])).code).toBe(2)
    expect([requests, meta]).toEqual([[], []])
  })
})
