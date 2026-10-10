import { describe, expect, it } from 'vitest'

import { priorityLevel } from './Glyphs'

describe('priorityLevel', () => {
  it('orders the names of a default Jira site and PSAPAC, ignoring case', () => {
    const names = ['Highest', 'High', 'Medium', 'Low', 'Lowest']
    expect(names.map(priorityLevel)).toEqual([4, 3, 2, 1, 1])
    expect(['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'].map(priorityLevel)).toEqual([
      4, 3, 2, 1, 1,
    ])
    expect(priorityLevel('HIGHEST')).toBe(4)
  })

  it('fills no bar for a name it does not know', () => {
    expect(priorityLevel('Question')).toBe(0)
  })
})
