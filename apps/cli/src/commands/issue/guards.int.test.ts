import { writeFields, writeSettings } from '@jira-mgr/core/state'
import { JIRA_SITE, usePsapacState } from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import { runJson, runTty } from '../../test-read.js'
import { issueType, serveWrites, withIssueFields } from '../../test-write.js'

usePsapacState()

const KEY = 'PSAPAC-3066'
const methods = (requests: { method: string }[]) => requests.map((r) => r.method)

describe('jm issue edit --type', () => {
  it.each([
    ['an', 'Epic'],
    ['a', 'Subtask'],
  ])(
    'refuses an issue that is %s %s, after the read and before any PUT',
    async (article, current) => {
      const { requests } = serveWrites({
        respond: withIssueFields({ issuetype: issueType(current) }),
      })
      const { code, error } = await runJson(['issue', 'edit', KEY, '--type', 'Task'])
      expect(code).toBe(2)
      expect(error?.code).toBe('validation_failed')
      expect(error?.message).toBe(
        `${KEY} is ${article} ${current}. The type can change only among Story, Task and Bug.`,
      )
      expect(methods(requests)).toEqual(['GET'])
    },
  )

  it.each(['Story', 'Task', 'Bug'])('reads the issue, then changes a %s', async (current) => {
    const { requests } = serveWrites({
      respond: withIssueFields({ issuetype: issueType(current) }),
    })
    const { code, data } = await runJson(['issue', 'edit', KEY, '--type', 'bug', '--summary', 'x'])
    expect(code).toBe(0)
    expect(data).toEqual({ key: KEY, changed: ['summary', 'type'] })
    expect(methods(requests)).toEqual(['GET', 'PUT'])
    expect(requests[1]?.body).toEqual({ fields: { summary: 'x', issuetype: { name: 'Bug' } } })
  })

  it('does not read the issue when --type is not given', async () => {
    const { requests } = serveWrites()
    await runJson(['issue', 'edit', KEY, '--summary', 'x'])
    expect(methods(requests)).toEqual(['PUT'])
  })

  it('refuses a change to Epic or Subtask before any request', async () => {
    const { requests } = serveWrites()
    for (const type of ['Epic', 'Subtask']) {
      expect((await runJson(['issue', 'edit', KEY, '--type', type])).code).toBe(2)
    }
    expect(requests).toEqual([])
  })
})

describe('commands refuse a key outside the configured project', () => {
  const commands: [string, string[]][] = [
    ['issue edit', ['issue', 'edit', 'OTHER-5', '--summary', 'x']],
    ['issue delete', ['issue', 'delete', 'OTHER-5', '--confirm', '--with-subtasks']],
    ['status set', ['status', 'set', 'OTHER-5', 'Done']],
  ]

  it.each(commands)('%s exits 2 with no request', async (_name, argv) => {
    const { requests, meta } = serveWrites()
    const { code, error } = await runJson(argv)
    expect(code).toBe(2)
    expect(error?.code).toBe('validation_failed')
    expect(error?.message).toBe('OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.')
    expect([requests, meta]).toEqual([[], []])
  })

  it.each(commands)('%s prints jm: and nothing on stdout on a terminal', async (_name, argv) => {
    serveWrites()
    const { code, f } = await runTty(argv)
    expect(code).toBe(2)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('jm: OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.\n')
  })

  it('treats a project key that only starts like the configured one as another project', async () => {
    const { requests } = serveWrites()
    const { code } = await runJson(['issue', 'edit', 'PSAPAC2-5', '--summary', 'x'])
    expect(code).toBe(2)
    expect(requests).toEqual([])
  })

  it('compares the project in any case', async () => {
    await writeSettings({ siteUrl: JIRA_SITE, projectKey: 'psapac' })
    await writeFields({
      site: JIRA_SITE,
      project: 'psapac',
      resolvedAt: '2026-10-07T00:00:00.000Z',
      ids: {
        customer: 'customfield_14849',
        engagement: 'customfield_14850',
        sprint: 'customfield_10600',
        startDate: 'customfield_13808',
        timeRemaining: 'customfield_21785',
      },
    })
    const { requests } = serveWrites()
    expect((await runJson(['issue', 'edit', KEY, '--summary', 'x'])).code).toBe(0)
    expect(methods(requests)).toEqual(['PUT'])
  })

  it('exits 4 when settings name no project, before any request', async () => {
    await writeSettings({ siteUrl: JIRA_SITE })
    const { requests, meta } = serveWrites()
    for (const [, argv] of commands) {
      const { code, error } = await runJson(argv)
      expect(code).toBe(4)
      expect(error?.code).toBe('permission_denied')
    }
    expect([requests, meta]).toEqual([[], []])
  })

  it('lets a key in the project through', async () => {
    const { requests } = serveWrites()
    expect((await runJson(['issue', 'edit', KEY, '--summary', 'x'])).code).toBe(0)
    expect(methods(requests)).toEqual(['PUT'])
  })
})

describe('terminal output strips control characters from keys', () => {
  it('strips them from the deleted subtask keys', async () => {
    serveWrites({
      respond: withIssueFields({
        subtasks: [
          {
            key: 'PSAPAC-3122\u001b]0;pwned\u0007',
            fields: { summary: 's', status: { name: 'To Do' } },
          },
        ],
      }),
    })
    const { code, f } = await runTty(['issue', 'delete', KEY, '--confirm', '--with-subtasks'])
    expect(code).toBe(0)
    expect(f.stdout).not.toMatch(/\p{Cc}(?<!\n)/u)
    expect(f.stdout).toBe(`Deleted ${KEY} and its subtasks PSAPAC-3122]0;pwned\n`)
  })
})

describe('--parent outside the configured project', () => {
  const message = 'OTHER-5 is not in PSAPAC. jm manages the PSAPAC project only.'
  const base = ['--summary', 'x', '--customer', 'BHP', '--engagement', 'AI Governance']

  it('refuses it on create with no request', async () => {
    const { requests, meta } = serveWrites()
    for (const type of ['Story', 'Subtask']) {
      const { code, error } = await runJson([
        'issue',
        'create',
        '--type',
        type,
        ...base,
        '--parent',
        'other-5',
      ])
      expect(code).toBe(2)
      expect(error?.code).toBe('validation_failed')
      expect(error?.message).toBe(message)
    }
    expect([requests, meta]).toEqual([[], []])
  })

  it('refuses it on edit with no request', async () => {
    const { requests, meta } = serveWrites()
    const { code, error } = await runJson(['issue', 'edit', KEY, '--parent', 'OTHER-5'])
    expect(code).toBe(2)
    expect(error?.message).toBe(message)
    expect([requests, meta]).toEqual([[], []])
  })

  it('exits 4 on create and edit when settings name no project', async () => {
    await writeSettings({ siteUrl: JIRA_SITE })
    const { requests, meta } = serveWrites()
    const create = await runJson(['issue', 'create', ...base, '--parent', 'PSAPAC-1'])
    const edit = await runJson(['issue', 'edit', KEY, '--parent', 'PSAPAC-1'])
    expect([create.code, edit.code]).toEqual([4, 4])
    expect([requests, meta]).toEqual([[], []])
  })

  it('lets a parent in the project through on create and edit', async () => {
    const { requests } = serveWrites()
    expect((await runJson(['issue', 'create', ...base, '--parent', 'PSAPAC-2832'])).code).toBe(0)
    expect((await runJson(['issue', 'edit', KEY, '--parent', 'PSAPAC-2832'])).code).toBe(0)
    expect(requests.filter((r) => r.method !== 'GET').map((r) => r.method)).toEqual(['POST', 'PUT'])
  })
})
