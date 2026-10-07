import { serveCreatemeta, serveRecorded, usePsapacState } from '@jira-mgr/core/test/msw'
import { writeViews } from '@jira-mgr/core/state'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from '../../schema.js'
import { fakeSecurity } from '../../test-auth.js'
import { runJson, runTty, searchPhases, serveReads } from '../../test-read.js'
import { expectShape } from '../../test-shape.js'

const spec = COMMANDS.find((c) => c.path.join(' ') === 'issue tree')

usePsapacState()

interface Node {
  issue: { key: string }
  children: Node[]
  doneChildren: Node[]
  doneCount: number
  contextOnly: boolean
  customerMismatch: { own: { value: string } | null; epic: { value: string } | null } | null
}
interface Group {
  customer: { id: string; value: string } | null
  epics: Node[]
  noEpic: Node[]
}

const keysOf = (nodes: Node[]) => nodes.map((n) => n.issue.key)

async function tree(...args: string[]): Promise<Group[]> {
  const { code, data } = await runJson(['issue', 'tree', ...args])
  expect(code).toBe(0)
  return data as Group[]
}

describe('jm issue tree as JSON', () => {
  it('returns the Customer groups, Epics and children as core builds them', async () => {
    const requests = serveReads()
    const { code, data, f } = await runJson(['issue', 'tree'])
    expect(code).toBe(0)
    expectShape(data, spec?.output.example)
    const groups = data as Group[]
    expect(groups.map((g) => g.customer?.value)).toEqual([
      'BHP',
      'Maybank',
      'Sydney Water',
      'Collibra (Internal team)',
    ])
    const internal = groups[3]
    expect(keysOf(internal?.epics ?? [])).toEqual(['PSAPAC-3116', 'PSAPAC-3107', 'PSAPAC-3099'])
    expect(keysOf(internal?.epics[1]?.children ?? [])).toHaveLength(8)
    expect(keysOf(groups[0]?.noEpic ?? [])).toEqual(['PSAPAC-3122', 'PSAPAC-3120', 'PSAPAC-3118'])
    expect(f.stderr).toBe('')
    expect(searchPhases(requests)).toEqual(['unresolved', 'unresolved'])
  })

  it('marks a child whose Customer differs from its Epic’s', async () => {
    serveReads()
    const epic = (await tree())[3]?.epics.find((e) => e.issue.key === 'PSAPAC-3107')
    const woolworths = epic?.children.find((c) => c.issue.key === 'PSAPAC-3115')
    expect(woolworths?.customerMismatch).toMatchObject({
      own: { value: 'Woolworths' },
      epic: { value: 'Collibra (Internal team)' },
    })
    expect(epic?.customerMismatch).toBeNull()
    const sameCustomer = (await tree())[3]?.epics[0]?.children[0]
    expect(sameCustomer).toMatchObject({ issue: { key: 'PSAPAC-3117' }, customerMismatch: null })
  })

  it('a view keeps the ancestors of its matches as context only, and --mine asks for the user once', async () => {
    const requests = serveReads()
    const groups = await tree('--view', 'current-sprint')
    const internal = groups.find((g) => g.customer?.value === 'Collibra (Internal team)')
    expect(internal?.epics.map((e) => [e.issue.key, e.contextOnly])).toEqual([
      ['PSAPAC-3116', true],
      ['PSAPAC-3099', true],
    ])
    expect(keysOf(internal?.epics[1]?.children ?? [])).toEqual([
      'PSAPAC-3106',
      'PSAPAC-3105',
      'PSAPAC-3104',
    ])
    expect(requests.some((r) => r.path === '/rest/api/3/myself')).toBe(false)

    const mine = await tree('--mine')
    expect(mine.map((g) => g.customer?.value)).toEqual([
      'BHP',
      'Maybank',
      'Collibra (Internal team)',
    ])
    expect(requests.filter((r) => r.path === '/rest/api/3/myself')).toHaveLength(1)
  })

  it('a filter flag narrows the tree, keeping the ancestors of each match', async () => {
    serveReads()
    const groups = await tree('--status', 'In Progress')
    expect(groups.map((g) => g.customer?.value)).toEqual([
      'BHP',
      'Maybank',
      'Collibra (Internal team)',
    ])
    const epic = groups[2]?.epics[0]
    expect(epic).toMatchObject({ issue: { key: 'PSAPAC-3099' }, contextOnly: false })
    expect(keysOf(epic?.children ?? [])).toEqual(['PSAPAC-3104'])
  })

  describe('Done issues', () => {
    it('loads no Done issue when Done is hidden, so there are no Done chips', async () => {
      const requests = serveReads()
      const groups = await tree()
      expect(searchPhases(requests)).toEqual(['unresolved', 'unresolved'])
      const epics = groups.flatMap((g) => g.epics)
      expect(epics.every((e) => e.doneCount === 0 && e.doneChildren.length === 0)).toBe(true)
    })

    it('--show-done loads both phases and counts Done children behind a chip', async () => {
      const requests = serveReads()
      const groups = await tree('--show-done')
      expect(searchPhases(requests)).toEqual(['unresolved', 'unresolved', 'done', 'done'])
      const september = groups.flatMap((g) => g.epics).find((e) => e.issue.key === 'PSAPAC-3099')
      expect(september?.doneCount).toBe(4)
      expect(keysOf(september?.doneChildren ?? [])).toEqual([
        'PSAPAC-3103',
        'PSAPAC-3102',
        'PSAPAC-3101',
        'PSAPAC-3100',
      ])
      expect(keysOf(september?.children ?? [])).toEqual([
        'PSAPAC-3106',
        'PSAPAC-3105',
        'PSAPAC-3104',
      ])
    })

    it('a view that shows Done loads the done phase', async () => {
      const requests = serveReads()
      await writeViews([
        {
          id: 'all',
          name: 'All',
          filters: {},
          toggles: { hideDone: false, assigneeMe: false, hideEmptyCustomers: true },
        },
      ])
      await tree('--view', 'all')
      expect(searchPhases(requests)).toHaveLength(4)
    })
  })

  describe('--show-empty-customers', () => {
    it('adds a group for each Customer with no issue, from the Customer field options', async () => {
      serveReads()
      serveCreatemeta()
      const groups = await tree('--show-empty-customers')
      const names = groups.map((g) => g.customer?.value)
      expect(names).toContain('ACU')
      expect(names).toContain('Worley')
      const acu = groups.find((g) => g.customer?.value === 'ACU')
      expect(acu).toMatchObject({ epics: [], noEpic: [] })
      expect(groups.length).toBeGreaterThan(40)
    })

    it('never asks for the Customer options otherwise', async () => {
      const requests = serveReads()
      await tree()
      expect(requests.some((r) => r.path.includes('createmeta'))).toBe(false)
    })
  })
})

describe('jm issue tree on a terminal', () => {
  const wide = { columns: 200 }

  it('prints Customer, Epic, child and Subtask at two spaces a level', async () => {
    serveReads()
    const { code, lines, f } = await runTty(['issue', 'tree'], wide)
    expect(code).toBe(0)
    expect(lines).toContain('BHP')
    expect(lines).toContain('  No Epic')
    expect(lines).toContain('    PSAPAC-3122  Subtask  To Do        test')
    expect(lines).toContain('Collibra (Internal team)')
    expect(lines).toContain(
      '  PSAPAC-3116  Epic     To Do        Shane Dolley Administration & Sprint Activity',
    )
    expect(lines).toContain('    PSAPAC-3117  Story    To Do        Shane Dolley Admin - Sprint 36')
    expect(lines.at(-1)).toBe('')
    expect(f.stderr).toBe('')
  })

  it('pads the type to 7 characters and the status to the longest one shown', async () => {
    serveReads()
    const { lines } = await runTty(['issue', 'tree', '--status', 'To Do', '--type', 'Epic'], wide)
    // Only "To Do" is shown, so its column is 5 wide.
    expect(lines).toContain(
      '  PSAPAC-3116  Epic     To Do  Shane Dolley Administration & Sprint Activity',
    )
    const withProgress = await runTty(['issue', 'tree', '--type', 'Epic'], wide)
    expect(withProgress.lines).toContain(
      '  PSAPAC-3099  Epic     In Progress  Collibra PS Delivery Reports - September',
    )
    expect(withProgress.lines).toContain(
      '  PSAPAC-3107  Epic     To Do        Collibra PS Delivery Reports - October',
    )
  })

  it('prints the mismatch badge after the summary', async () => {
    serveReads()
    const { lines } = await runTty(['issue', 'tree'], wide)
    expect(lines).toContain(
      '    PSAPAC-3115  Story    To Do        WOW | Delivery Reporting - October  [Customer: Woolworths, Epic: Collibra (Internal team)]',
    )
    expect(lines.filter((l) => l.includes('[Customer:'))).toHaveLength(11)
    expect(lines.find((l) => l.includes('PSAPAC-3117'))).not.toContain('[')
  })

  it('prints a +N done chip under the parent, level with its children', async () => {
    serveReads()
    const { lines } = await runTty(['issue', 'tree', '--show-done'], wide)
    const at = lines.findIndex((l) => l.includes('PSAPAC-3104'))
    expect(lines[at + 1]).toBe('    +4 done')
    expect(lines.some((l) => l.includes('PSAPAC-3103'))).toBe(false)
  })

  it('ends a context-only row with (context) without colour, and does not for a match', async () => {
    serveReads()
    const { lines } = await runTty(['issue', 'tree', '--view', 'current-sprint'], wide)
    expect(lines).toContain(
      '  PSAPAC-3099  Epic     In Progress  Collibra PS Delivery Reports - September (context)',
    )
    expect(lines).toContain(
      '  PSAPAC-3116  Epic     To Do        Shane Dolley Administration & Sprint Activity (context)',
    )
    expect(lines.find((l) => l.includes('PSAPAC-3117'))).not.toContain('(context)')
  })

  it('dims a context-only row and colours the status and badge when colour is on', async () => {
    serveReads()
    const { f } = await runTty(['issue', 'tree', '--view', 'current-sprint'], {
      ...wide,
      env: { FORCE_COLOR: '1' },
    })
    const lines = f.stdout.split('\n')
    const epic = lines.find((l) => l.includes('PSAPAC-3099')) ?? ''
    expect(epic.startsWith('\u001b[2m  PSAPAC-3099 ')).toBe(true)
    expect(epic.endsWith('\u001b[22m')).toBe(true)
    expect(epic).not.toContain('(context)')
    expect(lines.find((l) => l.includes('PSAPAC-3104'))).toContain(
      '\u001b[34mIn Progress\u001b[39m',
    )
    expect(lines.find((l) => l.includes('PSAPAC-3104'))).toContain(
      '\u001b[33m  [Customer: IAG, Epic: Collibra (Internal team)]\u001b[39m',
    )
    expect(lines).toContain('\u001b[1mBHP\u001b[22m')
  })

  it('prints no colour under NO_COLOR, even when FORCE_COLOR is set', async () => {
    serveReads()
    const { f } = await runTty(['issue', 'tree', '--show-done'], {
      ...wide,
      env: { NO_COLOR: '1', FORCE_COLOR: '1' },
    })
    expect(f.stdout).not.toContain('\u001b')
  })

  it('truncates a summary to the terminal width but never the badge', async () => {
    serveReads()
    const { lines } = await runTty(['issue', 'tree'], { columns: 110 })
    const row = lines.find((l) => l.includes('PSAPAC-3115')) ?? ''
    expect(row).toContain(
      'WOW | Delivery Repo…  [Customer: Woolworths, Epic: Collibra (Internal team)]',
    )
    expect(lines.find((l) => l.includes('PSAPAC-3121'))?.length).toBeLessThanOrEqual(110)
  })

  it('prints a Customer with no issue as a bare heading', async () => {
    serveReads()
    serveCreatemeta()
    const { lines } = await runTty(['issue', 'tree', '--show-empty-customers'], wide)
    const at = lines.indexOf('ACU')
    expect(at).toBeGreaterThan(-1)
    expect(lines[at + 1]).not.toMatch(/^ /)
  })

  it('prints "No issues match." to stderr and nothing to stdout when the tree is empty', async () => {
    serveReads()
    const { code, f } = await runTty(['issue', 'tree', '--search', 'no such summary'])
    expect(code).toBe(0)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('No issues match.\n')
  })

  it('strips control characters from a Customer name', async () => {
    serveRecorded((request) =>
      request.path === '/rest/api/3/search/jql'
        ? Response.json({
            isLast: true,
            issues: [
              {
                id: '1',
                key: 'PSAPAC-1',
                fields: {
                  summary: 'Fix',
                  issuetype: { id: '1', name: 'Story', subtask: false, hierarchyLevel: 0 },
                  status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
                  labels: [],
                  customfield_14849: { id: '9', value: 'Eve\u001b[2J Corp' },
                  created: '2026-10-01T00:00:00.000+0000',
                  updated: '2026-10-01T00:00:00.000+0000',
                },
              },
            ],
          })
        : Response.json({}, { status: 500 }),
    )
    const { f } = await runTty(['issue', 'tree'])
    expect(f.stdout).not.toMatch(/\p{Cc}(?<!\n)/u)
    expect(f.stdout).toContain('Eve[2J Corp')
  })
})

describe('jm issue tree failures', () => {
  it('exits 3 for an unknown view', async () => {
    const requests = serveReads()
    const { code, error } = await runJson(['issue', 'tree', '--view', 'nope'])
    expect(code).toBe(3)
    expect(error?.code).toBe('not_found')
    expect(requests).toEqual([])
  })

  it('exits 4 when logged out', async () => {
    const requests = serveReads()
    const { code } = await runJson(['issue', 'tree'], { keychain: fakeSecurity().keychain })
    expect(code).toBe(4)
    expect(requests).toEqual([])
  })

  it('exits 5 on an error from the server', async () => {
    serveRecorded(() => Response.json({ errorMessages: ['boom'] }, { status: 500 }))
    const { code, error } = await runJson(['issue', 'tree'])
    expect(code).toBe(5)
    expect(error?.code).toBe('jira_error')
  })

  it('exits 5 when the Customer options cannot be read', async () => {
    serveReads()
    const { code } = await runJson(['issue', 'tree', '--show-empty-customers'])
    expect(code).toBe(5)
  })
})
