import type { Issue } from '@jira-mgr/core'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  UNDO_DEPTH,
  UndoStack,
  batchEntry,
  batchRecorder,
  changeOfReversal,
  changedFields,
  changedSince,
  describeEdit,
  describeUndo,
  descriptionEntry,
  editEntry,
  recorder,
  invertChanges,
  planBatchUndo,
  reversible,
  sprintEntry,
  statusEntry,
  summaryEntry,
  undoStack,
  isBatch,
  isOrder,
  restoreOrdering,
  sameOrdering,
  type OrderEntry,
  type StackEntry,
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

  it('has nothing to send for a label that was already there', () => {
    expect(invertChanges({ addLabels: ['a'] }, { labels: ['a'] })).toBeNull()
    expect(invertChanges({ removeLabels: ['z'] }, { labels: ['a'] })).toBeNull()
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

  it('words Time left as a duration', () => {
    const entry = editEntry(
      { key: 'P-1', changes: { timeRemainingHours: 1.5 } },
      { patch: { timeRemainingHours: 1.5 }, before: { timeRemainingHours: 0.25 } },
    )
    expect(describeEdit(entry)).toBe('P-1: time left changed to 1h 30m')
    expect(describeUndo(entry)).toBe('Undid P-1: time left back to 15m')
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

describe('changedFields', () => {
  it('names the fields of what was shown that the issue no longer shows', () => {
    const low = { id: '4', name: 'Low' }
    const high = { id: '2', name: 'High' }
    expect(changedFields({ priority: low }, { priority: low })).toBe('')
    expect(changedFields({ priority: low }, { priority: high })).toBe('priority')
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

  const keyOf = (held: StackEntry | undefined) =>
    held === undefined || isBatch(held) ? undefined : held.key

  it('pops the newest edit first', () => {
    const stack = new UndoStack()
    stack.push(entry(1))
    stack.push(entry(2))
    expect(keyOf(stack.pop())).toBe('P-2')
    expect(keyOf(stack.pop())).toBe('P-1')
    expect(stack.pop()).toBeUndefined()
  })

  it(`keeps the last ${String(UNDO_DEPTH)} edits`, () => {
    const stack = new UndoStack()
    for (let n = 1; n <= UNDO_DEPTH + 3; n++) stack.push(entry(n))
    expect(stack.size).toBe(UNDO_DEPTH)
    const oldest: string[] = []
    for (let e = stack.pop(); e !== undefined; e = stack.pop()) oldest.push(keyOf(e) ?? '')
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

  it('takes one edit from the middle, once, and leaves the others', () => {
    const stack = new UndoStack()
    const [one, two, three] = [entry(1), entry(2), entry(3)]
    stack.push(one)
    stack.push(two)
    stack.push(three)
    expect(stack.take(two)).toBe(two)
    expect(stack.take(two)).toBeUndefined()
    expect(stack.pop()).toBe(three)
    expect(stack.pop()).toBe(one)
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

describe('description undo', () => {
  const doc = (text: string, localId?: string) => ({
    version: 1 as const,
    type: 'doc' as const,
    content: [
      {
        type: 'paragraph',
        ...(localId === undefined ? {} : { attrs: { localId } }),
        content: [{ type: 'text', text }],
      },
    ],
  })

  it('writes the replaced description back, or nothing when it is unknown', () => {
    const entry = descriptionEntry(
      { key: 'PSAPAC-1' },
      { patch: { description: doc('new') }, before: { description: doc('old') } },
    )
    expect(entry.reversal).toEqual({ kind: 'description', description: doc('old') })
    expect(entry.what).toBe('description')
    expect(describeEdit(entry)).toBe('PSAPAC-1: description changed to the saved text')
    const cleared = descriptionEntry(
      { key: 'PSAPAC-1' },
      { patch: { description: doc('new') }, before: { description: null } },
    )
    expect(cleared.reversal).toEqual({ kind: 'description', description: null })
    expect(describeUndo(cleared)).toBe('Undid PSAPAC-1: description back to empty')
    expect(
      descriptionEntry({ key: 'PSAPAC-1' }, { patch: { description: doc('new') }, before: {} })
        .reversal,
    ).toBeNull()
  })

  it('refuses an undo when the description changed, but not for localIds Jira added', () => {
    const entry = descriptionEntry(
      { key: 'PSAPAC-1' },
      { patch: { description: doc('new') }, before: { description: doc('old') } },
    )
    expect(changedSince(entry, { description: doc('new', 'abc') })).toBe('')
    expect(changedSince(entry, { description: doc('theirs') })).toBe('description')
    expect(changedSince(entry, { description: null })).toBe('description')
  })
})

describe('batch entries', () => {
  const DONE = { id: '3', name: 'Done', category: 'done' } as const
  const done = (key: string, before: Partial<Issue>) => ({
    key,
    change: { kind: 'status', statusId: '3' } as const,
    patch: { status: DONE },
    before,
  })
  const entry = batchEntry('Status changed to Done on 3 issues', [
    done('P-1', { status: TODO }),
    done('P-2', { status: DOING }),
    done('P-3', {}),
  ])
  const issueOf = (key: string, status: Issue['status']) =>
    ({ id: `id-${key}`, key, status }) as Issue

  it('holds one part per issue, each with its own prior status to move back to', () => {
    expect(entry.what).toBe('status')
    expect(entry.parts.map((p) => [p.key, p.reversal])).toEqual([
      ['P-1', { kind: 'status', statusId: '1' }],
      ['P-2', { kind: 'status', statusId: '2' }],
      ['P-3', null],
    ])
  })

  it('is reversible while any part can be put back', () => {
    expect(reversible(entry)).toBe(true)
    expect(reversible(batchEntry('x', [done('P-3', {})]))).toBe(false)
    expect(
      reversible(
        statusEntry({ key: 'P-1' }, { patch: { status: DONE }, before: { status: TODO } }),
      ),
    ).toBe(true)
  })

  it('goes back as one batch of each issue its own prior value, with the optimistic patch', () => {
    const plan = planBatchUndo(entry, (key) => issueOf(key, DONE))
    expect(plan.items).toEqual([
      {
        key: 'P-1',
        id: 'id-P-1',
        change: { kind: 'status', statusId: '1' },
        patch: { status: TODO },
      },
      {
        key: 'P-2',
        id: 'id-P-2',
        change: { kind: 'status', statusId: '2' },
        patch: { status: DOING },
      },
    ])
    // P-3 had no prior value to move back to.
    expect(plan.skipped).toEqual(['P-3'])
  })

  it('skips and names an issue that changed since, and one no longer loaded', () => {
    const plan = planBatchUndo(entry, (key) =>
      key === 'P-1' ? issueOf(key, DOING) : key === 'P-2' ? undefined : issueOf(key, DONE),
    )
    expect(plan.items).toEqual([])
    expect(plan.skipped).toEqual(['P-1', 'P-2', 'P-3'])
    const partly = planBatchUndo(entry, (key) => issueOf(key, key === 'P-1' ? DOING : DONE))
    expect(partly.items.map((i) => i.key)).toEqual(['P-2'])
    expect(partly.skipped).toEqual(['P-1', 'P-3'])
  })

  it('maps a reversal to a batch change, and text edits to none', () => {
    expect(changeOfReversal({ kind: 'sprint', sprintId: null })).toEqual({
      kind: 'sprint',
      sprintId: null,
    })
    expect(changeOfReversal({ kind: 'edit', changes: { assignee: null } })).toEqual({
      kind: 'edit',
      changes: { assignee: null },
    })
    expect(changeOfReversal({ kind: 'summary', summary: 'x' })).toBeNull()
    expect(changeOfReversal({ kind: 'description', description: null })).toBeNull()
  })

  it('builds each part by the kind of change the batch made', () => {
    const mixed = batchEntry('t', [
      {
        key: 'P-1',
        change: { kind: 'edit', changes: { assignee: 'b2' } },
        patch: { assignee: null },
        before: { assignee: ann },
      },
      {
        key: 'P-2',
        change: { kind: 'sprint', sprintId: 5 },
        patch: { sprints: [{ id: 5, name: 'S5', state: 'active' }] },
        before: { sprints: [] },
      },
    ])
    expect(mixed.parts.map((p) => p.reversal)).toEqual([
      { kind: 'edit', changes: { assignee: 'a1' } },
      { kind: 'sprint', sprintId: null },
    ])
  })

  it('records one entry for a batch, none for an undo, and none when nothing changed', () => {
    const client = new QueryClient()
    const stack = undoStack(client)
    const record = batchRecorder(client, (n) => `Changed ${String(n)}`)
    record([])
    expect(stack.size).toBe(0)
    record([done('P-1', { status: TODO }), done('P-2', { status: TODO })])
    expect(stack.size).toBe(1)
    expect(stack.pop()).toMatchObject({ title: 'Changed 2', what: 'status' })
    batchRecorder(client, () => 'x', true)([done('P-1', { status: TODO })])
    expect(stack.size).toBe(0)
  })
})

describe('order entries', () => {
  const display = { properties: [], order: 'manual' as const, direction: 'asc' as const }
  const entry: OrderEntry = {
    key: 'P-1',
    title: 'Moved P-1 to position 2 of 3',
    display: {
      before: { ...display, order: 'key', direction: 'desc' },
      after: { ...display, manual: ['P-2', 'P-1', 'P-3'] },
    },
  }

  it('is told apart from an edit and a batch, and can always be undone', () => {
    expect(isOrder(entry)).toBe(true)
    expect(isBatch(entry)).toBe(false)
    expect(reversible(entry)).toBe(true)
  })

  it('goes on the stack and comes off it like an edit', () => {
    const stack = new UndoStack()
    stack.push(entry)
    expect(stack.pop()).toBe(entry)
  })

  it('puts back the ordering alone, keeping the properties shown since', () => {
    const shown = { ...entry.display.after, properties: ['labels' as const] }
    const back = restoreOrdering(shown, entry.display.before)
    expect(back).toEqual({ properties: ['labels'], order: 'key', direction: 'desc' })
    // Before a first move there was no list, so none comes back; a list that was there does.
    expect(back).not.toHaveProperty('manual')
    expect(restoreOrdering(shown, entry.display.after)).toEqual(shown)
  })

  it('compares the order, the direction and, under Manual, the list', () => {
    const a = { ...display, manual: ['P-1', 'P-2'] }
    expect(sameOrdering(a, { ...a, properties: ['due'] })).toBe(true)
    expect(sameOrdering(a, { ...a, manual: ['P-2', 'P-1'] })).toBe(false)
    expect(sameOrdering(a, { ...a, manual: ['P-1'] })).toBe(false)
    expect(sameOrdering(a, { ...a, order: 'key', direction: 'desc' })).toBe(false)
    // A leftover list under another order changes nothing.
    const key = { ...display, order: 'key' as const, direction: 'desc' as const }
    expect(sameOrdering(key, { ...key, manual: ['P-1'] })).toBe(true)
  })
})
