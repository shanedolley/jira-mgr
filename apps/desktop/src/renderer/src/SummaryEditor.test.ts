import { describe, expect, it } from 'vitest'

import { summaryKeyAction } from './SummaryEditor'

const key = (key: string, isComposing = false) => summaryKeyAction({ key, isComposing })

describe('summaryKeyAction', () => {
  it('saves on Enter and cancels on Escape', () => {
    expect(key('Enter')).toBe('save')
    expect(key('Escape')).toBe('cancel')
  })

  it('ignores other keys', () => {
    expect(key('a')).toBeNull()
  })

  it('leaves Enter and Escape to the IME while it composes', () => {
    expect(key('Enter', true)).toBeNull()
    expect(key('Escape', true)).toBeNull()
  })
})
