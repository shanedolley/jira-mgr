import { writeFile } from 'node:fs/promises'

import { serveRecorded, usePsapacState, JIRA_SITE } from '@jira-mgr/core/test/msw'
import { writeSettings, writeViews } from '@jira-mgr/core/state'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { runJson, runTty, searchPhases, SEARCH_PATH, serveReads } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'issue list')

const ME = '712020:16f8dbe7-f120-4043-bcaf-e06ef7156d34'
const NEXT_SPRINT = 'PS Sprint 38 (02 Nov-15 Nov)'

usePsapacState()

interface Row {
  key: string
  status: { name: string }
  assignee: { accountId: string } | null
  customer: { value: string } | null
  issueType: { name: string }
}

/** The keys `jm issue list <args>` returns, in order. */
async function keys(...args: string[]): Promise<string[]> {
  const { code, data } = await runJson(['issue', 'list', ...args])
  expect(code).toBe(0)
  return (data as Row[]).map((i) => i.key)
}

describe('jm issue list', () => {
  it('lists the recorded open issues as JSON and sends two search requests', async () => {
    const requests = serveReads()
    const { code, data, f } = await runJson(['issue', 'list'])
    expect(code).toBe(0)
    const issues = data as Row[]
    expect(issues).toHaveLength(20)
    expect(issues[0]).toMatchObject({ key: 'PSAPAC-3122', status: { name: 'To Do' } })
    expectShape(data, spec?.output.example)
    expect(f.stderr).toBe('')
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST ${SEARCH_PATH}`,
      `POST ${SEARCH_PATH}`,
    ])
  })

  describe('Done issues', () => {
    it('hides Done and never loads the done phase', async () => {
      const requests = serveReads()
      const found = await keys()
      expect(found).not.toContain('PSAPAC-3103')
      expect(searchPhases(requests)).toEqual(['unresolved', 'unresolved'])
    })

    it('--show-done loads both phases, four requests in all', async () => {
      const requests = serveReads()
      const found = await keys('--show-done')
      expect(found).toHaveLength(40)
      expect(found).toContain('PSAPAC-3103')
      expect(searchPhases(requests)).toEqual(['unresolved', 'unresolved', 'done', 'done'])
    })

    it('a view that shows Done loads both phases', async () => {
      const requests = serveReads()
      await writeViews([
        {
          id: 'all',
          name: 'Everything',
          filters: {},
          toggles: { hideDone: false, assigneeMe: false, hideEmptyCustomers: true },
        },
      ])
      expect(await keys('--view', 'all')).toHaveLength(40)
      expect(searchPhases(requests)).toHaveLength(4)
    })

    it('ignores the settings toggles, which hold the app’s last state', async () => {
      const requests = serveReads()
      await writeSettings({
        siteUrl: JIRA_SITE,
        projectKey: 'PSAPAC',
        toggles: { hideDone: false, assigneeMe: true, hideEmptyCustomers: false },
      })
      expect(await keys()).toHaveLength(20)
      expect(searchPhases(requests)).toEqual(['unresolved', 'unresolved'])
      expect(requests.some((r) => r.path === '/rest/api/3/myself')).toBe(false)
    })
  })

  describe('filters', () => {
    it('--status matches a name in any case', async () => {
      serveReads()
      expect(await keys('--status', 'in progress')).toEqual([
        'PSAPAC-3119',
        'PSAPAC-3118',
        'PSAPAC-3104',
        'PSAPAC-3099',
      ])
    })

    it('a repeated filter is an alternative, and filters on different fields all apply', async () => {
      serveReads()
      expect(await keys('--status', 'In Progress', '--type', 'Epic', '--type', 'Subtask')).toEqual([
        'PSAPAC-3118',
        'PSAPAC-3099',
      ])
    })

    it('--type matches a name', async () => {
      serveReads()
      expect(await keys('--type', 'Epic')).toEqual(['PSAPAC-3116', 'PSAPAC-3107', 'PSAPAC-3099'])
    })

    it('--label matches exactly and keeps nothing for an unknown label', async () => {
      serveReads()
      expect(await keys('--label', 'PSAPAC')).toHaveLength(20)
      expect(await keys('--label', 'psapac')).toEqual([])
    })

    it('--sprint takes a name, and `current` any active sprint', async () => {
      serveReads()
      expect(await keys('--sprint', NEXT_SPRINT)).toHaveLength(8)
      expect(await keys('--sprint', 'current')).toEqual([
        'PSAPAC-3122',
        'PSAPAC-3120',
        'PSAPAC-3119',
        'PSAPAC-3118',
        'PSAPAC-3117',
        'PSAPAC-3106',
        'PSAPAC-3105',
        'PSAPAC-3104',
      ])
    })

    it('--assignee takes an account id and `unassigned`', async () => {
      serveReads()
      expect(await keys('--assignee', ME)).toHaveLength(6)
      expect(await keys('--assignee', 'unassigned')).toEqual([])
    })

    it('--search matches the key and the summary in any case', async () => {
      serveReads()
      expect(await keys('--search', 'DELIVERY REPORTING - SEPTEMBER')).toEqual([
        'PSAPAC-3106',
        'PSAPAC-3105',
        'PSAPAC-3104',
      ])
      expect(await keys('--search', 'psapac-3122')).toEqual(['PSAPAC-3122'])
    })

    it('--limit stops paging once enough issues match', async () => {
      const requests = serveReads()
      expect(await keys('--limit', '3')).toEqual(['PSAPAC-3122', 'PSAPAC-3121', 'PSAPAC-3120'])
      expect(searchPhases(requests)).toEqual(['unresolved'])
    })

    it('--limit counts matches, not loaded issues, so it pages on until it has them', async () => {
      const requests = serveReads()
      expect(await keys('--limit', '2', '--status', 'In Progress')).toEqual([
        'PSAPAC-3119',
        'PSAPAC-3118',
      ])
      expect(searchPhases(requests)).toEqual(['unresolved'])
      const more = serveReads()
      expect(await keys('--limit', '3', '--status', 'In Progress')).toHaveLength(3)
      expect(searchPhases(more)).toEqual(['unresolved', 'unresolved'])
    })
  })

  describe('--mine and the current user', () => {
    it('--mine alone keeps your issues and asks for the current user once', async () => {
      const requests = serveReads()
      expect(await keys('--mine')).toHaveLength(6)
      expect(requests.filter((r) => r.path === '/rest/api/3/myself')).toHaveLength(1)
    })

    it('--mine with --assignee me still asks once', async () => {
      const requests = serveReads()
      expect(await keys('--mine', '--assignee', 'me')).toEqual([
        'PSAPAC-3122',
        'PSAPAC-3120',
        'PSAPAC-3119',
        'PSAPAC-3118',
        'PSAPAC-3117',
        'PSAPAC-3116',
      ])
      expect(requests.filter((r) => r.path === '/rest/api/3/myself')).toHaveLength(1)
    })

    it('--assignee me alone resolves to the same account', async () => {
      const requests = serveReads()
      expect(await keys('--assignee', 'ME')).toHaveLength(6)
      expect(requests.filter((r) => r.path === '/rest/api/3/myself')).toHaveLength(1)
    })

    it('does not ask for the current user when nothing needs it', async () => {
      const requests = serveReads()
      await keys('--status', 'To Do')
      expect(requests.some((r) => r.path === '/rest/api/3/myself')).toBe(false)
    })
  })

  describe('--view', () => {
    it('resolves the starter view by id and applies its toggles', async () => {
      const requests = serveReads()
      const found = await keys('--view', 'my-issues')
      expect(found).toHaveLength(6)
      expect(requests.filter((r) => r.path === '/rest/api/3/myself')).toHaveLength(1)
    })

    it('resolves a view by name in any case', async () => {
      serveReads()
      expect(await keys('--view', 'CURRENT SPRINT')).toHaveLength(8)
    })

    it('a filter flag replaces the view’s field', async () => {
      serveReads()
      expect(await keys('--view', 'current-sprint', '--sprint', NEXT_SPRINT)).toHaveLength(8)
      expect(await keys('--view', 'current-sprint', '--sprint', NEXT_SPRINT)).not.toContain(
        'PSAPAC-3122',
      )
      expect(await keys('--view', 'current-sprint', '--status', 'In Progress')).toHaveLength(3)
    })

    it('--search replaces the view’s text, and the view’s other filters still apply', async () => {
      serveReads()
      await writeViews([
        {
          id: 'reports',
          name: 'Reports',
          filters: { text: 'october', label: ['PSAPAC'] },
          toggles: { hideDone: true, assigneeMe: false, hideEmptyCustomers: true },
        },
      ])
      expect(await keys('--view', 'reports')).toHaveLength(9)
      expect(await keys('--view', 'reports', '--search', 'september')).toHaveLength(4)
    })

    it('--show-done turns Done on over a view that hides it', async () => {
      serveReads()
      expect(await keys('--view', 'current-sprint', '--show-done')).toHaveLength(8 + 3)
    })

    it('an unknown view exits 3 before any request', async () => {
      const requests = serveReads()
      const { code, error } = await runJson(['issue', 'list', '--view', 'nope'])
      expect(code).toBe(3)
      expect(error).toMatchObject({ code: 'not_found', message: 'No view "nope".' })
      expect(requests).toEqual([])
    })

    it('an invalid views file exits 2', async () => {
      serveReads()
      await writeFile(`${process.env.JM_STATE_DIR ?? ''}/views.json`, '{"not":"an array"}')
      const { code, error } = await runJson(['issue', 'list', '--view', 'my-issues'])
      expect(code).toBe(2)
      expect(error?.code).toBe('validation_failed')
    })
  })

  describe('on a terminal', () => {
    it('prints a table with the status, assignee and Customer of each issue', async () => {
      serveReads()
      const { code, lines, f } = await runTty(['issue', 'list', '--status', 'In Progress'])
      expect(code).toBe(0)
      expect(lines[0]).toMatch(/^KEY +TYPE +STATUS +ASSIGNEE +CUSTOMER +SUMMARY$/)
      expect(lines[1]).toMatch(
        /^PSAPAC-3119 +Story +In Progress +Shane Dolley +Maybank +MBBE - REA - Review CG …$/,
      )
      expect(lines).toHaveLength(6)
      expect(lines[5]).toBe('')
      expect(f.stderr).toBe('')
    })

    it('truncates the Customer at 24 characters and the summary to the width', async () => {
      serveReads()
      const { lines } = await runTty(['issue', 'list', '--search', 'PSAPAC-3111'], { columns: 100 })
      expect(lines[1]).toContain('TfNSW (Transport for NS…')
      const wide = lines[1] ?? ''
      expect(wide.length).toBeLessThanOrEqual(100)
      expect(wide.endsWith('…')).toBe(true)
    })

    it('colours the status by category, and not at all under NO_COLOR', async () => {
      serveReads()
      const colour = await runTty(['issue', 'list', '--show-done', '--search', 'PSAPAC-31'], {
        env: { FORCE_COLOR: '1' },
      })
      const rows = colour.lines.join('\n')
      expect(rows).toContain('\u001b[34mIn Progress\u001b[39m')
      expect(rows).toContain('\u001b[32mDone\u001b[39m')
      expect(rows).toMatch(/To Do {2}/)
      const plain = await runTty(['issue', 'list', '--show-done'], { env: { NO_COLOR: '1' } })
      expect(plain.f.stdout).not.toContain('\u001b')
    })

    it('prints nothing to stdout and "No issues match." to stderr when nothing matches', async () => {
      serveReads()
      const { code, f } = await runTty(['issue', 'list', '--assignee', 'unassigned'])
      expect(code).toBe(0)
      expect(f.stdout).toBe('')
      expect(f.stderr).toBe('No issues match.\n')
    })

    it('reports the issues loaded on stderr when stderr is a terminal', async () => {
      serveReads()
      const { f } = await runTty(['issue', 'list'], { stderrIsTTY: true })
      expect(f.stderr).toBe('Loaded 20 issues\n')
    })

    it('prints a dash for a missing assignee and a missing Customer', async () => {
      serveRecorded((request) =>
        request.path === SEARCH_PATH
          ? Response.json({
              isLast: true,
              issues: [
                {
                  id: '1',
                  key: 'PSAPAC-1',
                  fields: {
                    summary: 'Orphan',
                    issuetype: { id: '1', name: 'Story', subtask: false, hierarchyLevel: 0 },
                    status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
                    labels: [],
                    created: '2026-10-01T00:00:00.000+0000',
                    updated: '2026-10-01T00:00:00.000+0000',
                  },
                },
              ],
            })
          : Response.json({}, { status: 500 }),
      )
      const { lines } = await runTty(['issue', 'list'])
      expect(lines[1]).toMatch(/^PSAPAC-1 +Story +To Do +- +- +Orphan$/)
    })

    it('strips control characters from a summary', async () => {
      serveRecorded((request) => {
        if (request.path === SEARCH_PATH) {
          return Response.json({
            isLast: true,
            issues: [
              {
                id: '1',
                key: 'PSAPAC-1',
                fields: {
                  summary: 'Fix\u001b]0;pwned\u0007 it',
                  issuetype: { id: '1', name: 'Story', subtask: false, hierarchyLevel: 0 },
                  status: {
                    id: '1',
                    name: 'To Do',
                    statusCategory: { key: 'new' },
                  },
                  labels: [],
                  created: '2026-10-01T00:00:00.000+0000',
                  updated: '2026-10-01T00:00:00.000+0000',
                },
              },
            ],
          })
        }
        return Response.json({}, { status: 500 })
      })
      const { f } = await runTty(['issue', 'list'])
      expect(f.stdout).not.toMatch(/\p{Cc}(?<!\n)/u)
      expect(f.stdout).toContain('Fix]0;pwned it')
    })
  })

  describe('failures', () => {
    it('exits 4 when logged out, sending nothing', async () => {
      const requests = serveReads()
      const { code, error } = await runJson(['issue', 'list'], {
        keychain: fakeSecurity().keychain,
      })
      expect(code).toBe(4)
      expect(error?.code).toBe('permission_denied')
      expect(requests).toEqual([])
    })

    it('exits 4 when the token is refused', async () => {
      serveRecorded(() => Response.json({ errorMessages: ['no'] }, { status: 401 }))
      const { code, error } = await runJson(['issue', 'list'])
      expect(code).toBe(4)
      expect(error?.code).toBe('permission_denied')
    })

    it('exits 5 on an error from the server', async () => {
      serveRecorded(() => Response.json({ errorMessages: ['boom'] }, { status: 500 }))
      const { code, error } = await runJson(['issue', 'list'])
      expect(code).toBe(5)
      expect(error?.code).toBe('jira_error')
    })

    it('exits 5 on a search response that is not a search page', async () => {
      serveRecorded(() => Response.json({ surprise: true }))
      const { code, error } = await runJson(['issue', 'list'])
      expect(code).toBe(5)
      expect(error?.code).toBe('jira_error')
    })

    it('exits 2 on a bad --limit', async () => {
      const { code } = await runJson(['issue', 'list', '--limit', '0'])
      expect(code).toBe(2)
    })
  })
})
