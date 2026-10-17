import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import {
  assigneeAction,
  customerAction,
  issues,
  labelAction,
  namedKeys,
  planBatch,
  planBulk,
  priorityAction,
  refusedBatchNotice,
  sprintAction,
  statusAction,
} from './batch'

const TODO = { id: '1', name: 'To Do', category: 'new' } as const
const DONE = { id: '3', name: 'Done', category: 'done' } as const

const issue = (n: number, extra: Partial<Issue> = {}) =>
  ({
    id: `10${String(n)}`,
    key: `P-${String(n)}`,
    status: TODO,
    assignee: null,
    priority: { id: '3', name: 'Medium' },
    customer: { id: '1', value: 'Acme' },
    labels: [],
    sprints: [],
    ...extra,
  }) as Issue

const keys = (count: number) => Array.from({ length: count }, (_, n) => `P-${String(n + 1)}`)

describe('namedKeys', () => {
  it('names one, two and up to five keys in full', () => {
    expect(namedKeys(keys(1))).toBe('P-1')
    expect(namedKeys(keys(2))).toBe('P-1 and P-2')
    expect(namedKeys(keys(5))).toBe('P-1, P-2, P-3, P-4 and P-5')
  })

  it('names five of more, and counts the rest', () => {
    expect(namedKeys(keys(6))).toBe('P-1, P-2, P-3, P-4, P-5 and 1 more')
    expect(namedKeys(keys(12))).toBe('P-1, P-2, P-3, P-4, P-5 and 7 more')
  })
})

describe('refusedBatchNotice', () => {
  it('stays until dismissed, counts the issues, names each skipped key and says why the first was', () => {
    const notice = refusedBatchNotice('Status', [
      { key: 'P-3', reason: 'No transition to Done.' },
      { key: 'P-4', reason: 'Jira skipped it.' },
    ])
    expect(notice).toEqual({
      title: 'Status not changed on 2 issues',
      notes: ['Skipped P-3 and P-4.', 'P-3: No transition to Done.'],
      warned: true,
    })
  })

  it('names at most five of many, and counts one issue in the singular', () => {
    const many = refusedBatchNotice(
      'Status',
      keys(8).map((key) => ({ key, reason: 'No.' })),
    )
    expect(many.notes[0]).toBe('Skipped P-1, P-2, P-3, P-4, P-5 and 3 more.')
    expect(refusedBatchNotice('Status', [{ key: 'P-1', reason: 'No.' }]).title).toBe(
      'Status not changed on 1 issue',
    )
    expect(issues(0)).toBe('0 issues')
  })
})

describe('planBulk', () => {
  const many = (count: number) => Array.from({ length: count }, (_, n) => issue(n + 1))

  it('plans the items an action would change', () => {
    const plan = planBulk([issue(1), issue(2, { status: DONE })], statusAction(DONE), false)
    expect(plan).toMatchObject({ run: [{ key: 'P-1' }] })
  })

  it('sends a batch of 1000 and refuses 1001 with a notice, sending nothing', () => {
    expect('run' in planBulk(many(1000), statusAction(DONE), false)).toBe(true)
    const plan = planBulk(many(1001), statusAction(DONE), false)
    expect(plan).toEqual({
      stop: {
        title: 'Select at most 1000 issues',
        notes: ['1001 issues would change, and nothing was sent.'],
        warned: true,
      },
    })
  })

  it('counts the issues that would change, not the ones checked', () => {
    const checked = [
      ...many(1001).map((i) => ({ ...i })),
      ...many(5).map((i) => ({ ...i, key: `Q-${i.key}`, status: DONE })),
    ]
    expect(planBulk(checked, statusAction(DONE), false)).toMatchObject({
      stop: { title: 'Select at most 1000 issues' },
    })
    const done = many(3).map((i) => ({ ...i, key: `Q-${i.key}`, status: DONE }))
    expect('run' in planBulk([...many(1000), ...done], statusAction(DONE), false)).toBe(true)
  })

  it('stops quietly while a batch runs, so a second click cannot overlap the first', () => {
    expect(planBulk([issue(1)], statusAction(DONE), true)).toEqual({ stop: null })
  })

  it('says so when nothing would change', () => {
    expect(planBulk([issue(1, { status: DONE })], statusAction(DONE), false)).toEqual({
      stop: {
        title: 'Nothing to change',
        notes: ['1 issue already has it.'],
        warned: false,
      },
    })
  })
})

describe('bulk actions', () => {
  it('plans a status change for the issues not already there, with each one’s patch', () => {
    const plan = planBatch([issue(1), issue(2, { status: DONE }), issue(3)], statusAction(DONE))
    expect(plan).toEqual([
      {
        key: 'P-1',
        id: '101',
        change: { kind: 'status', statusId: '3' },
        patch: { status: DONE },
      },
      {
        key: 'P-3',
        id: '103',
        change: { kind: 'status', statusId: '3' },
        patch: { status: DONE },
      },
    ])
    expect(statusAction(DONE).title(2)).toBe('Status changed to Done on 2 issues')
  })

  it('plans an assignee change, and unassigning, one change per issue that differs', () => {
    const ann = { accountId: 'a1', displayName: 'Ann Lee', avatarUrl: null }
    const owned = issue(2, { assignee: ann })
    expect(planBatch([issue(1), owned], assigneeAction(ann)).map((i) => i.key)).toEqual(['P-1'])
    expect(planBatch([issue(1), owned], assigneeAction(null))).toEqual([
      {
        key: 'P-2',
        id: '102',
        change: { kind: 'edit', changes: { assignee: null } },
        patch: { assignee: null },
      },
    ])
    expect(assigneeAction(null).title(1)).toBe('Assignee changed to Unassigned on 1 issue')
  })

  it('plans priority and Customer edits for the issues that differ', () => {
    const high = { id: '2', name: 'High' }
    expect(planBatch([issue(1), issue(2, { priority: high })], priorityAction(high))).toHaveLength(
      1,
    )
    const beta = { id: '2', name: 'Beta Ltd' }
    expect(planBatch([issue(1)], customerAction(beta))[0]).toMatchObject({
      change: { kind: 'edit', changes: { customerId: '2' } },
      patch: { customer: { id: '2', value: 'Beta Ltd' } },
    })
  })

  it('adds a label to the issues that lack it and removes it from those that have it', () => {
    const tagged = issue(2, { labels: ['docs'] })
    const add = planBatch([issue(1), tagged], labelAction('docs', true))
    expect(add).toHaveLength(1)
    expect(add[0]).toMatchObject({
      key: 'P-1',
      change: { kind: 'edit', changes: { addLabels: ['docs'] } },
      patch: { labels: ['docs'] },
    })
    const remove = planBatch([issue(1), tagged], labelAction('docs', false))
    expect(remove[0]).toMatchObject({
      key: 'P-2',
      change: { kind: 'edit', changes: { removeLabels: ['docs'] } },
      patch: { labels: [] },
    })
  })

  it('moves issues to a sprint or the backlog, skipping those already there', () => {
    const sprint = {
      id: 5,
      name: 'Sprint 5',
      state: 'active' as const,
      startDate: null,
      endDate: null,
    }
    const inside = issue(2, {
      sprints: [{ id: 5, name: 'Sprint 5', state: 'active', endDate: null }],
    })
    expect(planBatch([issue(1), inside], sprintAction(sprint)).map((i) => i.key)).toEqual(['P-1'])
    expect(planBatch([issue(1), inside], sprintAction(null))).toEqual([
      expect.objectContaining({
        key: 'P-2',
        change: { kind: 'sprint', sprintId: null },
        patch: { sprints: [] },
      }),
    ])
  })

  it('plans nothing when every issue already has the value', () => {
    expect(planBatch([issue(1, { status: DONE })], statusAction(DONE))).toEqual([])
  })
})
