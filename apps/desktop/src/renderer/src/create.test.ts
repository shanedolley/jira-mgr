import type { Issue } from '@jira-mgr/core'
import type { AdfNode, EditorDoc, EditorNode } from '@jira-mgr/core/adf'
import { describe, expect, it } from 'vitest'

import type { CreatedIssue } from '../../shared/ipc'
import {
  createContext,
  defaultParent,
  deleteFailureNotes,
  describeCreated,
  describeLate,
  descriptionOf,
  fillImages,
  firstMissing,
  missingKeys,
  initialDraft,
  listWords,
  missingFields,
  nextDraft,
  pastedImages,
  toCreateArgs,
  withType,
  withUploadFailures,
  type CreateDraft,
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
    creator: null,
    labels: [],
    links: [],
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
  it('starts a Subtask under the selected Story, with its Customer and Engagement', () => {
    const draft = initialDraft(byKey('P-2'), ISSUES, null, 'Subtask')
    expect(draft).toMatchObject({ type: 'Subtask', parent: { key: 'P-2' }, description: null })
    expect(draft.customer).toEqual({ id: '1', name: 'Acme' })
    expect(draft.engagement).toEqual({ id: '7', name: 'North' })
  })

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

  it('names the first missing field in form order, or none when the form is ready', () => {
    const empty = initialDraft(null, ISSUES)

    expect(firstMissing(empty)).toBe('summary')
    expect(firstMissing({ ...empty, summary: 'x' })).toBe('customer')
    expect(firstMissing({ ...empty, summary: 'x', customer: ready.customer })).toBe('engagement')
    expect(firstMissing({ ...ready, type: 'Subtask', parent: null })).toBe('parent')
    expect(firstMissing({ ...ready, estimate: 'soon' })).toBe('estimate')
    expect(firstMissing(ready)).toBeNull()
  })

  it('follows the form for the first missing field: a parent before Customer and Engagement', () => {
    const subtask = { ...initialDraft(null, ISSUES), type: 'Subtask' as const, summary: 'x' }

    expect(missingFields(subtask)).toEqual(['a Customer', 'an Engagement', 'a parent'])
    expect(firstMissing(subtask)).toBe('parent')
    expect(missingKeys(subtask)).toEqual(['parent', 'customer', 'engagement'])
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

  const typed = {
    version: 1 as const,
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan it' }] }],
  }

  it('sends the typed description, and none while the editor holds no text', () => {
    expect(toCreateArgs({ ...ready, description: typed })).toMatchObject({ description: typed })
    expect(toCreateArgs(ready)).not.toHaveProperty('description')
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

describe('descriptionOf', () => {
  const paragraph = (text?: string) => ({
    type: 'paragraph',
    ...(text !== undefined && { content: [{ type: 'text', text }] }),
  })
  const doc = (...content: EditorNode[]): EditorDoc => ({ type: 'doc', content })

  it('is null while the editor holds no text, however many empty paragraphs Enter made', () => {
    expect(descriptionOf(doc(paragraph()))).toBeNull()
    expect(descriptionOf(doc(paragraph(), paragraph()))).toBeNull()
  })

  const text = (value: string): EditorNode => ({ type: 'text', text: value })
  const node = (type: string, ...content: EditorNode[]): EditorNode => ({ type, content })

  it.each([
    ['spaces', doc(node('paragraph', text('   ')))],
    ['a lone line break', doc(node('paragraph', { type: 'hardBreak' }))],
    ['an empty heading', doc({ type: 'heading', attrs: { level: 2 } })],
    ['an empty bullet item', doc(node('bulletList', node('listItem', node('paragraph'))))],
    ['an empty code block', doc({ type: 'codeBlock' })],
    ['an empty quote', doc(node('blockquote', node('paragraph')))],
  ])('is null for %s', (_name, empty) => {
    expect(descriptionOf(empty)).toBeNull()
  })

  it.each([
    ['text with a character', doc(node('paragraph', text(' a ')))],
    [
      'text in a list item',
      doc(node('bulletList', node('listItem', node('paragraph', text('a'))))),
    ],
    ['a rule', doc({ type: 'horizontalRule' })],
    ['a read-only inline node', doc(node('paragraph', { type: 'adfInline', attrs: { node: {} } }))],
  ])('keeps %s', (_name, held) => {
    expect(descriptionOf(held)).not.toBeNull()
  })

  it('is the ADF once there is text', () => {
    expect(descriptionOf(doc(paragraph(), paragraph('Plan it')))).toEqual({
      version: 1,
      type: 'doc',
      content: [paragraph(), paragraph('Plan it')],
    })
  })
})

describe('images pasted into the description', () => {
  const text = (value: string): EditorNode => ({ type: 'text', text: value })
  const paragraph = (value?: string): EditorNode => ({
    type: 'paragraph',
    ...(value !== undefined && { content: [text(value)] }),
  })
  const pending = (uploadId: string): EditorNode => ({
    type: 'adfImage',
    attrs: { node: null, uploadId },
  })
  const doc = (...content: EditorNode[]): EditorDoc => ({ type: 'doc', content })
  const single: AdfNode = { type: 'mediaSingle', content: [] }
  const held = (node: AdfNode): EditorNode => ({
    type: 'adfImage',
    attrs: { node, uploadId: null },
  })

  it('lists the upload ids in document order, each once, including images inside lists and quotes', () => {
    const quoted: EditorNode = { type: 'blockquote', content: [paragraph('q'), pending('c')] }
    const listed: EditorNode = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph('l'), pending('b')] }],
    }
    expect(pastedImages(doc(pending('a'), listed, quoted, pending('a')))).toEqual(['a', 'b', 'c'])
    expect(pastedImages(doc(paragraph('none')))).toEqual([])
  })

  it('takes every image out for the create, which has no issue to hold them', () => {
    const typed = doc(paragraph('Before'), pending('a'), paragraph('After'))
    const stripped = fillImages(typed, new Map())
    expect(stripped.content).toEqual([paragraph('Before'), paragraph('After')])
    expect(descriptionOf(stripped)).toMatchObject({
      content: [paragraph('Before'), paragraph('After')],
    })
    // Only an image: nothing is sent, as with an empty description.
    expect(descriptionOf(fillImages(doc(pending('a'), paragraph()), new Map()))).toBeNull()
  })

  it('puts each uploaded image where it was pasted, and drops one that failed', () => {
    const typed = doc(paragraph('Before'), pending('a'), pending('lost'), paragraph('After'))
    const filled = fillImages(typed, new Map([['a', single]]))
    expect(filled.content).toEqual([paragraph('Before'), held(single), paragraph('After')])
    expect(descriptionOf(filled)).toEqual({
      version: 1,
      type: 'doc',
      content: [paragraph('Before'), single, paragraph('After')],
    })
  })

  it('removes a quote that held only an image, and leaves an image already in place alone', () => {
    const typed = doc(
      { type: 'blockquote', content: [pending('a')] },
      held(single),
      paragraph('Text'),
    )
    expect(fillImages(typed, new Map()).content).toEqual([held(single), paragraph('Text')])
  })
})

describe('nextDraft', () => {
  it('clears the summary and the description, and keeps the rest', () => {
    const draft: CreateDraft = {
      ...initialDraft(byKey('P-1'), ISSUES),
      summary: 'One',
      description: { version: 1, type: 'doc', content: [] },
      labels: ['docs'],
      type: 'Bug',
    }

    expect(nextDraft(draft)).toEqual({ ...draft, summary: '', description: null })
  })
})

describe('withUploadFailures', () => {
  const notice = {
    title: 'Created P-9: Write it',
    notes: ['Jira added the label X.'],
    warned: false,
  }

  it('returns the notice as it was when every file attached', () => {
    expect(withUploadFailures(notice, 'P-9', [])).toBe(notice)
  })

  it('names each failed file and the created key, and keeps the notice until dismissed', () => {
    expect(
      withUploadFailures(notice, 'P-9', [
        { name: 'a.txt', reason: 'Jira said no.' },
        { name: 'b.txt', reason: 'The file is empty.' },
      ]),
    ).toEqual({
      title: 'Created P-9: Write it',
      notes: [
        'Jira added the label X.',
        'Could not attach a.txt to P-9. Jira said no.',
        'Could not attach b.txt to P-9. The file is empty.',
      ],
      warned: true,
    })
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

describe('describeLate', () => {
  const draft: CreateDraft = {
    ...initialDraft(byKey('P-1'), ISSUES),
    summary: 'Write it',
    estimate: '2h',
  }
  const held = (changes: Partial<Issue>) => ({
    ...issue('P-9', { parent: 'P-1', customer: ACME, engagement: NORTH }),
    summary: 'Write it',
    originalEstimateSeconds: 7200,
    sprints: [],
    ...changes,
    description: null,
    subtasks: [],
  })
  const read = (changes: Partial<Issue>) => ({ key: 'P-9', issue: held(changes) })
  const first = (changes: Partial<Issue>) =>
    describeCreated(draft, { key: 'P-9', warning: null, issue: held(changes) })

  it('names what the automation changed after the first read saw nothing', () => {
    const late = describeLate(draft, first({}), read({ customer: BETA, labels: ['PSAPAC'] }))

    expect(late).toEqual({
      title: 'Jira changed P-9 after it was created',
      notes: ['Customer is Beta Ltd (you chose Acme).', 'Jira added the label PSAPAC.'],
      warned: false,
    })
  })

  it('leaves out what the first notice already said', () => {
    const early = { labels: ['PSAPAC'], originalEstimateSeconds: 14400 }
    const late = describeLate(draft, first(early), read({ ...early, customer: BETA }))

    expect(late?.notes).toEqual(['Customer is Beta Ltd (you chose Acme).'])
  })

  it('says nothing when the late read adds nothing', () => {
    expect(describeLate(draft, first({}), read({}))).toBeNull()
    const early = { labels: ['PSAPAC'] }
    expect(describeLate(draft, first(early), read(early))).toBeNull()
  })

  it('names every change when the first read failed', () => {
    const failed = describeCreated(draft, { key: 'P-9', issue: null, warning: 'Could not read.' })

    expect(describeLate(draft, failed, read({ labels: ['PSAPAC'] }))?.notes).toEqual([
      'Jira added the label PSAPAC.',
    ])
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
