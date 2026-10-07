import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { markdownToAdf } from '@jira-mgr/core/adf'
import { writeSettings } from '@jira-mgr/core/state'
import { JIRA_SITE, usePsapacState, type Recorded } from '@jira-mgr/core/test/msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { runJson, runTty } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'
import { ME, serveWrites } from '../../test-write.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'issue create')

usePsapacState()

const REQUIRED = ['--summary', 'Build the loader', '--customer', 'BHP', '--engagement']
const base = [...REQUIRED, 'AI Governance']
const create = (...args: string[]) => ['issue', 'create', ...args]

const BASE_FIELDS = {
  project: { key: 'PSAPAC' },
  summary: 'Build the loader',
  customfield_14849: { id: '16120' },
  customfield_14850: { id: '16450' },
}

/** The body of the one create request, or a failure when there was none. */
function created(requests: Recorded[]): unknown {
  const posts = requests.filter((r) => r.method === 'POST' && r.path === '/rest/api/3/issue')
  expect(posts).toHaveLength(1)
  return posts[0]?.body
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-create-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('jm issue create', () => {
  it('creates a Story, the default type, from names in any case', async () => {
    const { requests } = serveWrites()
    const { code, data, f } = await runJson(
      create('--summary', 'Build the loader', '--customer', 'bhp', '--engagement', 'ai governance'),
    )
    expect(code).toBe(0)
    expectShape(data, spec?.output.example)
    expect(data).toEqual({
      key: 'PSAPAC-14',
      id: '10050',
      url: `${JIRA_SITE}/browse/PSAPAC-14`,
    })
    expect(created(requests)).toEqual({ fields: { ...BASE_FIELDS, issuetype: { name: 'Story' } } })
    expect(f.stderr).toBe('')
  })

  it('takes a Customer and an Engagement by option id', async () => {
    const { requests } = serveWrites()
    const { code } = await runJson(
      create('--summary', 'Build the loader', '--customer', '16120', '--engagement', '16450'),
    )
    expect(code).toBe(0)
    expect(created(requests)).toMatchObject({ fields: BASE_FIELDS })
  })

  it.each(['Task', 'Bug', 'Story', 'Epic'])(
    'creates a %s with Customer and Engagement',
    async (type) => {
      const { requests } = serveWrites()
      const { code } = await runJson(create('--type', type.toLowerCase(), ...base))
      expect(code).toBe(0)
      expect(created(requests)).toEqual({ fields: { ...BASE_FIELDS, issuetype: { name: type } } })
    },
  )

  it.each(['Task', 'Bug'])(
    'refuses a %s with no Customer or no Engagement before any request',
    async (type) => {
      const { requests, meta } = serveWrites()
      const noCustomer = await runJson(
        create('--type', type, '--summary', 'x', '--engagement', 'AI Governance'),
      )
      const noEngagement = await runJson(
        create('--type', type, '--summary', 'x', '--customer', 'BHP'),
      )
      for (const result of [noCustomer, noEngagement]) {
        expect(result.code).toBe(2)
        expect(result.error?.code).toBe('validation_failed')
      }
      expect(noCustomer.error?.message).toContain('--customer')
      expect(noEngagement.error?.message).toContain('--engagement')
      expect([requests, meta]).toEqual([[], []])
    },
  )

  it('creates a Subtask under its parent', async () => {
    const { requests } = serveWrites()
    const { code } = await runJson(create('--type', 'Subtask', '--parent', 'psapac-3066', ...base))
    expect(code).toBe(0)
    expect(created(requests)).toEqual({
      fields: { ...BASE_FIELDS, issuetype: { name: 'Subtask' }, parent: { key: 'PSAPAC-3066' } },
    })
  })

  it('refuses a Subtask with no parent before any request', async () => {
    const { requests, meta } = serveWrites()
    const { code, error } = await runJson(create('--type', 'Subtask', ...base))
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toBe('A Subtask needs --parent.')
    expect([requests, meta]).toEqual([[], []])
  })

  it('refuses a type outside the five', async () => {
    const { requests } = serveWrites()
    expect((await runJson(create('--type', 'Initiative', ...base))).code).toBe(2)
    expect(requests).toEqual([])
  })

  it('sends every optional field in the shape Jira expects', async () => {
    const { requests } = serveWrites()
    const { code } = await runJson(
      create(
        ...base,
        '--priority',
        'minor',
        '--label',
        'etl',
        '--label',
        'loader',
        '--start',
        '2026-10-01',
        '--due',
        '2026-10-14',
        '--estimate',
        '1d4h',
        '--time-remaining',
        '6.5',
        '--description',
        'Load **all** the rows.',
        '--assignee',
        'me',
      ),
    )
    expect(code).toBe(0)
    expect(created(requests)).toEqual({
      fields: {
        ...BASE_FIELDS,
        issuetype: { name: 'Story' },
        priority: { id: '4' },
        labels: ['etl', 'loader'],
        customfield_13808: '2026-10-01',
        duedate: '2026-10-14',
        timetracking: { originalEstimate: '1d 4h' },
        customfield_21785: 6.5,
        description: markdownToAdf('Load **all** the rows.'),
        assignee: { accountId: ME },
      },
    })
    expect(requests.filter((r) => r.path === '/rest/api/3/myself')).toHaveLength(1)
  })

  it('refuses a bad date, duration or number before any request', async () => {
    const { requests, meta } = serveWrites()
    for (const flags of [
      ['--due', '14/10/2026'],
      ['--estimate', '1.5h'],
      ['--time-remaining', '-1'],
    ]) {
      expect((await runJson(create(...base, ...flags))).code).toBe(2)
    }
    expect([requests, meta]).toEqual([[], []])
  })
})

describe('jm issue create names', () => {
  it('lists every Customer for an unknown name and sends no create', async () => {
    const { requests } = serveWrites()
    const { code, error } = await runJson(
      create('--summary', 'x', '--customer', 'Nobody', '--engagement', 'AI Governance'),
    )
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toMatch(/^No Customer matches "Nobody"\. Choose one of: .*BHP \(16120\)/)
    expect((error?.details as { choices: unknown[] }).choices).toHaveLength(42)
    expect(requests).toEqual([])
  })

  it('lists the Engagements for an unknown Engagement', async () => {
    serveWrites()
    const { code, error } = await runJson(
      create('--summary', 'x', '--customer', 'BHP', '--engagement', 'Nope'),
    )
    expect(code).toBe(2)
    expect(error?.message).toMatch(
      /^No Engagement matches "Nope"\. Choose one of: AI Governance \(16450\)/,
    )
  })

  it('refuses a name that matches two options and lists those two', async () => {
    const { requests } = serveWrites({
      createmeta: {
        edit: (_type, fields) =>
          fields.map((field) => {
            if (field.key !== 'customfield_14849') return field
            const withValues = {
              ...field,
              allowedValues: [
                { id: '1', value: 'Acme' },
                { id: '2', value: 'ACME' },
                { id: '3', value: 'Other' },
              ],
            }
            return withValues
          }),
      },
    })
    const { code, error } = await runJson(
      create('--summary', 'x', '--customer', 'acme', '--engagement', 'AI Governance'),
    )
    expect(code).toBe(2)
    expect(error?.message).toBe(
      'More than one Customer matches "acme". Choose one of: Acme (1), ACME (2).',
    )
    expect(error?.details).toEqual({
      choices: [
        { id: '1', name: 'Acme' },
        { id: '2', name: 'ACME' },
      ],
    })
    expect(requests).toEqual([])
  })

  it('lists the priorities for an unknown priority', async () => {
    serveWrites()
    const { code, error } = await runJson(create(...base, '--priority', 'Urgentissimo'))
    expect(code).toBe(2)
    expect(error?.message).toMatch(
      /^No priority matches "Urgentissimo"\. Choose one of: .*Minor \(4\)/,
    )
  })

  it('passes an account id through without a search', async () => {
    const { requests } = serveWrites()
    const { code } = await runJson(create(...base, '--assignee', '5ce7d58b8ad0f60dca0108df'))
    expect(code).toBe(0)
    expect(created(requests)).toMatchObject({
      fields: { assignee: { accountId: '5ce7d58b8ad0f60dca0108df' } },
    })
    expect(requests.map((r) => r.path).filter((p) => p.includes('/user/'))).toEqual([])
  })

  it('searches for a name and assigns the one user it finds', async () => {
    const { requests } = serveWrites({
      respond: ({ path }) =>
        path.startsWith('/rest/api/3/user/assignable/search')
          ? Response.json([{ accountId: ME, displayName: 'Shane Dolley', active: true }])
          : undefined,
    })
    const { code } = await runJson(create(...base, '--assignee', 'Shane D'))
    expect(code).toBe(0)
    expect(requests.find((r) => r.path.includes('/user/assignable/search'))?.path).toContain(
      'query=Shane%20D',
    )
    expect(created(requests)).toMatchObject({ fields: { assignee: { accountId: ME } } })
  })

  it('refuses a name that matches several users or none', async () => {
    const users = [
      { accountId: ME, displayName: 'Shane Dolley', active: true },
      { accountId: '5ce7d58b8ad0f60dca0108df', displayName: 'Shane Other', active: true },
    ]
    for (const [found, message] of [
      [
        users,
        /^More than one user matches "Shane": Shane Dolley \(712020.*\), Shane Other \(5ce7.*\)\. Use an account id\.$/,
      ],
      [[], /^No assignable user matches "Shane"\.$/],
    ] as const) {
      const { requests } = serveWrites({
        respond: ({ path }) =>
          path.startsWith('/rest/api/3/user/assignable/search') ? Response.json(found) : undefined,
      })
      const { code, error } = await runJson(create(...base, '--assignee', 'Shane'))
      expect(code).toBe(2)
      expect(error?.message).toMatch(message)
      expect(requests.some((r) => r.method === 'POST')).toBe(false)
    }
  })
})

describe('jm issue create description', () => {
  it('converts Markdown to ADF', async () => {
    const { requests } = serveWrites()
    await runJson(create(...base, '--description', '# Plan\n\n- one\n- two'))
    const body = created(requests) as { fields: { description: unknown } }
    expect(body.fields.description).toEqual(markdownToAdf('# Plan\n\n- one\n- two'))
    expect(body.fields.description).toMatchObject({
      type: 'doc',
      version: 1,
      content: [{ type: 'heading' }, { type: 'bulletList' }],
    })
  })

  it('reads Markdown from a file and from stdin', async () => {
    const { requests } = serveWrites()
    const file = join(dir, 'bug.md')
    await writeFile(file, 'From a *file*.')
    expect((await runJson(create(...base, '--description-file', file))).code).toBe(0)
    const piped = await runJson(create(...base, '--description-file', '-'), undefined, {
      stdin: 'From **stdin**.',
    })
    expect(piped.code).toBe(0)
    const bodies = requests.filter((r) => r.method === 'POST').map((r) => r.body)
    expect(
      bodies.map((b) => (b as { fields: { description: unknown } }).fields.description),
    ).toEqual([markdownToAdf('From a *file*.'), markdownToAdf('From **stdin**.')])
  })

  it('sends the ADF in an --adf file as it is', async () => {
    const { requests } = serveWrites()
    const adf = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'panel',
          attrs: { panelType: 'info' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heads up' }] }],
        },
      ],
    }
    const file = join(dir, 'doc.json')
    await writeFile(file, JSON.stringify(adf))
    const { code } = await runJson(create(...base, '--adf', file))
    expect(code).toBe(0)
    expect(created(requests)).toMatchObject({ fields: { description: adf } })
  })

  it('reads --adf from stdin', async () => {
    const { requests } = serveWrites()
    const adf = markdownToAdf('Piped ADF')
    const { code } = await runJson(create(...base, '--adf', '-'), undefined, {
      stdin: JSON.stringify(adf),
    })
    expect(code).toBe(0)
    expect(created(requests)).toMatchObject({ fields: { description: adf } })
  })

  it('refuses an --adf file that is not JSON, or not an ADF document, before any write', async () => {
    const { requests } = serveWrites()
    const notJson = join(dir, 'a.json')
    const notDoc = join(dir, 'b.json')
    await writeFile(notJson, '{ nope')
    await writeFile(notDoc, JSON.stringify({ version: 2, type: 'doc', content: [] }))
    const first = await runJson(create(...base, '--adf', notJson))
    const second = await runJson(create(...base, '--adf', notDoc))
    expect(first.code).toBe(2)
    expect(first.error?.message).toBe('The --adf input is not valid JSON.')
    expect(second.code).toBe(2)
    expect(second.error?.message).toContain('not an ADF document')
    expect(requests).toEqual([])
  })

  it('refuses a missing file, a directory and an oversized file', async () => {
    const { requests } = serveWrites()
    const big = join(dir, 'big.md')
    await writeFile(big, 'x'.repeat(1024 * 1024 + 1))
    const sub = join(dir, 'folder')
    await mkdir(sub)
    const cases: [string, RegExp][] = [
      [join(dir, 'missing.md'), /^Cannot read .*missing\.md: no such file\.$/],
      [sub, /^Cannot read .*folder: it is not a regular file\.$/],
      [big, /^Cannot read .*big\.md: it is larger than 1 MiB\.$/],
    ]
    for (const [path, message] of cases) {
      const { code, error } = await runJson(create(...base, '--description-file', path))
      expect(code).toBe(2)
      expect(error?.code).toBe('validation_failed')
      expect(error?.message).toMatch(message)
    }
    expect((await runJson(create(...base, '--adf', join(dir, 'missing.json')))).code).toBe(2)
    expect(requests).toEqual([])
  })

  it('refuses two description inputs before any request', async () => {
    const { requests, meta } = serveWrites()
    const file = join(dir, 'd.md')
    await writeFile(file, 'x')
    for (const flags of [
      ['--description', 'x', '--description-file', file],
      ['--description', 'x', '--adf', file],
      ['--description-file', file, '--adf', file],
    ]) {
      const { code, error } = await runJson(create(...base, ...flags))
      expect(code).toBe(2)
      expect(error?.message).toMatch(/cannot be used with option/)
    }
    expect([requests, meta]).toEqual([[], []])
  })
})

describe('jm issue create output and failures', () => {
  it('prints the key and link on a terminal', async () => {
    serveWrites()
    const { code, f } = await runTty(create(...base))
    expect(code).toBe(0)
    expect(f.stdout).toBe(`Created PSAPAC-14  ${JIRA_SITE}/browse/PSAPAC-14\n`)
    expect(f.stderr).toBe('')
  })

  it('maps a Jira 400 to exit 2 naming the field', async () => {
    serveWrites({
      respond: ({ method, path }) =>
        method === 'POST' && path === '/rest/api/3/issue'
          ? Response.json(
              { errors: { customfield_14849: 'Customer is required.' } },
              { status: 400 },
            )
          : undefined,
    })
    const { code, error } = await runJson(create(...base))
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toContain('customfield_14849: Customer is required.')
    const tty = await runTty(create(...base))
    expect(tty.code).toBe(2)
    expect(tty.f.stdout).toBe('')
    expect(tty.f.stderr).toMatch(/^jm: .*customfield_14849: Customer is required\./)
  })

  it('exits 4 when logged out, before any request', async () => {
    const { requests, meta } = serveWrites()
    const { code, error } = await runJson(create(...base), { keychain: fakeSecurity().keychain })
    expect(code).toBe(4)
    expect(error?.code).toBe('permission_denied')
    expect([requests, meta]).toEqual([[], []])
  })

  it('exits 2 for a site in settings that is not Atlassian Cloud, before any request', async () => {
    const { requests, meta } = serveWrites()
    await writeSettings({ siteUrl: 'https://evil.example.com', projectKey: 'PSAPAC' })
    const { code, error } = await runJson(create(...base))
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect([requests, meta]).toEqual([[], []])
  })
})
