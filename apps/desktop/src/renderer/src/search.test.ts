import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { searchIssues } from './search'

function issue(key: string, summary: string, extra: Partial<Issue> = {}): Issue {
  return {
    key,
    summary,
    status: { id: '1', name: 'To Do', category: 'new' },
    updated: '2026-10-01T00:00:00.000Z',
    ...extra,
  } as Issue
}

const done = { status: { id: '3', name: 'Done', category: 'done' } } as const

const ISSUES = [
  issue('PSAPAC-12', 'Build the loader'),
  issue('PSAPAC-120', 'Export timeout'),
  issue('PSAPAC-7', 'Fix PSAPAC-12 follow up'),
  issue('PSAPAC-30', 'Migrate the dashboards', done),
]

const keys = (query: string, limit?: number) =>
  searchIssues(ISSUES, query, limit).shown.map((i) => i.key)

describe('searchIssues', () => {
  it('matches the key or the summary, in any case', () => {
    expect(keys('loader')).toEqual(['PSAPAC-12'])
    expect(keys('LOADER')).toEqual(['PSAPAC-12'])
    expect(keys('psapac-30')).toEqual(['PSAPAC-30'])
  })

  it('needs every word, in the key or the summary', () => {
    expect(keys('export timeout')).toEqual(['PSAPAC-120'])
    expect(keys('psapac-120 export')).toEqual(['PSAPAC-120'])
    expect(keys('export loader')).toEqual([])
  })

  it('ranks an exact key first, then a key prefix, then the rest', () => {
    expect(keys('psapac-12')).toEqual(['PSAPAC-12', 'PSAPAC-120', 'PSAPAC-7'])
  })

  it('takes a bare number as the end of a key', () => {
    expect(keys('7')).toEqual(['PSAPAC-7'])
  })

  it('lists open issues before Done ones, then the most recently updated', () => {
    const recent = [
      issue('P-1', 'a thing', { updated: '2026-10-01T00:00:00.000Z' }),
      issue('P-2', 'a thing', { updated: '2026-10-05T00:00:00.000Z' }),
      issue('P-3', 'a thing', { ...done, updated: '2026-10-09T00:00:00.000Z' }),
    ]
    expect(searchIssues(recent, 'thing').shown.map((i) => i.key)).toEqual(['P-2', 'P-1', 'P-3'])
  })

  it('lists everything, newest first, for an empty query', () => {
    expect(keys('  ')).toHaveLength(4)
  })

  it('caps the list and counts every match', () => {
    const result = searchIssues(ISSUES, 'psapac', 2)
    expect(result.shown).toHaveLength(2)
    expect(result.total).toBe(4)
  })

  it('finds nothing in an empty list', () => {
    expect(searchIssues([], 'x')).toEqual({ shown: [], total: 0 })
  })
})
