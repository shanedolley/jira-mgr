import { loadFixture, serveRecorded, usePsapacState } from '@jira-mgr/core/test/msw'
import { writeViews } from '@jira-mgr/core/state'
import { describe, expect, it } from 'vitest'

import { runJson, SEARCH_PATH } from '../../test-read.js'

usePsapacState()

const ME = '712020:16f8dbe7-f120-4043-bcaf-e06ef7156d34'
const OTHER = '712020:other'

interface RawIssue {
  key: string
  fields: Record<string, unknown>
}

interface Page {
  issues: RawIssue[]
}

const end = (key: string, category: string) => ({
  key,
  fields: { status: { statusCategory: { key: category } } },
})

/** Changes to the recorded issues, so each new filter has something to find. Keys not listed are left alone. */
const PATCHES: Record<string, Record<string, unknown>> = {
  'PSAPAC-3122': {
    creator: { accountId: ME, displayName: 'Shane Dolley' },
    duedate: '2000-01-05',
  },
  'PSAPAC-3121': {
    creator: { accountId: OTHER, displayName: 'Other' },
    issuelinks: [{ type: { name: 'Blocks' }, inwardIssue: end('PSAPAC-3120', 'indeterminate') }],
  },
  'PSAPAC-3120': {
    issuelinks: [{ type: { name: 'Blocks' }, outwardIssue: end('PSAPAC-3121', 'new') }],
  },
  'PSAPAC-3119': { duedate: '2999-01-01' },
}

/**
 * Serves the recorded issues, open and Done, with the patches applied (and `extra` over them) and
 * every other due date cleared.
 */
function serveEnriched(extra: Record<string, Record<string, unknown>> = {}): void {
  const page = (name: string): Page => {
    const raw = structuredClone(loadFixture(name)) as unknown as Page
    for (const issue of raw.issues) {
      issue.fields.duedate = null
      Object.assign(issue.fields, PATCHES[issue.key], extra[issue.key])
    }
    return raw
  }
  serveRecorded((request) => {
    if (request.path === '/rest/api/3/myself') return Response.json(loadFixture('myself'))
    if (request.path !== SEARCH_PATH) return new Response(null, { status: 500 })
    const body = request.body as { jql: string; nextPageToken?: string }
    const phase = body.jql.includes('!= Done') ? 'unresolved' : 'done'
    return body.nextPageToken === undefined
      ? Response.json(page(`search-${phase}-1`))
      : Response.json({ issues: page(`search-${phase}-2`).issues, isLast: true })
  })
}

const TOGGLES = { hideDone: true, assigneeMe: false, hideEmptyCustomers: true }

/** The keys `jm issue list --view` returns for these filters, with `args` after the view. */
async function viaView(filters: object, ...args: string[]): Promise<string[]> {
  await writeViews([{ id: 'v', name: 'V', filters, toggles: TOGGLES }])
  const { code, data } = await runJson(['issue', 'list', '--view', 'v', ...args])
  expect(code).toBe(0)
  return (data as { key: string }[]).map((i) => i.key)
}

describe('jm issue list, reading the new view filters back', () => {
  it('carries the creator and the links in the JSON', async () => {
    serveEnriched()
    const { data } = await runJson(['issue', 'list'])
    const issues = data as { key: string; creator: unknown; links: unknown[] }[]
    const blocked = issues.find((i) => i.key === 'PSAPAC-3121')
    expect(blocked?.creator).toEqual({ accountId: OTHER, displayName: 'Other' })
    expect(blocked?.links).toEqual([
      { type: 'Blocks', direction: 'inward', key: 'PSAPAC-3120', category: 'indeterminate' },
    ])
    expect(issues.find((i) => i.key === 'PSAPAC-3118')).toMatchObject({ creator: null, links: [] })
  })

  it('filters by Customer, Priority and Status type', async () => {
    serveEnriched()
    expect(await viaView({ customer: ['bhp'], statusType: ['new'] })).toEqual([
      'PSAPAC-3122',
      'PSAPAC-3120',
      'PSAPAC-3113',
      'PSAPAC-3105',
    ])
    expect(await viaView({ priority: ['Minor'], customer: ['Sydney Water'] })).toEqual([
      'PSAPAC-3121',
      'PSAPAC-3109',
    ])
    expect(await viaView({ priority: ['High'] })).toEqual([])
  })

  it('filters by Creator', async () => {
    serveEnriched()
    expect(await viaView({ creator: ['me'] })).toEqual(['PSAPAC-3122'])
    expect(await viaView({ creator: [OTHER] })).toEqual(['PSAPAC-3121'])
  })

  it('reads the Created by me starter back', async () => {
    serveEnriched()
    const { code, data } = await runJson(['issue', 'list', '--view', 'created-by-me'])
    expect(code).toBe(0)
    expect(data).toEqual([expect.objectContaining({ key: 'PSAPAC-3122' })])
  })

  it('filters by Epic, Subtasks included, and by Relations', async () => {
    serveEnriched()
    expect(await viaView({ epic: ['PSAPAC-3116'] })).toEqual(['PSAPAC-3117', 'PSAPAC-3116'])
    expect(await viaView({ relations: ['blocked'] })).toEqual(['PSAPAC-3121'])
    expect(await viaView({ relations: ['blocking'] })).toEqual(['PSAPAC-3120'])
  })

  it('lists the overdue issues, and the ones due in a window', async () => {
    serveEnriched()
    expect(await viaView({ dates: { due: 'overdue' } })).toEqual(['PSAPAC-3122'])
    expect(await viaView({ dates: { due: 'next-7-days' } })).toEqual([])
  })

  it('leaves out what not lists', async () => {
    serveEnriched()
    const all = await viaView({})
    const kept = await viaView({ not: { status: ['In Progress'], customer: ['BHP'] } })
    expect(kept).not.toContain('PSAPAC-3122')
    expect(kept).not.toContain('PSAPAC-3118')
    expect(kept).toContain('PSAPAC-3121')
    expect(kept.length).toBeLessThan(all.length)
    expect(await viaView({ not: { creator: ['me'] }, epic: ['PSAPAC-3116'] })).toEqual([
      'PSAPAC-3117',
      'PSAPAC-3116',
    ])
  })

  describe('the epic filter with a Subtask that arrives before its parents', () => {
    // Search runs by key, newest first. PSAPAC-3122, a Subtask, comes on page 1 of the open issues,
    // its Story PSAPAC-3112 on page 2 and the Epic PSAPAC-3107 after that.
    const underStory = { 'PSAPAC-3122': { parent: { key: 'PSAPAC-3112' } } }
    const EPIC_3107 = [
      'PSAPAC-3122',
      'PSAPAC-3115',
      'PSAPAC-3114',
      'PSAPAC-3113',
      'PSAPAC-3112',
      'PSAPAC-3111',
      'PSAPAC-3110',
      'PSAPAC-3109',
      'PSAPAC-3108',
      'PSAPAC-3107',
    ]

    it('finds the Subtask, whatever the page its Story is on', async () => {
      serveEnriched(underStory)
      expect(await viaView({ epic: ['PSAPAC-3107'] })).toEqual(EPIC_3107)
    })

    it('--limit takes the first matches in load order, the Subtask among them', async () => {
      serveEnriched(underStory)
      expect(await viaView({ epic: ['PSAPAC-3107'] }, '--limit', '1')).toEqual(['PSAPAC-3122'])
      expect(await viaView({ epic: ['PSAPAC-3107'] }, '--limit', '3')).toEqual(
        EPIC_3107.slice(0, 3),
      )
    })

    it('leaves the Subtask out under not.epic, with or without --limit', async () => {
      serveEnriched(underStory)
      const kept = await viaView({ not: { epic: ['PSAPAC-3107'] } }, '--limit', '2')
      expect(kept).toHaveLength(2)
      expect(kept).not.toContain('PSAPAC-3122')
      expect(await viaView({ not: { epic: ['PSAPAC-3107'] } })).not.toContain('PSAPAC-3122')
    })

    it('finds an open Subtask under a Done Story with Done hidden, and hides the Done Story', async () => {
      // PSAPAC-3103 is a Done Story under the open Epic PSAPAC-3099.
      serveEnriched({ 'PSAPAC-3122': { parent: { key: 'PSAPAC-3103' } } })
      expect(await viaView({ epic: ['PSAPAC-3099'] })).toEqual([
        'PSAPAC-3122',
        'PSAPAC-3106',
        'PSAPAC-3105',
        'PSAPAC-3104',
        'PSAPAC-3099',
      ])
      expect(await viaView({ epic: ['PSAPAC-3099'] }, '--limit', '1')).toEqual(['PSAPAC-3122'])
    })

    it('lists the Done issues of the Epic too under --show-done', async () => {
      serveEnriched({ 'PSAPAC-3122': { parent: { key: 'PSAPAC-3103' } } })
      expect(await viaView({ epic: ['PSAPAC-3099'] }, '--show-done')).toEqual(
        expect.arrayContaining(['PSAPAC-3122', 'PSAPAC-3103', 'PSAPAC-3102', 'PSAPAC-3100']),
      )
    })
  })
})
