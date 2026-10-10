import { describe, expect, it } from 'vitest'

import { statusShape } from './StatusDot'

describe('statusShape', () => {
  it('gives each category its own shape', () => {
    expect(statusShape('new')).toBe('ring')
    expect(statusShape('indeterminate')).toBe('half')
    expect(statusShape('done')).toBe('check')
  })

  it('draws an unknown category as the To Do ring', () => {
    expect(statusShape('undefined')).toBe('ring')
  })
})
