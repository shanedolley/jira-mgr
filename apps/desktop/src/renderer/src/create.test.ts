import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import type { CreatedIssue } from '../../shared/ipc'
import {
  createContext,
  defaultParent,
  deleteFailureNotes,
  describeCreated,
  initialDraft,
  isCreateKey,
  keepsLetters,
  listWords,
  missingFields,
  nextDraft,
  toCreateArgs,
  withType,
  type CreateDraft,
  type CreateKeyEvent,
} from './create'
import type { TreeRow } from './tree'

const ACME = { id: '1', value: 'Acme' }
const BETA = { id: '2', value: 'Beta Ltd' }
const NORTH = { id: '7', value: 'North' }
const SOUTH = { id: '8', value: 'South' }

const TYPES = {
  Epic: { id: '9', name: 'Epic', subtask: false, hierarchyLevel: 1 },
  Story: { id: '10', name: 'Story', subtask: false, hierarchyLevel: 0 },
  Subtask: { id: '13', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
}

interface Spec {
  type?: keyof typeof TYPES
  parent?: string
  customer?: { id: string; value: string }
  engagement?: { id: string; value: string }
}

function issue(key: string, spec: Spec = {}): Issue {
  return {
    id: key,
    key,
    summary: `Summary of ${key}`,
    issueType: TYPES[spec.type ?? 'Story'],
    status: { id: '1', name: 'To Do', category: 'new' },
    resolution: null,
    parentKey: spec.parent ?? null,
    assignee: null,
    labels: [],
    priority: null,
    customer: spec.customer ?? null,
    engagement: spec.engagement ?? null,
    sprints: [],
    startDate: null,
    dueDate: null,
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null,
    timeRemainingHours: null,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
  }
}

/** Epic P-1 (Acme, North) with Story P-2 and its Subtask P-3; Story P-4 under no Epic; Story P-5 whose Customer differs from the Epic's. */
const ISSUES = [
  issue('P-1', { type: 'Epic', customer: ACME, engagement: NORTH }),
  issue('P-2', { parent: 'P-1', customer: ACME, engagement: NORTH }),
  issue('P-3', { type: 'Subtask', parent: 'P-2', customer: ACME, engagement: NORTH }),
  issue('P-4', { customer: BETA, engagement: SOUTH }),
  issue('P-5', { parent: 'P-1', customer: BETA, engagement: SOUTH }),
]
const byKey = (key: string) => ISSUES.find((i) => i.key === key) ?? null

describe('initialDraft', () => {
  it('starts a Story under a selected Epic, with the Epic Customer and Engagement', () => {
    const draft = initialDraft(byKey('P-1'), ISSUES)

    expect(draft).toMatchObject({
      type: 'Story',
      summary: '',
      parent: { key: 'P-1' },
      customer: { id: '1', name: 'Acme' },
      engagement: { id: '7', name: 'North' },
    })
  })

  it('starts under the Epic above a selected Story or Subtask', () => {
    expect(initialDraft(byKey('P-2'), ISSUES).parent?.key).toBe('P-1')
    expect(initialDraft(byKey('P-3'), ISSUES).parent?.key).toBe('P-1')
  })

  it('takes the Epic values over a Story that differs from its Epic', () => {
    const draft = initialDraft(byKey('P-5'), ISSUES)

    expect(draft.parent?.key).toBe('P-1')
    expect(draft.customer?.name).toBe('Acme')
    expect(draft.engagement?.name).toBe('North')
  })

  it('takes the selected issue values when it has no Epic', () => {
    const draft = initialDraft(byKey('P-4'), ISSUES)

    expect(draft.parent).toBeNull()
    expect(draft.customer?.name).toBe('Beta Ltd')
    expect(draft.engagement?.name).toBe('South')
  })

  it('takes a Customer header Customer when no issue is selected', () => {
    const draft = initialDraft(null, ISSUES, BETA)

    expect(draft).toMatchObject({ parent: null, customer: { id: '2', name: 'Beta Ltd' } })
    expect(draft.engagement).toBeNull()
  })

  it('starts empty with nothing selected', () => {
    expect(initialDraft(null, ISSUES)).toMatchObject({
      type: 'Story',
      parent: null,
      customer: null,
      engagement: null,
      sprint: null,
      assignee: null,
      priority: null,
      labels: [],
    })
  })
})

describe('defaultParent', () => {
  it('is the selected Story for a Subtask, else the Story above a selected Subtask', () => {
    expect(defaultParent('Subtask', byKey('P-2'), ISSUES)?.key).toBe('P-2')
    expect(defaultParent('Subtask', byKey('P-3'), ISSUES)?.key).toBe('P-2')
  })

  it('is nothing for a Subtask when only an Epic is selected, and for an Epic always', () => {
    expect(defaultParent('Subtask', byKey('P-1'), ISSUES)).toBeNull()
    expect(defaultParent('Epic', byKey('P-1'), ISSUES)).toBeNull()
  })
})

describe('withType', () => {
  const start = initialDraft(byKey('P-2'), ISSUES)

  it('moves a Subtask under the selected Story and back to the Epic', () => {
    const subtask = withType(start, 'Subtask', byKey('P-2'), ISSUES)
    expect(subtask.parent?.key).toBe('P-2')

    expect(withType(subtask, 'Task', byKey('P-2'), ISSUES).parent?.key).toBe('P-1')
  })

  it('keeps a parent that still fits', () => {
    expect(withType(start, 'Bug', byKey('P-2'), ISSUES).parent?.key).toBe('P-1')
  })

  it('drops what an Epic has not: parent, sprint and estimate', () => {
    const full: CreateDraft = {
      ...start,
      sprint: { id: 5, name: 'Sprint 5', state: 'active', startDate: null, endDate: null },
      estimate: '2h',
    }
    const epic = withType(full, 'Epic', byKey('P-2'), ISSUES)

    expect(epic).toMatchObject({ type: 'Epic', parent: null, sprint: null, estimate: '' })
  })

  it('drops the sprint for a Subtask but keeps its estimate', () => {
    const full: CreateDraft = {
      ...start,
      sprint: { id: 5, name: 'Sprint 5', state: 'active', startDate: null, endDate: null },
      estimate: '2h',
    }

    expect(withType(full, 'Subtask', byKey('P-2'), ISSUES)).toMatchObject({
      sprint: null,
      estimate: '2h',
    })
  })
})

describe('missingFields and toCreateArgs', () => {
  const ready: CreateDraft = { ...initialDraft(byKey('P-1'), ISSUES), summary: '  Write it  ' }

  it('needs a summary, a Customer and an Engagement on every type', () => {
    const empty = initialDraft(null, ISSUES)

    expect(missingFields(empty)).toEqual(['a summary', 'a Customer', 'an Engagement'])
    expect(toCreateArgs(empty)).toBeNull()
    for (const type of ['Story', 'Task', 'Bug', 'Epic'] as const) {
      expect(missingFields({ ...ready, type, customer: null })).toEqual(['a Customer'])
    }
  })

  it('needs a parent for a Subtask', () => {
    expect(missingFields({ ...ready, type: 'Subtask', parent: null })).toEqual(['a parent'])
  })

  it('needs an estimate Jira can read', () => {
    expect(missingFields({ ...ready, estimate: 'soon' })).toEqual(['an estimate such as 2h 30m'])
    expect(missingFields({ ...ready, estimate: '2h 30m' })).toEqual([])
  })

  it('sends the trimmed summary with the ids and only what is set', () => {
    expect(toCreateArgs(ready)).toEqual({
      type: 'Story',
      summary: 'Write it',
      customerId: '1',
      engagementId: '7',
      parentKey: 'P-1',
    })
  })

  it('sends every picked field', () => {
    const args = toCreateArgs({
      ...ready,
      assignee: { accountId: 'u1', displayName: 'U', avatarUrl: null },
      priority: { id: '3', name: 'Medium' },
      labels: ['docs'],
      estimate: ' 2h ',
      sprint: { id: 5, name: 'Sprint 5', state: 'active', startDate: null, endDate: null },
    })

    expect(args).toMatchObject({
      assignee: 'u1',
      priorityId: '3',
      labels: ['docs'],
      originalEstimate: '2h',
      sprintId: 5,
    })
  })

  it('leaves out the parent, sprint and estimate an Epic does not have', () => {
    const args = toCreateArgs({
      ...ready,
      type: 'Epic',
      sprint: { id: 5, name: 'Sprint 5', state: 'active', startDate: null, endDate: null },
      estimate: '2h',
    })

    expect(args).not.toHaveProperty('parentKey')
    expect(args).not.toHaveProperty('sprintId')
    expect(args).not.toHaveProperty('originalEstimate')
  })
})

describe('nextDraft', () => {
  it('clears only the summary', () => {
    const draft: CreateDraft = {
      ...initialDraft(byKey('P-1'), ISSUES),
      summary: 'One',
      labels: ['docs'],
      type: 'Bug',
    }

    expect(nextDraft(draft)).toEqual({ ...draft, summary: '' })
  })
})

describe('describeCreated', () => {
  const draft: CreateDraft = {
    ...initialDraft(byKey('P-1'), ISSUES),
    summary: 'Write it',
    estimate: '2h',
    sprint: { id: 6, name: 'Sprint 6', state: 'future', startDate: null, endDate: null },
  }
  const held = (changes: Partial<Issue>): CreatedIssue => ({
    key: 'P-9',
    warning: null,
    issue: {
      ...issue('P-9', { parent: 'P-1', customer: ACME, engagement: NORTH }),
      summary: 'Write it',
      originalEstimateSeconds: 7200,
      sprints: [{ id: 6, name: 'Sprint 6', state: 'future' }],
      ...changes,
      description: null,
      subtasks: [],
    },
  })

  it('has nothing to add when Jira kept what was chosen', () => {
    expect(describeCreated(draft, held({}))).toEqual({
      title: 'Created P-9: Write it',
      notes: [],
      warned: false,
    })
  })

  it('names each field the automation changed, with what was chosen', () => {
    const notice = describeCreated(
      draft,
      held({
        customer: BETA,
        parentKey: 'P-50',
        sprints: [{ id: 5, name: 'Sprint 5', state: 'active' }],
        labels: ['PSAPAC'],
        originalEstimateSeconds: 14400,
      }),
    )

    expect(notice.notes).toEqual([
      'Customer is Beta Ltd (you chose Acme).',
      'Parent is P-50 (you chose P-1).',
      'Sprint is Sprint 5 (you chose Sprint 6).',
      'Jira added the label PSAPAC.',
      'Original estimate is 4h (you chose 2h).',
    ])
    expect(notice.warned).toBe(false)
  })

  it('says so when Jira put the issue in a sprint nobody chose', () => {
    const notice = describeCreated(
      { ...draft, sprint: null },
      held({ sprints: [{ id: 5, name: 'Sprint 5', state: 'active' }] }),
    )

    expect(notice.notes).toEqual(['Sprint is Sprint 5 (you chose none).'])
  })

  it('names the key and the warning when the issue could not be read back', () => {
    const notice = describeCreated(draft, { key: 'P-9', issue: null, warning: 'Could not read.' })

    expect(notice).toEqual({ title: 'Created P-9', notes: ['Could not read.'], warned: true })
  })

  it('keeps a warning after the changes when the sprint move failed', () => {
    const notice = describeCreated(draft, { ...held({ sprints: [] }), warning: 'No sprint.' })

    expect(notice.notes.at(-1)).toBe('No sprint.')
    expect(notice.warned).toBe(true)
  })
})

describe('createContext', () => {
  const issueRow = (key: string) => ({ kind: 'issue', node: { issue: byKey(key) } }) as TreeRow

  it('is the active issue, a chip parent, or the Customer a header stands for', () => {
    expect(createContext(issueRow('P-2'), ISSUES).selected?.key).toBe('P-2')
    const chip = { kind: 'chip', parentKey: 'P-1' } as TreeRow
    expect(createContext(chip, ISSUES).selected?.key).toBe('P-1')
    const header = { kind: 'customer', customer: BETA } as TreeRow
    expect(createContext(header, ISSUES)).toEqual({ selected: null, group: BETA })
    expect(createContext(undefined, ISSUES)).toEqual({ selected: null, group: null })
  })
})

describe('the C key', () => {
  const key = (extra: Partial<CreateKeyEvent> = {}): CreateKeyEvent => ({
    key: 'c',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    ...extra,
  })

  it('is the letter C alone, in either case', () => {
    expect(isCreateKey(key())).toBe(true)
    expect(isCreateKey(key({ key: 'C' }))).toBe(true)
    expect(isCreateKey(key({ key: 'x' }))).toBe(false)
  })

  it('is never Cmd, Ctrl or Alt with C, nor a held, composed or handled key', () => {
    for (const extra of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
    ]) {
      expect(isCreateKey(key(extra))).toBe(false)
    }
  })

  it('stays out of text fields, pickers, dialogs and editors', () => {
    const inside = (selector: string) => ({
      closest: (list: string) => (list.split(', ').includes(selector) ? {} : null),
    })

    for (const own of [
      'input',
      'textarea',
      'select',
      'dialog',
      '[popover]',
      '[role="listbox"]',
      '[role="combobox"]',
      '[role="textbox"]',
      '[role="menu"]',
    ]) {
      expect(keepsLetters(inside(own))).toBe(true)
    }
    expect(keepsLetters({ closest: () => null })).toBe(false)
    expect(keepsLetters(null)).toBe(false)
  })
})

describe('listWords', () => {
  it('joins with commas and a last and', () => {
    expect(listWords([])).toBe('')
    expect(listWords(['a Customer'])).toBe('a Customer')
    expect(listWords(['a summary', 'a Customer', 'an Engagement'])).toBe(
      'a summary, a Customer and an Engagement',
    )
  })
})

describe('deleteFailureNotes', () => {
  const refused = { code: 'permission_denied', message: 'You cannot delete this issue.' }

  it('says the issue is back when the lists held it and it was restored', () => {
    expect(deleteFailureNotes('P-1', refused, true)).toEqual([
      'You cannot delete this issue.',
      'It is back in the list.',
    ])
  })

  it('does not claim a restore when the lists never held the issue', () => {
    expect(deleteFailureNotes('P-1', refused, false)).toEqual(['You cannot delete this issue.'])
  })

  it('says a missing issue no longer exists, whatever was restored', () => {
    const missing = { code: 'not_found', message: 'Issue does not exist.' }

    expect(deleteFailureNotes('P-1', missing, false)).toEqual(['P-1 no longer exists in Jira.'])
    expect(deleteFailureNotes('P-1', missing, true)).toEqual(['P-1 no longer exists in Jira.'])
  })
})
