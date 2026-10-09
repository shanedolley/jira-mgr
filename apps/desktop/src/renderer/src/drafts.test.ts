import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearDrafts, draftCount, dropDraft, getDraft, putDraft, subscribeDrafts } from './drafts'

const doc = { type: 'doc' as const, content: [{ type: 'paragraph' }] }

afterEach(() => {
  clearDrafts()
})

describe('drafts', () => {
  it('keeps a draft per issue until it is saved or discarded', () => {
    putDraft('PSAPAC-1', { doc, base: null })
    putDraft('PSAPAC-2', { doc, base: null })
    expect(draftCount()).toBe(2)
    expect(getDraft('PSAPAC-1')).toEqual({ doc, base: null })
    // A newer draft of the same issue replaces the old one.
    const next = { doc: { ...doc, content: [] }, base: null }
    putDraft('PSAPAC-1', next)
    expect(getDraft('PSAPAC-1')).toBe(next)
    expect(draftCount()).toBe(2)
    dropDraft('PSAPAC-1')
    expect(getDraft('PSAPAC-1')).toBeUndefined()
    expect(draftCount()).toBe(1)
  })

  it('logout removes every draft', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeDrafts(listener)
    putDraft('PSAPAC-1', { doc, base: null })
    putDraft('PSAPAC-2', { doc, base: null })
    clearDrafts()
    expect(draftCount()).toBe(0)
    expect(getDraft('PSAPAC-2')).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    putDraft('PSAPAC-3', { doc, base: null })
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
