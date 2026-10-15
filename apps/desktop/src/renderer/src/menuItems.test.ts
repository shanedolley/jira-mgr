import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { allows, menuItems } from './menuItems'

const issue = (name: string, subtask = false): Issue =>
  ({
    key: 'PSAPAC-1',
    issueType: { name, subtask, hierarchyLevel: name === 'Epic' ? 1 : 0 },
  }) as Issue

const ids = (i: Issue) => menuItems(i).map((item) => item.id)

const ALL = [
  'open',
  'status',
  'assignee',
  'startDate',
  'dueDate',
  'sprint',
  'edit',
  'parent',
  'type',
  'labels',
  'priority',
  'estimate',
  'logWork',
  'related',
  'copy',
  'openInJira',
  'comment',
  'delete',
]

describe('the right-click menu items', () => {
  it('list the 18 actions of a Story, Task or Bug in order', () => {
    for (const type of ['Story', 'Task', 'Bug']) expect(ids(issue(type))).toEqual(ALL)
  })

  it('drop what an Epic cannot take: sprint, parent, type, original estimate and log work', () => {
    expect(ids(issue('Epic'))).toEqual(
      ALL.filter((id) => !['sprint', 'parent', 'type', 'estimate', 'logWork'].includes(id)),
    )
  })

  it('drop the sprint and the type change of a Subtask, which keeps its estimate and worklog', () => {
    expect(ids(issue('Subtask', true))).toEqual(
      ALL.filter((id) => id !== 'sprint' && id !== 'type'),
    )
  })

  it('show the key a shortcut runs the item by, and none for the rest', () => {
    const keys = Object.fromEntries(menuItems(issue('Story')).map((i) => [i.id, i.key]))
    expect(keys).toEqual({
      open: 'Enter',
      status: 'S',
      assignee: 'A',
      startDate: undefined,
      dueDate: 'Shift+D',
      sprint: 'Shift+C',
      edit: 'E',
      parent: 'Shift+P',
      type: undefined,
      labels: 'L',
      priority: 'P',
      estimate: 'Shift+E',
      logWork: undefined,
      related: undefined,
      copy: undefined,
      openInJira: undefined,
      comment: undefined,
      delete: undefined,
    })
  })

  it('answer whether one item is allowed', () => {
    expect(allows(issue('Story'), 'sprint')).toBe(true)
    expect(allows(issue('Epic'), 'sprint')).toBe(false)
  })
})
