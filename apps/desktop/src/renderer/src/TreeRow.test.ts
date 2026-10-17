import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { rowName, rowProgress } from './TreeRow'
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

  it('names the time values the chosen properties show, after the due date', () => {
    const timed = row({
      dueDate: '2026-10-14',
      originalEstimateSeconds: 36000,
      timeSpentSeconds: 9000,
      remainingEstimateSeconds: 27000,
    })
    expect(rowName(timed)).not.toContain('logged')
    expect(rowName(timed, ['due', 'estimate', 'logged', 'remaining', 'remainingPercent'])).toBe(
      'PSAPAC-11, Story, To Do, Draft the runbook, unassigned, due 2026-10-14, original estimate 10h, logged 2h 30m, remaining 7h 30m, remaining 75%',
    )
    expect(rowName(timed, ['logged'])).toMatch(/, logged 2h 30m$/)
  })

  it('names no time value for an issue without one, or for an Epic', () => {
    const empty = row({
      originalEstimateSeconds: null,
      timeSpentSeconds: null,
      remainingEstimateSeconds: null,
    })
    expect(rowName(empty, ['estimate', 'logged', 'remaining', 'remainingPercent'])).toBe(
      rowName(empty),
    )
    const epic = row({
      issueType: { id: '1', name: 'Epic', subtask: false, hierarchyLevel: 1 },
      originalEstimateSeconds: 3600,
    })
    expect(rowName(epic, ['estimate'])).toBe(rowName(epic))
  })

  it('puts the priority before the due date, both at the end', () => {
    const both = row({ priority: { id: '1', name: 'Highest' }, dueDate: '2026-10-14' })
    expect(rowName(both, ['due'])).toMatch(/, priority Highest, due 2026-10-14$/)
    expect(rowName(both, ['due'])).toMatch(/^PSAPAC-11,/)
  })

  it('names the open blockers before the priority, and only when there are some', () => {
    const held = row({ priority: { id: '2', name: 'High' } })
    expect(rowName(held, [], { blockedBy: 0, blocking: 0 })).toBe(rowName(held))
    expect(rowName(held, [], { blockedBy: 2, blocking: 1 })).toBe(
      'PSAPAC-11, Story, To Do, Draft the runbook, unassigned, blocked by 2 issues, blocking 1 issue, priority High',
    )
  })

  it('ends with the progress of a parent, after the priority and the due date', () => {
    const progress = { done: 2, total: 8 }
    expect(rowName(row({}), [], undefined, progress)).toBe(
      'PSAPAC-11, Story, To Do, Draft the runbook, unassigned, 2 of 8 done',
    )
    const all = row({ priority: { id: '2', name: 'High' }, dueDate: '2026-10-14' })
    expect(rowName(all, ['due'], undefined, progress)).toMatch(
      /, priority High, due 2026-10-14, 2 of 8 done$/,
    )
  })

  it('combines the blockers and the progress of a Story: blockers before the priority, progress last', () => {
    const story = row({ priority: { id: '2', name: 'High' }, dueDate: '2026-10-14' })
    expect(rowName(story, ['due'], { blockedBy: 2, blocking: 1 }, { done: 2, total: 8 })).toBe(
      'PSAPAC-11, Story, To Do, Draft the runbook, unassigned, blocked by 2 issues, blocking 1 issue, priority High, due 2026-10-14, 2 of 8 done',
    )
  })
})

describe('rowProgress', () => {
  const typed = (name: string, hierarchyLevel: number, subtask = false) =>
    row({ issueType: { id: '9', name, subtask, hierarchyLevel } })
  const entries = new Map([['PSAPAC-11', { done: 3, total: 8 }]])

  it('gives a Story with 8 sub-issues, 3 Done, "3 of 8 done" in its name', () => {
    const story = row({})
    expect(rowProgress(story, entries)).toEqual({ done: 3, total: 8 })
    expect(rowName(story, [], undefined, rowProgress(story, entries))).toMatch(/, 3 of 8 done$/)
  })

  it('gives a Task and a Bug with sub-issues the same', () => {
    // The guard reads hierarchyLevel, not the name: this pins Task and Bug at level 0 passing.
    for (const name of ['Task', 'Bug']) {
      expect(rowProgress(typed(name, 0), entries)).toEqual({ done: 3, total: 8 })
    }
  })

  it('gives an Epic none, though it has an entry', () => {
    expect(rowProgress(typed('Epic', 1), entries)).toBeUndefined()
  })

  it('gives a Subtask none', () => {
    expect(rowProgress(typed('Subtask', -1, true), entries)).toBeUndefined()
  })

  it('gives an issue with no sub-issues, and a row that is not an issue, none', () => {
    expect(rowProgress(row({ key: 'PSAPAC-12' }), entries)).toBeUndefined()
    expect(
      rowProgress({ kind: 'chip', doneCount: 2 } as unknown as TreeRow, entries),
    ).toBeUndefined()
  })
})
