import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { rowName } from './TreeRow'
import type { TreeRow } from './tree'

function row(over: Partial<Issue>): TreeRow {
  const issue = {
    key: 'PSAPAC-11',
    summary: 'Draft the runbook',
    issueType: { id: '2', name: 'Story', subtask: false, hierarchyLevel: 0 },
    status: { id: '1', name: 'To Do', category: 'new' },
    assignee: null,
    priority: null,
    dueDate: null,
    ...over,
  } as Issue
  return {
    kind: 'issue',
    node: { issue, contextOnly: false, customerMismatch: null },
  } as unknown as TreeRow
}

describe('rowName', () => {
  it('stays as it was for a Medium or missing priority and no due date', () => {
    const plain = 'PSAPAC-11, Story, To Do, Draft the runbook, unassigned'
    expect(rowName(row({}))).toBe(plain)
    expect(rowName(row({ priority: { id: '3', name: 'Medium' } }))).toBe(plain)
    expect(rowName(row({ priority: { id: '9', name: 'Question' } }))).toBe(plain)
  })

  it('ends with the priority when the glyph shows it', () => {
    expect(rowName(row({ priority: { id: '2', name: 'High' } }))).toBe(
      'PSAPAC-11, Story, To Do, Draft the runbook, unassigned, priority High',
    )
    expect(rowName(row({ priority: { id: '4', name: 'Low' } }))).toMatch(/, priority Low$/)
  })

  it('names the due date only while the Due property is on', () => {
    const due = row({ dueDate: '2026-10-14' })
    expect(rowName(due)).not.toContain('due')
    expect(rowName(due, ['updated'])).not.toContain('due')
    expect(rowName(due, ['due'])).toBe(
      'PSAPAC-11, Story, To Do, Draft the runbook, unassigned, due 2026-10-14',
    )
    expect(rowName(row({}), ['due'])).not.toContain('due')
  })

  it('puts the priority before the due date, both at the end', () => {
    const both = row({ priority: { id: '1', name: 'Highest' }, dueDate: '2026-10-14' })
    expect(rowName(both, ['due'])).toMatch(/, priority Highest, due 2026-10-14$/)
    expect(rowName(both, ['due'])).toMatch(/^PSAPAC-11,/)
  })
})
