import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearDrafts,
  commentDraftKey,
  draftCount,
  dropDraft,
  dropDraftsOf,
  getDraft,
  hasDraftsOf,
  newCommentDraftKey,
  putDraft,
  subscribeDrafts,
} from './drafts'

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

  it("keeps a comment's edit and the comment box beside the description's, and drops them with the issue", () => {
    const draft = { doc, base: null }
    putDraft('PSAPAC-1', draft)
    putDraft(commentDraftKey('PSAPAC-1', '7'), draft)
    putDraft(newCommentDraftKey('PSAPAC-1'), draft)
    putDraft(commentDraftKey('PSAPAC-12', '7'), draft)
    expect(draftCount()).toBe(4)
    expect(hasDraftsOf('PSAPAC-1')).toBe(true)

    // PSAPAC-12 starts with the same text as PSAPAC-1 and must keep its draft.
    dropDraftsOf('PSAPAC-1')
    expect(draftCount()).toBe(1)
    expect(hasDraftsOf('PSAPAC-1')).toBe(false)
    expect(hasDraftsOf('PSAPAC-12')).toBe(true)
    clearDrafts()
  })
})
