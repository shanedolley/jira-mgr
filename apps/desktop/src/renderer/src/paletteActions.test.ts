import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import type { SavedView } from '../../shared/ipc'
import { defaultRow, matchingActions, matchingViews } from './paletteActions'

const TYPES = {
  Epic: { id: '9', name: 'Epic', subtask: false, hierarchyLevel: 1 },
  Story: { id: '10', name: 'Story', subtask: false, hierarchyLevel: 0 },
  Subtask: { id: '13', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
}

const issue = (type: keyof typeof TYPES) => ({ key: 'P-1', issueType: TYPES[type] }) as Issue

const labels = (target: Issue | null, query = '') =>
  matchingActions(target, query).map((a) => a.label)

const ALL = [
  'Assign',
  'Assign to me',
  'Change status',
  'Change priority',
  'Add labels',
  'Set sprint',
  'Create sub-issue',
  'Copy key',
  'Copy link',
  'Open in Jira',
]

describe('matchingActions', () => {
  it('lists every action of a Story, in order, and none without an issue', () => {
    expect(labels(issue('Story'))).toEqual(ALL)
    expect(labels(null)).toEqual([])
  })

  it('shows the key beside an action only when a shortcut runs it', () => {
    const keys = Object.fromEntries(matchingActions(issue('Story'), '').map((a) => [a.id, a.key]))
    expect(keys).toEqual({
      assignee: 'A',
      assignMe: 'I',
      status: 'S',
      priority: 'P',
      labels: 'L',
      sprint: undefined,
      subIssue: undefined,
      copyKey: 'Y',
      copyLink: 'U',
      openInJira: undefined,
    })
  })

  it('drops the actions its type cannot take: an Epic has no sprint or sub-issue, a Subtask no sprint', () => {
    expect(labels(issue('Epic'))).toEqual(
      ALL.filter((l) => l !== 'Set sprint' && l !== 'Create sub-issue'),
    )
    expect(labels(issue('Subtask'))).toEqual(
      ALL.filter((l) => l !== 'Set sprint' && l !== 'Create sub-issue'),
    )
  })

  it('narrows by label, needing every word, in any case', () => {
    expect(labels(issue('Story'), 'ASSIGN')).toEqual(['Assign', 'Assign to me'])
    expect(labels(issue('Story'), 'copy li')).toEqual(['Copy link'])
    expect(labels(issue('Story'), 'copy zzz')).toEqual([])
    expect(labels(issue('Story'), 'PSAPAC-12')).toEqual([])
  })
})

describe('matchingViews', () => {
  const views = [
    { id: 'a', name: 'Current sprint' },
    { id: 'b', name: 'My issues' },
  ] as SavedView[]

  it('matches the name, not the "Go to view" lead-in', () => {
    expect(matchingViews(views, '').map((v) => v.id)).toEqual(['a', 'b'])
    expect(matchingViews(views, 'view')).toEqual([])
    expect(matchingViews(views, 'go to')).toEqual([])
    expect(matchingViews(views, 'sprint').map((v) => v.id)).toEqual(['a'])
    expect(matchingViews(views, 'runbook')).toEqual([])
  })
})

describe('defaultRow', () => {
  it('takes the first issue when any is listed, so Enter opens an issue', () => {
    expect(defaultRow(['action', 'view'], ['issue 1', 'issue 2'])).toBe('issue 1')
    expect(defaultRow([], ['issue 1'])).toBe('issue 1')
  })

  it('takes the first action or view only when no issue is listed', () => {
    expect(defaultRow(['action', 'view'], [])).toBe('action')
    expect(defaultRow<string>([], [])).toBeUndefined()
  })
})
