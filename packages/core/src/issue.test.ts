import { describe, expect, it } from 'vitest'

import {
  assertTypeChangeAllowed,
  formatEstimate,
  parentCandidates,
  parseEstimate,
  propertyRules,
  type Issue,
} from './issue.js'

const type = (name: string): Issue['issueType'] => ({
  id: name,
  name,
  subtask: name === 'Subtask',
  hierarchyLevel: name === 'Epic' ? 1 : name === 'Subtask' ? -1 : 0,
})
const issue = (key: string, typeName: string) => ({ key, issueType: type(typeName) })

describe('propertyRules', () => {
  it('hides Sprint, the estimates and the parent on an Epic', () => {
    expect(propertyRules('Epic')).toEqual({
      sprint: false,
      estimates: false,
      parent: false,
      typeChange: false,
    })
  })

  it('lets a Story, Task or Bug change type and shows them everything else', () => {
    for (const name of ['Story', 'Task', 'Bug']) {
      expect(propertyRules(name)).toEqual({
        sprint: true,
        estimates: true,
        parent: true,
        typeChange: true,
      })
    }
  })

  it('shows a Subtask its Sprint, estimates and parent but fixes its type', () => {
    expect(propertyRules('Subtask')).toEqual({
      sprint: true,
      estimates: true,
      parent: true,
      typeChange: false,
    })
  })
})

describe('parentCandidates', () => {
  const all = [
    issue('P-1', 'Epic'),
    issue('P-2', 'Story'),
    issue('P-3', 'Bug'),
    issue('P-4', 'Subtask'),
    issue('P-5', 'Epic'),
  ]

  it('offers Epics to a Story, Task or Bug', () => {
    expect(parentCandidates(issue('P-2', 'Story'), all).map((i) => i.key)).toEqual(['P-1', 'P-5'])
  })

  it('offers Stories, Tasks and Bugs to a Subtask, never another Subtask or itself', () => {
    expect(parentCandidates(issue('P-4', 'Subtask'), all).map((i) => i.key)).toEqual(['P-2', 'P-3'])
  })

  it('offers an Epic nothing', () => {
    expect(parentCandidates(issue('P-1', 'Epic'), all)).toEqual([])
  })
})

describe('estimates', () => {
  it.each([
    ['30m', 1800],
    ['2h 30m', 9000],
    ['1d', 28800],
    ['1w 1d 1h', 144000 + 28800 + 3600],
  ])('reads %j as %i seconds', (text, seconds) => {
    expect(parseEstimate(text)).toBe(seconds)
  })

  it.each(['', '2', 'two hours', '1.5h', '1h30m', '-1h'])('refuses %j', (text) => {
    expect(parseEstimate(text)).toBeNull()
  })

  it.each([
    [0, '0m'],
    [60, '1m'],
    [3600, '1h'],
    [5400, '1h 30m'],
    [14400, '4h'],
    [360000, '100h'],
  ])('writes %i seconds as %j', (seconds, text) => {
    expect(formatEstimate(seconds)).toBe(text)
  })

  it('writes what it reads back to the same seconds for hours and minutes', () => {
    expect(parseEstimate(formatEstimate(5400))).toBe(5400)
  })
})

describe('assertTypeChangeAllowed', () => {
  it.each(['Story', 'Task', 'Bug'])('lets a %s change type', (name) => {
    expect(() => {
      assertTypeChangeAllowed('P-1', name)
    }).not.toThrow()
  })

  it.each([
    ['Epic', 'P-1 is an Epic. The type can change only among Story, Task and Bug.'],
    ['Subtask', 'P-1 is a Subtask. The type can change only among Story, Task and Bug.'],
  ])('refuses a %s with validation_failed and a message naming it', (name, message) => {
    expect(() => {
      assertTypeChangeAllowed('P-1', name)
    }).toThrow(expect.objectContaining({ code: 'validation_failed', message }))
  })
})
