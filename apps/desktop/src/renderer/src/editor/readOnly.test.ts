import type { AdfNode } from '@jira-mgr/core/adf'
import { formatDate } from '@jira-mgr/core/display'
import { describe, expect, it } from 'vitest'

import { blockLabel, blockText, inlineShape, tableRows } from './readOnly'

const text = (value: string): AdfNode => ({ type: 'text', text: value })
const para = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content })

describe('blockLabel', () => {
  it('labels a panel, a table, an expand, a macro and an unknown block', () => {
    expect(blockLabel({ type: 'panel' })).toBe('Panel')
    expect(blockLabel({ type: 'table' })).toBe('Table')
    expect(blockLabel({ type: 'expand' })).toBe('Expand')
    expect(blockLabel({ type: 'extension' })).toBe('Jira macro')
    expect(blockLabel({ type: 'bodiedExtension' })).toBe('Jira macro')
    expect(blockLabel({ type: 'mediaGroup' })).toBe('Files')
    expect(blockLabel({ type: 'taskList' })).toBe('Tasks')
    expect(blockLabel({ type: 'decisionList' })).toBe('Decisions')
    expect(blockLabel({ type: 'layoutSection' })).toBe('Layout')
    expect(blockLabel({ type: 'futureNode' })).toBe('futureNode')
  })
})

describe('blockText', () => {
  it("gives a block's plain text, one line per paragraph", () => {
    const panel: AdfNode = {
      type: 'panel',
      content: [para(text('First '), text('line')), para(text('Second')), para()],
    }
    expect(blockText(panel)).toBe('First line\nSecond')
  })

  it('reads nested lists and inline nodes', () => {
    const list: AdfNode = {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          content: [text('Ask '), { type: 'mention', attrs: { id: 'u', text: '@Cy' } }],
        },
      ],
    }
    expect(blockText(list)).toBe('Ask @Cy')
  })

  it('shows the URL of an external image', () => {
    const image: AdfNode = {
      type: 'mediaSingle',
      content: [{ type: 'media', attrs: { type: 'external', url: 'https://example.test/a.png' } }],
    }
    expect(blockText(image)).toBe('https://example.test/a.png')
  })
})

describe('tableRows', () => {
  it("gives a table's cells as rows of text", () => {
    const cell = (value: string): AdfNode => ({ type: 'tableCell', content: [para(text(value))] })
    const table: AdfNode = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('A'), cell('B')] },
        { type: 'tableRow', content: [cell('C'), { type: 'tableCell', content: [para()] }] },
      ],
    }
    expect(tableRows(table)).toEqual([
      ['A', 'B'],
      ['C', ''],
    ])
  })
})

describe('inlineShape', () => {
  it('reads a date node as its UTC day in any zone', () => {
    const midnight = String(Date.UTC(2026, 9, 19))
    expect(inlineShape({ type: 'date', attrs: { timestamp: midnight } }).text).toBe(
      formatDate('2026-10-19'),
    )
  })

  it('labels a mention, emoji, date, status and inlineCard', () => {
    expect(inlineShape({ type: 'mention', attrs: { id: 'u1', text: '@Cy Young' } })).toEqual({
      kind: 'mention',
      text: '@Cy Young',
      title: 'u1',
    })
    expect(inlineShape({ type: 'mention', attrs: { id: 'u1', text: 'Cy Young' } }).text).toBe(
      '@Cy Young',
    )
    expect(
      inlineShape({ type: 'emoji', attrs: { shortName: ':tada:', text: '\u{1F389}' } }).text,
    ).toBe('\u{1F389}')
    expect(inlineShape({ type: 'emoji', attrs: { shortName: ':tada:' } }).text).toBe(':tada:')
    expect(inlineShape({ type: 'status', attrs: { text: 'IN REVIEW' } }).text).toBe('IN REVIEW')
    expect(inlineShape({ type: 'date', attrs: { timestamp: '1760000000000' } }).text).toBe(
      formatDate(new Date(1760000000000).toISOString()),
    )
    expect(inlineShape({ type: 'inlineCard', attrs: { url: 'https://example.test/x' } })).toEqual({
      kind: 'link',
      text: 'https://example.test/x',
      url: 'https://example.test/x',
    })
    expect(inlineShape({ type: 'mediaInline' }).text).toBe('Attachment')
    expect(inlineShape({ type: 'placeholder' }).text).toBe('[placeholder]')
  })
})
