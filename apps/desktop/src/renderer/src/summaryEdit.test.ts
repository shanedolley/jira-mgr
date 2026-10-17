import { describe, expect, it } from 'vitest'

import { readSummaryDraft, summaryClick, type SummaryClick } from './summaryEdit'

const click = (over: Partial<SummaryClick> = {}) =>
  summaryClick({
    active: true,
    selected: true,
    detail: 1,
    shiftKey: false,
    onSummary: true,
    onPencil: false,
    ...over,
  })

describe('summaryClick', () => {
  it('waits out a double-click for a second click on the summary of the active row in the Peek', () => {
    expect(click()).toBe('later')
  })

  it('only selects on the first click of a row that is not active', () => {
    expect(click({ active: false })).toBeNull()
  })

  it('only selects while the Peek shows another issue, or none', () => {
    expect(click({ selected: false })).toBeNull()
  })

  it('leaves the second click of a double-click to open the page', () => {
    expect(click({ detail: 2 })).toBeNull()
  })

  it('ignores a click off the summary', () => {
    expect(click({ onSummary: false })).toBeNull()
  })

  it('never edits on a Shift+click, which checks a range', () => {
    expect(click({ shiftKey: true })).toBeNull()
    expect(click({ shiftKey: true, onSummary: false, onPencil: true })).toBeNull()
  })

  it('opens at once from the pencil, on any row', () => {
    expect(click({ active: false, selected: false, onSummary: false, onPencil: true })).toBe('now')
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
