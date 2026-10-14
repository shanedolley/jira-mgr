import { describe, expect, it } from 'vitest'

import {
  assertTypeChangeAllowed,
  DURATION_PATTERN,
  formatEstimate,
  parentCandidates,
  parseDuration,
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
  const rules = (name: string) => propertyRules(type(name))

  it('hides Sprint, the estimates and the parent on an Epic', () => {
    expect(rules('Epic')).toEqual({
      sprint: false,
      estimates: false,
      parent: false,
      typeChange: false,
    })
  })

  it('lets a Story, Task or Bug change type and shows them everything else', () => {
    for (const name of ['Story', 'Task', 'Bug']) {
      expect(rules(name)).toEqual({
        sprint: true,
        estimates: true,
        parent: true,
        typeChange: true,
      })
    }
  })

  it('hides Sprint on a Subtask and fixes its type, but shows its estimates and parent', () => {
    expect(rules('Subtask')).toEqual({
      sprint: false,
      estimates: true,
      parent: true,
      typeChange: false,
    })
  })

  it('reads a Subtask from the issue type flag, not its name', () => {
    expect(propertyRules({ name: 'Sub-task', subtask: true }).sprint).toBe(false)
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

describe('parseDuration', () => {
  it.each([
    ['1h 15m', '1h 15m'],
    ['1h15m', '1h 15m'],
    ['1.25h', '1h 15m'],
    ['1.25 hours', '1h 15m'],
    ['1 hour 15 minutes', '1h 15m'],
    ['90m', '1h 30m'],
    ['2d', '2d'],
    ['30 mins', '30m'],
    ['1 hr', '1h'],
    ['  1H 30M  ', '1h 30m'],
    ['1 hour, 15 minutes', '1h 15m'],
    ['1 hour and 15 minutes', '1h 15m'],
    ['0.5d', '4h'],
    ['1.5w', '1w 20h'],
    ['1w 2d 3h 4m', '1w 2d 3h 4m'],
    ['0.999h', '1h'],
    ['0.01h', '1m'],
    ['1h 45m 30m', '2h 15m'],
  ])('reads %j as %j', (text, written) => {
    expect(parseDuration(text)).toBe(written)
  })

  it.each([
    '',
    '   ',
    '0',
    '0h',
    '0m',
    '0.001h',
    '-1h',
    '1',
    '1h 15',
    'an hour',
    'abc',
    '1x',
    '1 hourly',
    '1h; drop',
    '1,5h',
    '1e3h',
    '1h and',
    'and 1h',
    '1h,,15m',
    '1h andand 15m',
    '1h | 15m',
  ])('refuses %j', (text) => {
    expect(parseDuration(text)).toBeNull()
  })

  it('refuses a long run of spaces before a stray character in linear time', () => {
    const start = performance.now()
    expect(parseDuration(`1h${' '.repeat(100_000)}!1m`)).toBeNull()
    // Linear takes a few milliseconds; a backtracking pattern takes tens of seconds.
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('always writes a string Jira accepts', () => {
    for (const text of ['1.25h', '90m', '2d', '1w 3.5d', '0.999h']) {
      expect(parseDuration(text)).toMatch(DURATION_PATTERN)
    }
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
