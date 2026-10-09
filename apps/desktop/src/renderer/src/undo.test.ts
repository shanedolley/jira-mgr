import type { Issue } from '@jira-mgr/core'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  UNDO_DEPTH,
  UndoStack,
  changedSince,
  describeEdit,
  describeUndo,
  editEntry,
  recorder,
  invertChanges,
  sprintEntry,
  statusEntry,
  summaryEntry,
  undoStack,
  type UndoEntry,
} from './undo'

const ann = { accountId: 'a1', displayName: 'Ann Lee', avatarUrl: null }
const TODO = { id: '1', name: 'To Do', category: 'new' } as const
const DOING = { id: '2', name: 'In Progress', category: 'indeterminate' } as const

describe('invertChanges', () => {
  it('puts the old assignee back, or unassigns', () => {
    expect(invertChanges({ assignee: 'b2' }, { assignee: ann })).toEqual({ assignee: 'a1' })
    expect(invertChanges({ assignee: 'b2' }, { assignee: null })).toEqual({ assignee: null })
    expect(invertChanges({ assignee: null }, {})).toBeNull()
  })

  it('puts a date back, or clears it', () => {
    expect(invertChanges({ dueDate: '2026-10-10' }, { dueDate: '2026-10-01' })).toEqual({
      dueDate: '2026-10-01',
    })
    expect(invertChanges({ startDate: '2026-10-10' }, { startDate: null })).toEqual({
      startDate: null,
    })
  })

  it('adds back a label the edit removed and removes one it added', () => {
    expect(invertChanges({ addLabels: ['x'] }, { labels: ['a'] })).toEqual({ removeLabels: ['x'] })
    expect(invertChanges({ removeLabels: ['a'] }, { labels: ['a', 'b'] })).toEqual({
      addLabels: ['a'],
    })
  })

  it('leaves alone a label that was already there', () => {
    expect(invertChanges({ addLabels: ['a'] }, { labels: ['a'] })).toEqual({})
  })

  it('puts the estimate, time remaining and type back', () => {
    expect(
      invertChanges(
        { originalEstimate: '4h', timeRemainingHours: 3, type: 'Bug' },
        {
          originalEstimateSeconds: 9000,
          timeRemainingHours: null,
          issueType: { id: '10', name: 'Story', subtask: false, hierarchyLevel: 0 },
        },
      ),
    ).toEqual({ originalEstimate: '2h 30m', timeRemainingHours: null, type: 'Story' })
  })

  it('puts the parent, Customer and Engagement back together', () => {
    expect(
      invertChanges(
        { parentKey: 'P-2', customerId: '9', engagementId: '8' },
        {
          parentKey: 'P-1',
          customer: { id: '1', value: 'Acme' },
          engagement: { id: '7', value: 'North' },
        },
      ),
    ).toEqual({ parentKey: 'P-1', customerId: '1', engagementId: '7' })
  })

  it('gives up when core cannot clear what the edit set', () => {
    expect(invertChanges({ priorityId: '3' }, { priority: null })).toBeNull()
    expect(invertChanges({ parentKey: 'P-2' }, { parentKey: null })).toBeNull()
    expect(invertChanges({ customerId: '1' }, { customer: null })).toBeNull()
    expect(invertChanges({ engagementId: '1' }, { engagement: null })).toBeNull()
    expect(invertChanges({ originalEstimate: '1h' }, { originalEstimateSeconds: null })).toBeNull()
  })

  it('gives up when the old value of a changed field is unknown', () => {
    expect(invertChanges({ priorityId: '3' }, {})).toBeNull()
    expect(invertChanges({ addLabels: ['x'] }, {})).toBeNull()
  })
})

describe('the entries', () => {
  it('records an edit with its fields in words and its reversal', () => {
    const entry = editEntry(
      { key: 'P-1', changes: { assignee: 'b2' } },
      {
        patch: { assignee: { ...ann, accountId: 'b2', displayName: 'Bo' } },
        before: { assignee: ann },
      },
    )
    expect(entry).toMatchObject({
      key: 'P-1',
      what: 'assignee',
      reversal: { kind: 'edit', changes: { assignee: 'a1' } },
    })
    expect(describeEdit(entry)).toBe('P-1: assignee changed to Bo')
    expect(describeUndo(entry)).toBe('Undid P-1: assignee back to Ann Lee')
  })

  it('names several fields', () => {
    const entry = editEntry(
      { key: 'P-1', changes: { parentKey: 'P-2', customerId: '9' } },
      {
        patch: { parentKey: 'P-2', customer: { id: '9', value: 'Beta' } },
        before: { parentKey: 'P-1', customer: { id: '1', value: 'Acme' } },
      },
    )
    expect(entry.what).toBe('parent and Customer')
    expect(describeEdit(entry)).toBe('P-1: parent and Customer changed to P-2 and Beta')
  })

  it('moves a status back by the old status id', () => {
    const entry = statusEntry(
      { key: 'P-1' },
      { patch: { status: DOING }, before: { status: TODO } },
    )
    expect(entry.reversal).toEqual({ kind: 'status', statusId: '1' })
    expect(describeEdit(entry)).toBe('P-1: status changed to In Progress')
  })

  it('moves a sprint back by the old sprint, or to the backlog', () => {
    const sprint = { id: 5, name: 'Sprint 5', state: 'active' as const }
    const into = sprintEntry(
      { key: 'P-1' },
      { patch: { sprints: [sprint] }, before: { sprints: [] } },
    )
    expect(into.reversal).toEqual({ kind: 'sprint', sprintId: null })
    expect(describeUndo(into)).toBe('Undid P-1: sprint back to the backlog')
    const out = sprintEntry(
      { key: 'P-1' },
      { patch: { sprints: [] }, before: { sprints: [sprint] } },
    )
    expect(out.reversal).toEqual({ kind: 'sprint', sprintId: 5 })
  })

  it('writes the old summary back', () => {
    const entry = summaryEntry(
      { key: 'P-1' },
      { patch: { summary: 'New' }, before: { summary: 'Old' } },
    )
    expect(entry.reversal).toEqual({ kind: 'summary', summary: 'Old' })
    expect(describeUndo(entry)).toBe('Undid P-1: summary back to "Old"')
  })

  it('has no reversal when the old value is unknown', () => {
    expect(
      statusEntry({ key: 'P-1' }, { patch: { status: DOING }, before: {} }).reversal,
    ).toBeNull()
    expect(
      editEntry({ key: 'P-1', changes: { priorityId: '3' } }, { patch: {}, before: {} }).reversal,
    ).toBeNull()
  })
})

describe('changedSince', () => {
  const entry = (after: Partial<Issue>): UndoEntry => ({
    key: 'P-1',
    what: 'x',
    after,
    before: {},
    reversal: null,
  })

  it('is empty while the issue still shows what the edit set', () => {
    expect(changedSince(entry({ status: DOING }), { status: DOING })).toBe('')
  })

  it('names the fields that differ', () => {
    expect(
      changedSince(entry({ status: DOING, summary: 'A' }), { status: TODO, summary: 'A' }),
    ).toBe('status')
    expect(
      changedSince(entry({ status: DOING, summary: 'A' }), { status: TODO, summary: 'B' }),
    ).toBe('status and summary')
  })

  it('compares people, options and sprints by identity, so a re-read avatar or date is no change', () => {
    expect(
      changedSince(entry({ assignee: ann }), {
        assignee: { ...ann, avatarUrl: 'https://example.test/a.png' },
      }),
    ).toBe('')
    const set = { id: 5, name: 'Sprint 5', state: 'active' as const }
    expect(
      changedSince(entry({ sprints: [set] }), {
        sprints: [{ ...set, startDate: '2026-10-01' } as Issue['sprints'][number]],
      }),
    ).toBe('')
    expect(changedSince(entry({ sprints: [set] }), { sprints: [] })).toBe('sprint')
  })

  it('compares labels as a set', () => {
    expect(changedSince(entry({ labels: ['a', 'b'] }), { labels: ['b', 'a'] })).toBe('')
    expect(changedSince(entry({ labels: ['a'] }), { labels: ['a', 'c'] })).toBe('labels')
  })
})

describe('UndoStack', () => {
  const entry = (n: number): UndoEntry => ({
    key: `P-${String(n)}`,
    what: 'status',
    after: {},
    before: {},
    reversal: null,
  })

  it('pops the newest edit first', () => {
    const stack = new UndoStack()
    stack.push(entry(1))
    stack.push(entry(2))
    expect(stack.pop()?.key).toBe('P-2')
    expect(stack.pop()?.key).toBe('P-1')
    expect(stack.pop()).toBeUndefined()
  })

  it(`keeps the last ${String(UNDO_DEPTH)} edits`, () => {
    const stack = new UndoStack()
    for (let n = 1; n <= UNDO_DEPTH + 3; n++) stack.push(entry(n))
    expect(stack.size).toBe(UNDO_DEPTH)
    const oldest: string[] = []
    for (let e = stack.pop(); e !== undefined; e = stack.pop()) oldest.push(e.key)
    expect(oldest.at(-1)).toBe('P-4')
  })

  it('tells a listener about each edit until it unsubscribes', () => {
    const stack = new UndoStack()
    const heard = vi.fn()
    const stop = stack.onPush(heard)
    stack.push(entry(1))
    stop()
    stack.push(entry(2))
    expect(heard).toHaveBeenCalledExactlyOnceWith(entry(1))
  })

  it('forgets everything when cleared', () => {
    const stack = new UndoStack()
    stack.push(entry(1))
    stack.clear()
    expect(stack.pop()).toBeUndefined()
  })

  it('is one stack per client', () => {
    const a = new QueryClient()
    const b = new QueryClient()
    expect(undoStack(a)).toBe(undoStack(a))
    expect(undoStack(a)).not.toBe(undoStack(b))
  })
})

describe('recorder', () => {
  const done = { patch: { summary: 'New' }, before: { summary: 'Old' } }

  it('pushes the entry of an ordinary edit', () => {
    const client = new QueryClient()
    recorder(client, summaryEntry)({ key: 'P-1' }, done)
    expect(undoStack(client).pop()).toMatchObject({ key: 'P-1', what: 'summary' })
  })

  it('does not push an edit that is itself an undo', () => {
    const client = new QueryClient()
    recorder<{ key: string; undoing?: boolean }>(client, summaryEntry)(
      { key: 'P-1', undoing: true },
      done,
    )
    expect(undoStack(client).size).toBe(0)
  })
})
