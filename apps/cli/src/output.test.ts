import type { Issue } from '@jira-mgr/core'
import type { CustomerGroup, HierarchyNode } from '@jira-mgr/core/hierarchy'
import { describe, expect, it } from 'vitest'

import {
  colourOn,
  localDateTime,
  paint,
  renderRecord,
  renderTable,
  renderTree,
  statusStyle,
  stripControl,
  truncate,
  ttyOf,
  type Tty,
} from './output.js'
import { fakeIo } from './test-io.js'

const plain = (columns: number): Tty => ({ columns, style: (_, text) => text })

describe('output', () => {
  it('tables pad columns and truncate the summary to the width', () => {
    const columns = [{ header: 'KEY' }, { header: 'ASSIGNEE', max: 10 }, { header: 'SUMMARY' }]
    const rows = [
      [
        'PSAPAC-12',
        'Shane Dolley and friends',
        'Build the loader for the very long migration plan',
      ],
      ['PSAPAC-3', 'Me', 'Short'],
    ]
    expect(renderTable(plain(40), columns, rows).split('\n')).toEqual([
      'KEY        ASSIGNEE    SUMMARY',
      'PSAPAC-12  Shane Dol…  Build the loader fo…',
      'PSAPAC-3   Me          Short',
    ])
  })

  it('tables keep at least 20 characters for the last column and style the header', () => {
    const rows = [['PSAPAC-12', 'x'.repeat(60)]]
    const [, line] = renderTable(plain(5), [{ header: 'KEY' }, { header: 'SUMMARY' }], rows).split(
      '\n',
    )
    expect(line).toBe(`PSAPAC-12  ${'x'.repeat(19)}…`)
    const bold: Tty = { columns: 80, style: (format, text) => `<${String(format)}>${text}` }
    expect(renderTable(bold, [{ header: 'KEY' }], [['a']]).split('\n')[0]).toBe('<bold>KEY')
  })

  it('no colour without a TTY or with NO_COLOR', () => {
    const red = '\u001b[31mx\u001b[39m'
    expect(paint(fakeIo().io, false, 'red', 'x')).toBe('x')
    expect(paint(fakeIo().io, true, 'red', 'x')).toBe(red)
    expect(paint(fakeIo({ env: { NO_COLOR: '1' } }).io, true, 'red', 'x')).toBe('x')
    expect(paint(fakeIo({ env: { FORCE_COLOR: '1' } }).io, false, 'red', 'x')).toBe(red)
    expect(paint(fakeIo({ env: { FORCE_COLOR: '0' } }).io, true, 'red', 'x')).toBe('x')
    expect(colourOn({ NO_COLOR: '1', FORCE_COLOR: '1' }, true)).toBe(false)
    const tty = ttyOf(fakeIo({ stdoutIsTTY: true, columns: 60 }).io)
    expect(tty.columns).toBe(60)
    expect(tty.style('bold', 'x')).toBe('\u001b[1mx\u001b[22m')
    expect(ttyOf(fakeIo().io).columns).toBe(100)
  })

  it('control characters are stripped on a TTY', () => {
    expect(stripControl('a\u001b[31mb\u0007c\u009bd\u0000e\u007f')).toBe('a[31mbcde')
    expect(stripControl('keep\ttabs\nand newlines')).toBe('keep\ttabs\nand newlines')
    const table = renderTable(
      plain(80),
      [{ header: 'KEY' }, { header: 'SUMMARY' }],
      [['P-1', 'bad\u001b]0;title\u0007 text']],
    )
    expect(table.replaceAll('\n', '')).not.toMatch(/\p{Cc}/u)
    expect(table).toContain('bad]0;title text')
  })

  it('truncate ends in an ellipsis within the limit', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(truncate('abcd', 4)).toBe('abcd')
  })

  it('records align their values and strip control characters', () => {
    const rows = [
      ['Site', 'https://a.example'],
      ['Account id', 'x\u001b[31my'],
    ] as const
    expect(renderRecord(plain(80), rows)).toBe('Site:       https://a.example\nAccount id: x[31my')
    const bold: Tty = { columns: 80, style: (format, text) => `<${String(format)}>${text}` }
    expect(renderRecord(bold, [['Site', 'a']])).toBe('<bold>Site: a')
  })

  it('local times print as YYYY-MM-DD HH:mm in the machine zone', () => {
    expect(localDateTime(new Date(2026, 9, 7, 13, 5).toISOString())).toBe('2026-10-07 13:05')
    expect(localDateTime(new Date(2026, 0, 2, 3, 4).toISOString())).toBe('2026-01-02 03:04')
  })

  it('a column paint styles the text and leaves the padding and the widths alone', () => {
    const tagged: Tty = { columns: 80, style: (_, text) => text }
    const columns = [
      { header: 'KEY' },
      { header: 'STATUS', paint: (cell: string, row: number) => `<${String(row)}:${cell}>` },
      { header: 'SUMMARY' },
    ]
    const rows = [
      ['P-1', 'To Do', 'one'],
      ['P-22', 'In Progress', 'two'],
    ]
    expect(renderTable(tagged, columns, rows).split('\n')).toEqual([
      'KEY   STATUS       SUMMARY',
      'P-1   <0:To Do>        one',
      'P-22  <1:In Progress>  two',
    ])
  })

  it('a record paint styles the cleaned value', () => {
    const tty: Tty = { columns: 80, style: (_, text) => text }
    expect(renderRecord(tty, [['Status', 'Do\u001bne', (value) => `[${value}]`]])).toBe(
      'Status: [Done]',
    )
  })

  it('status colour follows the category: none for to do, blue for in progress, green for done', () => {
    const colour = ttyOf(fakeIo({ stdoutIsTTY: true }).io)
    expect(statusStyle(colour, 'new', 'To Do')).toBe('To Do')
    expect(statusStyle(colour, 'undefined', 'Odd')).toBe('Odd')
    expect(statusStyle(colour, 'indeterminate', 'Review')).toBe('\u001b[34mReview\u001b[39m')
    expect(statusStyle(colour, 'done', 'Done')).toBe('\u001b[32mDone\u001b[39m')
    const none = ttyOf(fakeIo({ stdoutIsTTY: true, env: { NO_COLOR: '1' } }).io)
    expect(statusStyle(none, 'done', 'Done')).toBe('Done')
  })
})

const issue = (
  key: string,
  type: string,
  status: string,
  summary: string,
  category: Issue['status']['category'] = 'new',
): Issue =>
  ({
    key,
    summary,
    issueType: { name: type },
    status: { name: status, category },
  }) as Issue

const node = (i: Issue, extra: Partial<HierarchyNode> = {}): HierarchyNode => ({
  issue: i,
  children: [],
  doneChildren: [],
  doneCount: 0,
  contextOnly: false,
  customerMismatch: null,
  ...extra,
})

const ACME = { id: '1', value: 'Acme Corp' }
const BETA = { id: '2', value: 'Beta Ltd' }

/** The tree from the CLI design: a mismatch, a Subtask, a Done chip, No Epic and No Customer. */
const ACME_GROUP: CustomerGroup = {
  customer: ACME,
  epics: [
    node(issue('PSAPAC-100', 'Epic', 'In Progress', 'Data migration', 'indeterminate'), {
      children: [
        node(issue('PSAPAC-120', 'Story', 'To Do', 'Build the loader'), {
          children: [
            node(issue('PSAPAC-121', 'Subtask', 'In Progress', 'Write the tests', 'indeterminate')),
          ],
          customerMismatch: { own: BETA, epic: ACME },
        }),
      ],
      doneCount: 3,
    }),
  ],
  noEpic: [node(issue('PSAPAC-130', 'Story', 'Review', 'Fix the login', 'indeterminate'))],
}
const GROUPS: CustomerGroup[] = [ACME_GROUP, { customer: null, epics: [], noEpic: [] }]

describe('renderTree', () => {
  const plainTty: Tty = { columns: 200, style: (_, text) => text }

  it('prints the C7 hierarchy at two spaces a level', () => {
    expect(renderTree(plainTty, GROUPS).split('\n')).toEqual([
      'Acme Corp',
      '  PSAPAC-100  Epic     In Progress  Data migration',
      '    PSAPAC-120  Story    To Do        Build the loader  [Customer: Beta Ltd, Epic: Acme Corp]',
      '      PSAPAC-121  Subtask  In Progress  Write the tests',
      '    +3 done',
      '  No Epic',
      '    PSAPAC-130  Story    Review       Fix the login',
      'No Customer',
    ])
  })

  it('names a missing Customer in the badge, and prints No Customer for a null group', () => {
    const groups: CustomerGroup[] = [
      {
        customer: null,
        epics: [],
        noEpic: [
          node(issue('PSAPAC-1', 'Story', 'To Do', 'Loose'), {
            customerMismatch: { own: null, epic: ACME },
          }),
        ],
      },
    ]
    expect(renderTree(plainTty, groups).split('\n')).toEqual([
      'No Customer',
      '  No Epic',
      '    PSAPAC-1  Story    To Do  Loose  [Customer: No Customer, Epic: Acme Corp]',
    ])
  })

  it('names No Customer for whichever side of a mismatch has none, or both', () => {
    const story = (mismatch: NonNullable<HierarchyNode['customerMismatch']>) => [
      {
        customer: null,
        epics: [],
        noEpic: [
          node(issue('PSAPAC-1', 'Story', 'To Do', 'Loose'), { customerMismatch: mismatch }),
        ],
      },
    ]
    const badge = (mismatch: NonNullable<HierarchyNode['customerMismatch']>) =>
      renderTree(plainTty, story(mismatch)).split('\n')[2]
    expect(badge({ own: BETA, epic: null })).toBe(
      '    PSAPAC-1  Story    To Do  Loose  [Customer: Beta Ltd, Epic: No Customer]',
    )
    expect(badge({ own: null, epic: null })).toBe(
      '    PSAPAC-1  Story    To Do  Loose  [Customer: No Customer, Epic: No Customer]',
    )
    expect(badge({ own: null, epic: ACME })).toBe(
      '    PSAPAC-1  Story    To Do  Loose  [Customer: No Customer, Epic: Acme Corp]',
    )
  })

  it('marks a context-only row (context) without colour', () => {
    const groups: CustomerGroup[] = [
      {
        customer: ACME,
        epics: [node(issue('PSAPAC-100', 'Epic', 'To Do', 'Parent'), { contextOnly: true })],
        noEpic: [],
      },
    ]
    expect(renderTree(plainTty, groups)).toBe(
      'Acme Corp\n  PSAPAC-100  Epic     To Do  Parent (context)',
    )
  })

  it('with colour dims a context row whole, and colours the status, badge and Customer', () => {
    const colour = ttyOf(fakeIo({ stdoutIsTTY: true, columns: 200 }).io)
    const lines = renderTree(colour, [
      {
        ...ACME_GROUP,
        epics: [node(issue('PSAPAC-9', 'Epic', 'Done', 'Old', 'done'), { contextOnly: true })],
      },
      ACME_GROUP,
    ]).split('\n')
    expect(lines[0]).toBe('\u001b[1mAcme Corp\u001b[22m')
    expect(lines[1]).toBe('\u001b[2m  PSAPAC-9  Epic     Done         Old\u001b[22m')
    const story = lines.find((l) => l.includes('PSAPAC-120')) ?? ''
    expect(story).toContain('To Do        Build the loader')
    expect(story.endsWith('\u001b[33m  [Customer: Beta Ltd, Epic: Acme Corp]\u001b[39m')).toBe(true)
    expect(lines.find((l) => l.includes('PSAPAC-100'))).toContain('\u001b[34mIn Progress\u001b[39m')
    expect(lines.find((l) => l.includes('PSAPAC-9'))).not.toContain('\u001b[32m')
  })

  it('truncates the summary to the width, never below 20 characters, and keeps the badge', () => {
    const long = 'x'.repeat(100)
    const groups: CustomerGroup[] = [
      {
        customer: ACME,
        epics: [node(issue('PSAPAC-1', 'Epic', 'To Do', long))],
        noEpic: [
          node(issue('PSAPAC-2', 'Story', 'To Do', long), {
            customerMismatch: { own: BETA, epic: ACME },
          }),
        ],
      },
    ]
    const [, epic, , story] = renderTree({ columns: 60, style: (_, t) => t }, groups).split('\n')
    expect(epic).toBe(`  PSAPAC-1  Epic     To Do  ${'x'.repeat(31)}…`)
    expect(story).toBe(
      `    PSAPAC-2  Story    To Do  ${'x'.repeat(19)}…  [Customer: Beta Ltd, Epic: Acme Corp]`,
    )
  })

  it('strips control characters from Jira text', () => {
    const groups: CustomerGroup[] = [
      {
        customer: { id: '1', value: 'Ev\u001bce' },
        epics: [node(issue('PSAPAC-1', 'Epic', 'To\u0007 Do', 'Sum\u001b]0;x\u0007mary'))],
        noEpic: [],
      },
    ]
    const text = renderTree(plainTty, groups)
    expect(text).not.toMatch(/\p{Cc}(?<!\n)/u)
    expect(text).toBe('Evce\n  PSAPAC-1  Epic     To Do  Sum]0;xmary')
  })
})
