import { describe, expect, it } from 'vitest'

import { typeKind } from './TypeIcon'

describe('typeKind', () => {
  it('maps the five types, ignoring case', () => {
    expect(['Epic', 'Story', 'Bug', 'Task', 'Subtask'].map(typeKind)).toEqual([
      'epic',
      'story',
      'bug',
      'task',
      'subtask',
    ])
    expect(typeKind('BUG')).toBe('bug')
    expect(typeKind('Sub-task')).toBe('subtask')
  })

  it('gives an unknown type the neutral icon', () => {
    expect(typeKind('Initiative')).toBe('other')
  })
})
