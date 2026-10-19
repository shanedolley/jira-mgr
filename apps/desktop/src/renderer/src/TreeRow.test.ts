import type { Issue } from '@jira-mgr/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CommentsModalContext, badgeText, commentsName } from './commentsSlot'
import { LogWorkContext, loggedIssue } from './logWork'
import { CommentsCell, PriorityCell, Properties, rowName, rowProgress, TimeCell } from './TreeRow'
import type { TreeRow } from './tree'

function row(over: Partial<Issue>): TreeRow {
  const issue = {
    key: 'PSAPAC-11',
    summary: 'Draft the runbook',
    issueType: { id: '2', name: 'Story', subtask: false, hierarchyLevel: 0 },
    status: { id: '1', name: 'To Do', category: 'new' },
    assignee: null,
    priority: null,
    startDate: null,
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

  it('names the start date only while the Start property is on, before the due date', () => {
    const dated = row({ startDate: '2026-10-01', dueDate: '2026-10-14' })
    expect(rowName(dated)).not.toContain('start')
    expect(rowName(dated, ['due'])).not.toContain('start')
    expect(rowName(dated, ['start'])).toBe(
      'PSAPAC-11, Story, To Do, Draft the runbook, unassigned, start 2026-10-01',
    )
    expect(rowName(dated, ['start', 'due'])).toMatch(/, start 2026-10-01, due 2026-10-14$/)
    expect(rowName(row({}), ['start'])).not.toContain('start')
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
      'PSAPAC-11, Story, To Do, Draft the runbook, unassigned, due 2026-10-14, original estimate 10h, logged 2h 30m, remaining 7h 30m, remaining percent 75%',
    )
    expect(rowName(timed, ['logged'])).toMatch(/, logged 2h 30m$/)
  })

  it('names the full sprint and its end day while the Sprint property is on', () => {
    const sprinted = row({
      sprints: [{ id: 5, name: 'Sprint 5', state: 'active', endDate: '2026-10-14T00:00:00.000Z' }],
    })
    expect(rowName(sprinted)).not.toContain('sprint')
    expect(rowName(sprinted, ['sprint'])).toBe(
      'PSAPAC-11, Story, To Do, Draft the runbook, unassigned, sprint Sprint 5, ends 2026-10-14',
    )
    expect(rowName(row({ sprints: [] }), ['sprint'])).not.toContain('sprint')
  })

  it('names the properties in the order given, which is the Column header order', () => {
    const full = row({
      startDate: '2026-10-01',
      dueDate: '2026-10-14',
      originalEstimateSeconds: 36000,
      sprints: [{ id: 5, name: 'Sprint 5', state: 'active', endDate: '2026-10-14T00:00:00.000Z' }],
    })
    expect(rowName(full, ['due', 'estimate', 'sprint', 'start'])).toMatch(
      /, due 2026-10-14, original estimate 10h, sprint Sprint 5, ends 2026-10-14, start 2026-10-01$/,
    )
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

describe('the Logged slot', () => {
  const slot = (over: Partial<Issue>, provided = true) => {
    const { issue } = (row(over) as { node: { issue: Issue } }).node
    const cell = createElement(TimeCell, { issue, property: 'logged', always: false })
    return renderToStaticMarkup(
      provided ? createElement(LogWorkContext, { value: () => undefined }, cell) : cell,
    )
  }
  const story = { issueType: { id: '2', name: 'Story', subtask: false, hierarchyLevel: 0 } }

  it('is a Log work target for a Story, filled or empty, and keeps its value in the name', () => {
    expect(slot({ ...story, timeSpentSeconds: 1800 })).toContain(
      'aria-label="Log work on PSAPAC-11, Logged 30m"',
    )
    expect(slot({ ...story, timeSpentSeconds: null })).toContain(
      'aria-label="Log work on PSAPAC-11, nothing logged"',
    )
  })

  it('is a target on a Hold row, which stays loggable', () => {
    const hold = { id: '9', name: 'Hold', category: 'indeterminate' } as Issue['status']
    expect(slot({ ...story, status: hold, timeSpentSeconds: 1800 })).toContain('role="button"')
  })

  it('is no target on an Epic, or outside the Shell', () => {
    const epic = { id: '9', name: 'Epic', subtask: false, hierarchyLevel: 1 }
    expect(slot({ issueType: epic, timeSpentSeconds: 1800 })).not.toContain('role="button"')
    expect(slot({ ...story, timeSpentSeconds: 1800 }, false)).not.toContain('role="button"')
  })
})

describe('the Comments slot', () => {
  const slot = (over: Partial<Issue>, always = false, provided = true) => {
    const { issue } = (row(over) as { node: { issue: Issue } }).node
    const cell = createElement(CommentsCell, { issue, always })
    return renderToStaticMarkup(
      provided ? createElement(CommentsModalContext, { value: () => undefined }, cell) : cell,
    )
  }

  it('prints the count as a badge, the icon alone at 0 and 99+ from 100', () => {
    expect(badgeText(1)).toBe('1')
    expect(badgeText(99)).toBe('99')
    expect(badgeText(100)).toBe('99+')
    expect(badgeText(120)).toBe('99+')
    expect(slot({ commentCount: 0 })).not.toContain('data-badge')
    expect(slot({ commentCount: 3 })).toMatch(/data-badge="comments"[^>]*>3</)
    expect(slot({ commentCount: 120 })).toMatch(/data-badge="comments"[^>]*>99\+</)
  })

  it('states the number in its name, with the exact count past 99', () => {
    expect(commentsName(undefined)).toBe('Comments')
    expect(commentsName(0)).toBe('No comments')
    expect(commentsName(1)).toBe('1 comment')
    expect(commentsName(3)).toBe('3 comments')
    // The Sprint page's button carries the name; the Tree's span only a title, as the row's name has the count.
    expect(slot({ commentCount: 3 }, true)).toContain('aria-label="3 comments"')
    expect(slot({ commentCount: 120 }, true)).toContain('aria-label="120 comments"')
    expect(slot({ commentCount: 0 }, true)).toContain('aria-label="No comments"')
    expect(slot({ commentCount: 120 })).toContain('title="120 comments"')
    expect(slot({ commentCount: 0 })).toContain('title="No comments"')
    expect(slot({ commentCount: 3 })).not.toContain('aria-label')
  })

  it('draws a count not loaded yet as a dimmer bubble with no badge, named Comments', () => {
    for (const always of [false, true]) {
      const unloaded = slot({}, always)
      expect(unloaded).toContain('data-unloaded')
      expect(unloaded).toContain('opacity-40')
      expect(unloaded).not.toContain('data-badge')
      expect(unloaded).toContain(always ? 'aria-label="Comments"' : 'title="Comments"')
      expect(slot({ commentCount: 0 }, always)).not.toContain('data-unloaded')
    }
  })

  it('is a row-read target in the Tree, with no button role it cannot honour, and a button on the Sprint page', () => {
    expect(slot({ commentCount: 1 })).toContain('data-edit="comments"')
    expect(slot({ commentCount: 1 })).not.toContain('role="button"')
    const sprint = slot({ commentCount: 1 }, true)
    expect(sprint).toMatch(/^<button /)
    expect(sprint).not.toContain('data-edit')
  })

  it('is no target outside the Shell', () => {
    expect(slot({ commentCount: 1 }, false, false)).not.toContain('data-edit')
    expect(slot({ commentCount: 1 }, true, false)).not.toMatch(/^<button /)
  })

  it('joins the row name after the time values, only while the property is on and above 0', () => {
    const some = row({
      commentCount: 3,
      timeSpentSeconds: 1800,
      issueType: { name: 'Story', subtask: false, hierarchyLevel: 0 } as Issue['issueType'],
    })
    expect(rowName(some)).not.toContain('comment')
    expect(rowName(some, ['logged', 'comments'])).toMatch(/, logged 30m, 3 comments$/)
    expect(rowName(row({ commentCount: 0 }), ['comments'])).not.toContain('comment')
  })

  it('draws in the Properties strip in row order, after Remaining %', () => {
    const { issue } = (
      row({ commentCount: 2, labels: [], sprints: [] }) as { node: { issue: Issue } }
    ).node
    const strip = renderToStaticMarkup(
      createElement(Properties, {
        issue,
        properties: ['comments', 'due'],
        today: '2026-10-19',
      }),
    )
    expect(strip).toContain('data-prop="comments"')
  })
})

describe('loggedIssue', () => {
  const issue = (key: string, summary: string) => ({ key, summary }) as Issue

  it('prefers the Shell copy, which has the newest values', () => {
    const held = issue('PSAPAC-4', 'old')
    const current = issue('PSAPAC-4', 'new')
    expect(loggedIssue([issue('PSAPAC-3', 'x'), current], held)).toBe(current)
  })

  it('falls back to the issue the slot passed when the Shell does not list it', () => {
    const done = issue('PSAPAC-99', 'a Done sprint issue')
    expect(loggedIssue([issue('PSAPAC-3', 'x')], done)).toBe(done)
    expect(loggedIssue([], null)).toBeNull()
  })
})

describe('the priority slot', () => {
  const cell = (name: string | null) =>
    renderToStaticMarkup(
      createElement(PriorityCell, {
        priority: name === null ? null : { id: '1', name },
      }),
    )

  it('is a Pick target for the cell editor whether it draws bars, or is Medium or unset', () => {
    for (const name of ['High', 'Low', 'Medium', null]) {
      expect(cell(name)).toContain('data-pick="priority"')
      expect(cell(name)).toContain('title="Change priority"')
    }
  })

  it('draws bars only above or below Medium and keeps its 16px slot either way', () => {
    expect(cell('High')).toContain('data-glyph="priority"')
    expect(cell('Medium')).not.toContain('data-glyph="priority"')
    expect(cell(null)).not.toContain('data-glyph="priority"')
    for (const name of ['High', 'Medium', null]) {
      expect(cell(name)).toContain('data-slot="priority"')
      expect(cell(name)).toContain('size-4')
    }
  })
})

describe('the Sprint slot', () => {
  const slot = (over: Partial<Issue>, always = false, onEditCell?: () => void) => {
    const { issue } = (row({ labels: [], ...over }) as { node: { issue: Issue } }).node
    return renderToStaticMarkup(
      createElement(Properties, {
        issue,
        properties: ['sprint'],
        today: '2026-10-10',
        always,
        onEditCell,
      }),
    )
  }
  const sprints = [{ id: 5, name: 'Sprint 5', state: 'active', endDate: '2026-10-14T14:00:00Z' }]

  it('is a target on a Story, Task or Bug, and keeps the full name and end day in its title', () => {
    for (const name of ['Story', 'Task', 'Bug']) {
      const html = slot({
        issueType: { id: '2', name, subtask: false, hierarchyLevel: 0 },
        sprints,
      })
      expect(html).toContain('data-pick="sprint"')
      expect(html).toContain('title="Sprint 5, ends 2026-10-14"')
    }
  })

  it('is a target when empty, where it offers Set sprint', () => {
    const html = slot({ sprints: [] })
    expect(html).toContain('data-pick="sprint"')
    expect(html).toContain('title="Set sprint"')
  })

  it('is no target on an Epic or a Subtask, which have no sprint', () => {
    const epic = { id: '9', name: 'Epic', subtask: false, hierarchyLevel: 1 }
    const subtask = { id: '8', name: 'Subtask', subtask: true, hierarchyLevel: -1 }
    for (const issueType of [epic, subtask]) {
      expect(slot({ issueType, sprints: [] })).not.toContain('data-pick')
      expect(slot({ issueType, sprints: [] })).not.toContain('title=')
    }
  })

  it('is a button on the Sprint page, named by its value, with the full title back', () => {
    const html = slot({ sprints }, true, () => undefined)
    expect(html).toContain('<button')
    expect(html).toContain('data-pick="sprint"')
    expect(html).toContain('aria-label="Sprint of PSAPAC-11: Sprint 5"')
    expect(html).toContain('title="Sprint 5, ends 2026-10-14"')
    expect(slot({ sprints: [] }, true, () => undefined)).toContain(
      'aria-label="Sprint of PSAPAC-11: Backlog"',
    )
  })

  it('is a plain span on the Sprint page without an editor, and for an Epic or a Subtask', () => {
    expect(slot({ sprints }, true)).not.toMatch(/<button|data-pick/)
    const epic = { id: '9', name: 'Epic', subtask: false, hierarchyLevel: 1 }
    const subtask = { id: '8', name: 'Subtask', subtask: true, hierarchyLevel: -1 }
    for (const issueType of [epic, subtask]) {
      expect(slot({ issueType, sprints: [] }, true, () => undefined)).not.toMatch(
        /<button|data-pick/,
      )
    }
  })

  it('never nests a control inside another on the Sprint page', () => {
    expect(slot({ sprints }, true, () => undefined).match(/<button/g)).toHaveLength(1)
  })
})
