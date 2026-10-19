import { describe, expect, it } from 'vitest'

import { readSummaryDraft, summaryClick } from './summaryEdit'

describe('summaryClick', () => {
  it('opens the editor on a single click on the summary', () => {
    expect(summaryClick({ checking: false, onSummary: true })).toBe(true)
  })

  it('ignores a click off the summary', () => {
    expect(summaryClick({ checking: false, onSummary: false })).toBe(false)
  })

  it('never edits on a Shift+click or a Cmd+click, which check', () => {
    expect(summaryClick({ checking: true, onSummary: true })).toBe(false)
  })
})

describe('readSummaryDraft', () => {
  it('refuses an empty or blank summary', () => {
    expect(readSummaryDraft('', 'Old')).toEqual({ kind: 'empty' })
    expect(readSummaryDraft('  \t ', 'Old')).toEqual({ kind: 'empty' })
  })

  it('writes the trimmed summary', () => {
    expect(readSummaryDraft('  New  ', 'Old')).toEqual({ kind: 'save', summary: 'New' })
  })

  it('writes nothing when the summary did not change', () => {
    expect(readSummaryDraft('Old', 'Old')).toEqual({ kind: 'unchanged' })
    expect(readSummaryDraft(' Old ', 'Old')).toEqual({ kind: 'unchanged' })
  })
})
