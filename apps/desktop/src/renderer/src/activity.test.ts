import type { AdfDoc } from '@jira-mgr/core/adf'
import { describe, expect, it } from 'vitest'

import type { LinkItem, LinkTypeItem, WorklogItem } from '../../shared/ipc'
import {
  adfFromText,
  blankWorklog,
  findChoice,
  formatSize,
  groupLinks,
  linkChoices,
  linkPhrase,
  looksLikeKey,
  readWorklogForm,
  safeMarkdown,
  textFromAdf,
  toInputTime,
  totalSpent,
  worklogForm,
} from './activity'

const type = (id: string, name: string, inward: string, outward: string): LinkTypeItem => ({
  id,
  name,
  inward,
  outward,
})

const TYPES = [
  type('6', 'Polaris datapoint', 'is idea for', 'implements'),
  type('5', 'Cloners', 'is cloned by', 'clones'),
  type('2', 'Relates', 'relates to', 'relates to'),
  type('1', 'Blocks', 'is blocked by', 'blocks'),
  type('7', 'Test', 'is tested by', 'tests'),
  type('3', 'Duplicate', 'is duplicated by', 'duplicates'),
  type('4', 'Causes', 'is caused by', 'causes'),
]

describe('linkChoices', () => {
  it('puts Blocks, Relates, Duplicate, Causes and Clones first, then the rest in Jira order', () => {
    const { common, other } = linkChoices(TYPES)
    expect(common.map((c) => c.label)).toEqual([
      'blocks',
      'is blocked by',
      'relates to',
      'duplicates',
      'is duplicated by',
      'causes',
      'is caused by',
      'clones',
      'is cloned by',
    ])
    expect(other.map((c) => c.label)).toEqual([
      'implements',
      'is idea for',
      'tests',
      'is tested by',
    ])
  })

  it('lists a type once when its outward and inward text are equal', () => {
    const { common } = linkChoices(TYPES)
    expect(common.filter((c) => c.typeId === '2')).toEqual([
      { value: '2:outward', typeId: '2', direction: 'outward', label: 'relates to' },
    ])
  })

  it('gives each choice the direction it reads in', () => {
    const { common } = linkChoices(TYPES)
    expect(common.find((c) => c.label === 'blocks')).toMatchObject({
      typeId: '1',
      direction: 'outward',
    })
    expect(common.find((c) => c.label === 'is blocked by')).toMatchObject({
      typeId: '1',
      direction: 'inward',
    })
  })

  it('finds a choice by its option value, and none for a value it does not know', () => {
    expect(findChoice(TYPES, '1:inward')?.label).toBe('is blocked by')
    expect(findChoice(TYPES, '99:inward')).toBeUndefined()
    expect(findChoice(TYPES, '')).toBeUndefined()
  })
})

describe('links', () => {
  const blocks = type('1', 'Blocks', 'is blocked by', 'blocks')
  const link = (id: string, direction: 'outward' | 'inward', key: string): LinkItem => ({
    id,
    type: blocks,
    direction,
    issue: { key, summary: 'S', status: 'To Do' },
  })

  it('reads a link in the direction it was listed', () => {
    expect(linkPhrase(link('1', 'outward', 'PSAPAC-2'))).toBe('blocks')
    expect(linkPhrase(link('2', 'inward', 'PSAPAC-3'))).toBe('is blocked by')
  })

  it('groups links under their phrase, in order of first appearance', () => {
    const groups = groupLinks([
      link('1', 'inward', 'PSAPAC-3'),
      link('2', 'outward', 'PSAPAC-2'),
      link('3', 'inward', 'PSAPAC-4'),
    ])
    expect(groups.map((g) => [g.phrase, g.links.map((l) => l.id)])).toEqual([
      ['is blocked by', ['1', '3']],
      ['blocks', ['2']],
    ])
  })

  it('knows what an issue key looks like', () => {
    expect(looksLikeKey('PSAPAC-12')).toBe(true)
    expect(['psapac-12', 'PSAPAC-0', 'PSAPAC-', 'PSAPAC-12 ', '12'].some(looksLikeKey)).toBe(false)
  })
})

describe('worklog form', () => {
  const now = new Date(2026, 9, 10, 14, 30)

  it('starts on the local date given, with nothing logged', () => {
    expect(blankWorklog(now)).toEqual({ timeSpent: '', started: '2026-10-10', comment: '' })
  })

  it('starts a worklog dated for a day at the time of day it is logged', () => {
    const request = readWorklogForm(
      { timeSpent: '1.25 hours', started: '2026-10-08', comment: '' },
      false,
      now,
    )
    expect(request).toMatchObject({
      ok: true,
      timeSpent: '1h 15m',
      started: new Date(2026, 9, 8, 14, 30).toISOString(),
    })
  })

  it('reads a Jira duration, a start as an instant, and an empty comment as none', () => {
    const request = readWorklogForm({
      timeSpent: ' 1h 30m ',
      started: '2026-10-10T14:30',
      comment: '  ',
    })
    expect(request).toEqual({
      ok: true,
      timeSpent: '1h 30m',
      started: new Date(2026, 9, 10, 14, 30).toISOString(),
      comment: undefined,
    })
  })

  it('turns a comment into one paragraph per line', () => {
    const request = readWorklogForm({
      timeSpent: '1h',
      started: '2026-10-10T14:30',
      comment: 'a\nb',
    })
    expect(request.ok && request.comment?.content).toHaveLength(2)
  })

  it.each([
    [
      'a time that is not a duration',
      { timeSpent: 'an hour', started: '2026-10-10T14:30' },
      'timeSpent',
    ],
    ['no time', { timeSpent: '', started: '2026-10-10T14:30' }, 'timeSpent'],
    ['a zero time', { timeSpent: '0h', started: '2026-10-10' }, 'timeSpent'],
    ['no start', { timeSpent: '1h', started: '' }, 'started'],
  ])('refuses %s', (_name, form, field) => {
    expect(readWorklogForm({ comment: '', ...form })).toMatchObject({ ok: false, field })
  })

  it('refuses to empty a comment the worklog had, since an edit cannot clear one', () => {
    const request = readWorklogForm(
      { timeSpent: '1h', started: '2026-10-10T14:30', comment: '' },
      true,
    )
    expect(request).toMatchObject({ ok: false })
  })

  it('fills the form from a worklog', () => {
    const worklog = {
      timeSpent: '2h',
      started: new Date(2026, 9, 10, 9, 5).toISOString(),
      comment: adfFromText('Reviewed'),
    } as WorklogItem
    expect(worklogForm(worklog)).toEqual({
      timeSpent: '2h',
      started: '2026-10-10T09:05',
      comment: 'Reviewed',
    })
  })

  it('totals the time logged', () => {
    expect(
      totalSpent([{ timeSpentSeconds: 3600 }, { timeSpentSeconds: 1800 }] as WorklogItem[]),
    ).toBe(5400)
  })

  it('writes a local input time', () => {
    expect(toInputTime(new Date(2026, 0, 2, 3, 4).toISOString())).toBe('2026-01-02T03:04')
  })
})

describe('text and documents', () => {
  it('has no document for text with no words', () => {
    expect(adfFromText('')).toBeNull()
    expect(adfFromText(' \n ')).toBeNull()
  })

  it('reads a document back as lines of text', () => {
    const doc: AdfDoc = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'One' },
            { type: 'hardBreak' },
            { type: 'text', text: 'two' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Three' }] },
      ],
    }
    expect(textFromAdf(doc)).toBe('One\ntwo\nThree')
    expect(textFromAdf(null)).toBe('')
  })

  it('renders a document as Markdown for the fallback view', () => {
    const doc: AdfDoc = {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    }
    expect(safeMarkdown(doc)).toContain('Hello')
  })
})

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [100_792, '100.8 KB'],
    [5_000_000, '5.0 MB'],
    [2_500_000_000, '2.5 GB'],
  ])('%i bytes is %s', (bytes, text) => {
    expect(formatSize(bytes)).toBe(text)
  })
})
