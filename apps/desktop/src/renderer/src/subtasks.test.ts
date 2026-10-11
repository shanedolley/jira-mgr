import type { Issue } from '@jira-mgr/core'
import { describe, expect, it, vi } from 'vitest'

import type { CreatedIssue } from '../../shared/ipc'
import {
  MAX_NEW_SUBTASKS,
  MAX_TITLE,
  bulkNotice,
  createInOrder,
  parentProblem,
  parseTitles,
  progressOf,
  subtaskArgs,
  takesSubtasks,
  titlesProblem,
  withSubtask,
  type BulkResult,
} from './subtasks'

const TYPES = {
  Epic: { id: '9', name: 'Epic', subtask: false, hierarchyLevel: 1 },
  Story: { id: '10', name: 'Story', subtask: false, hierarchyLevel: 0 },
  Bug: { id: '11', name: 'Bug', subtask: false, hierarchyLevel: 0 },
  Subtask: { id: '13', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
}

function issue(type: keyof typeof TYPES, spec: Partial<Issue> = {}): Issue {
  return {
    id: '1',
    key: 'PSAPAC-4',
    summary: 'Parent',
    issueType: TYPES[type],
    status: { id: '1', name: 'To Do', category: 'new' },
    resolution: null,
    parentKey: null,
    assignee: null,
    labels: [],
    priority: null,
    customer: { id: '2', value: 'Beta Ltd' },
    engagement: { id: '8', value: 'South' },
    sprints: [],
    startDate: null,
    dueDate: null,
    created: '2026-10-01T00:00:00.000Z',
    updated: '2026-10-01T00:00:00.000Z',
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null,
    timeRemaining: null,
    ...spec,
  } as Issue
}

const created = (key: string, warning: string | null = null): CreatedIssue => ({
  key,
  issue: null,
  warning,
})

describe('parseTitles', () => {
  it('takes one title per line and ignores blank lines and the spaces around a title', () => {
    expect(parseTitles('  Draft the plan \n\n\t\nReview it\r\n   \r\nShip it\n')).toEqual([
      'Draft the plan',
      'Review it',
      'Ship it',
    ])
  })

  it('reads a bare carriage return as a line end and leaves list markers alone', () => {
    expect(parseTitles('- one\r2. two')).toEqual(['- one', '2. two'])
  })

  it('finds nothing in an empty or blank paste', () => {
    expect(parseTitles('')).toEqual([])
    expect(parseTitles(' \n \n')).toEqual([])
  })

  it('keeps a repeated title, since the user typed it twice', () => {
    expect(parseTitles('a\na')).toEqual(['a', 'a'])
  })
})

describe('takesSubtasks', () => {
  it('is true for a Story and a Bug, false for an Epic and for a Subtask', () => {
    expect(takesSubtasks(issue('Story'))).toBe(true)
    expect(takesSubtasks(issue('Bug'))).toBe(true)
    expect(takesSubtasks(issue('Epic'))).toBe(false)
    expect(takesSubtasks(issue('Subtask'))).toBe(false)
  })
})

describe('progressOf', () => {
  const sub = (key: string, done: boolean) => ({ key, summary: key, status: 'x', done })
  it('counts the done subtasks over all of them', () => {
    expect(progressOf([sub('a', true), sub('b', false), sub('c', true)])).toEqual({
      done: 2,
      total: 3,
    })
    expect(progressOf([])).toEqual({ done: 0, total: 0 })
  })
})

describe('titlesProblem and parentProblem', () => {
  it('accepts a list up to the limit and refuses one past it', () => {
    expect(titlesProblem(Array.from({ length: MAX_NEW_SUBTASKS }, (_, i) => `t${String(i)}`))).toBe(
      null,
    )
    expect(
      titlesProblem(Array.from({ length: MAX_NEW_SUBTASKS + 1 }, (_, i) => `t${String(i)}`)),
    ).toMatch(/at most 50 titles/)
  })

  it('refuses a title longer than a summary may be', () => {
    expect(titlesProblem(['x'.repeat(MAX_TITLE)])).toBeNull()
    expect(titlesProblem(['x'.repeat(MAX_TITLE + 1)])).toMatch(/longer than 255/)
  })

  it('names what a parent without a Customer or Engagement lacks', () => {
    expect(parentProblem(issue('Story'))).toBeNull()
    expect(parentProblem(issue('Story', { customer: null }))).toBe(
      'PSAPAC-4 needs its Customer set first.',
    )
    expect(parentProblem(issue('Story', { customer: null, engagement: null }))).toBe(
      'PSAPAC-4 needs its Customer and Engagement set first.',
    )
  })
})

describe('subtaskArgs', () => {
  it('asks for a Subtask under the parent with the parent Customer and Engagement', () => {
    expect(subtaskArgs(issue('Story'), 'Draft the plan')).toEqual({
      type: 'Subtask',
      summary: 'Draft the plan',
      parentKey: 'PSAPAC-4',
      customerId: '2',
      engagementId: '8',
    })
  })

  it('asks for nothing when the parent lacks either field', () => {
    expect(subtaskArgs(issue('Story', { engagement: null }), 'x')).toBeNull()
    expect(subtaskArgs(issue('Story', { customer: null }), 'x')).toBeNull()
  })
})

describe('createInOrder', () => {
  it('creates every title in the order given, one at a time', async () => {
    const order: string[] = []
    let running = 0
    let overlap = 0
    const create = vi.fn(async (title: string) => {
      running++
      overlap = Math.max(overlap, running)
      await Promise.resolve()
      order.push(title)
      running--
      return created(`K-${title}`)
    })
    const each = vi.fn<(title: string, created: CreatedIssue, done: number) => void>()
    const result = await createInOrder(['a', 'b', 'c'], create, each)
    expect(order).toEqual(['a', 'b', 'c'])
    expect(overlap).toBe(1)
    expect(result.failed).toBeNull()
    expect(result.left).toEqual([])
    expect(result.created.map(({ created: c }) => c.key)).toEqual(['K-a', 'K-b', 'K-c'])
    expect(each.mock.calls.map(([title, , done]) => [title, done])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
  })

  it('stops at the first refusal, keeps what was created and leaves the rest to retry', async () => {
    const create = vi.fn((title: string) =>
      title === 'c' ? Promise.reject(new Error('Jira said no.')) : Promise.resolve(created(title)),
    )
    const result = await createInOrder(['a', 'b', 'c', 'd', 'e'], create)
    expect(create.mock.calls.map(([title]) => title)).toEqual(['a', 'b', 'c'])
    expect(result.created.map(({ title }) => title)).toEqual(['a', 'b'])
    expect(result.failed).toEqual({ title: 'c', message: 'Jira said no.' })
    expect(result.left).toEqual(['c', 'd', 'e'])
  })

  it('never sends a created title again when the left titles are retried', async () => {
    const sent: string[] = []
    let refuse = true
    const create = (title: string) => {
      if (title === 'c' && refuse) return Promise.reject(new Error('no'))
      sent.push(title)
      return Promise.resolve(created(title))
    }
    const first = await createInOrder(['a', 'b', 'c', 'd'], create)
    refuse = false
    const second = await createInOrder(first.left, create)
    expect(second.failed).toBeNull()
    expect(sent).toEqual(['a', 'b', 'c', 'd'])
  })

  it('still counts a title as created when showing it throws, and never retries it', async () => {
    const create = vi.fn((title: string) => Promise.resolve(created(title)))
    const result = await createInOrder(['a', 'b', 'c'], create, (title) => {
      if (title === 'b') throw new Error('The cache refused it.')
    })
    expect(create).toHaveBeenCalledTimes(3)
    expect(result.created.map(({ title }) => title)).toEqual(['a', 'b', 'c'])
    expect(result.failed).toBeNull()
    expect(result.left).toEqual([])
  })

  it('creates nothing for an empty list', async () => {
    const create = vi.fn()
    expect(await createInOrder([], create)).toEqual({ created: [], failed: null, left: [] })
    expect(create).not.toHaveBeenCalled()
  })
})

describe('bulkNotice', () => {
  const ok = (title: string, warning: string | null = null) => ({
    title,
    created: created(`K-${title}`, warning),
  })

  it('says how many were created, with a plural that agrees', () => {
    const one: BulkResult = { created: [ok('a')], failed: null, left: [] }
    expect(bulkNotice('PSAPAC-4', one)).toEqual({
      title: 'Created 1 sub-issue under PSAPAC-4',
      notes: [],
      warned: false,
    })
    const five: BulkResult = {
      created: ['a', 'b', 'c', 'd', 'e'].map((t) => ok(t)),
      failed: null,
      left: [],
    }
    expect(bulkNotice('PSAPAC-4', five).title).toBe('Created 5 sub-issues under PSAPAC-4')
  })

  it('carries a read-back warning and stays until dismissed', () => {
    const result: BulkResult = {
      created: [ok('a', 'Created K-a, but could not read it back.')],
      failed: null,
      left: [],
    }
    expect(bulkNotice('PSAPAC-4', result)).toMatchObject({
      notes: ['Created K-a, but could not read it back.'],
      warned: true,
    })
  })

  it('names the title that failed, why, and how many were not tried', () => {
    const result: BulkResult = {
      created: [ok('a'), ok('b'), ok('c')],
      failed: { title: 'd', message: 'Jira said no.' },
      left: ['d', 'e'],
    }
    expect(bulkNotice('PSAPAC-4', result)).toEqual({
      title: 'Created 3 of 5 sub-issues under PSAPAC-4',
      notes: ['Could not create "d". Jira said no.', '1 more not tried.'],
      warned: true,
    })
  })

  it('says nothing was created when the first title fails', () => {
    const result: BulkResult = {
      created: [],
      failed: { title: 'a', message: 'No.' },
      left: ['a'],
    }
    expect(bulkNotice('PSAPAC-4', result)).toEqual({
      title: 'Could not create sub-issues under PSAPAC-4',
      notes: ['Could not create "a". No.'],
      warned: true,
    })
  })
})

describe('withSubtask', () => {
  const entry = { key: 'K-1', summary: 'One', status: 'To Do', done: false }
  const fresh = (key: string, category: 'new' | 'done') => ({
    key,
    summary: `S ${key}`,
    status: { id: '1', name: category === 'done' ? 'Done' : 'To Do', category },
  })

  it('adds the issue at the end, with its status and whether it is done', () => {
    expect(withSubtask([entry], fresh('K-2', 'new'))).toEqual([
      entry,
      { key: 'K-2', summary: 'S K-2', status: 'To Do', done: false },
    ])
    expect(withSubtask([], fresh('K-3', 'done'))[0]).toMatchObject({ status: 'Done', done: true })
  })

  it('replaces an entry with the same key rather than listing it twice', () => {
    expect(withSubtask([entry], fresh('K-1', 'done'))).toEqual([
      { key: 'K-1', summary: 'S K-1', status: 'Done', done: true },
    ])
  })
})
