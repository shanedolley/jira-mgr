import { describe, expect, it } from 'vitest'

import { commitDraft } from './estimate'

describe('commitDraft', () => {
  it('saves a new duration as typed, trimmed, with its seconds', () => {
    expect(commitDraft(' 2h 30m ', null)).toEqual({ kind: 'save', text: '2h 30m', seconds: 9000 })
    expect(commitDraft('1w 2d', 3600)).toEqual({ kind: 'save', text: '1w 2d', seconds: 201_600 })
  })

  it('sends nothing for the estimate the issue already has', () => {
    expect(commitDraft('2h 30m', 9000)).toEqual({ kind: 'same' })
    expect(commitDraft('150m', 9000)).toEqual({ kind: 'same' })
  })

  it('refuses text that is not a duration', () => {
    for (const draft of ['soon', '2.5h', '2h30m', '2 h', '-1h'])
      expect(commitDraft(draft, 3600)).toEqual({ kind: 'invalid' })
  })

  it('refuses an empty draft on an issue with an estimate and ignores it on one without', () => {
    expect(commitDraft('', 3600)).toEqual({ kind: 'invalid' })
    expect(commitDraft('   ', 3600)).toEqual({ kind: 'invalid' })
    expect(commitDraft('', null)).toEqual({ kind: 'same' })
  })
})
