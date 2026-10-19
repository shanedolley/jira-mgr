import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { dueTone, rowSprint, timeValue } from './rowProps'

const sprints = (...list: Issue['sprints']) => ({ sprints: list }) as Issue

describe('dueTone', () => {
  const today = '2026-10-11'

  it('is overdue on the day and after it', () => {
    expect(dueTone('2026-10-11', today, false)).toBe('overdue')
    expect(dueTone('2020-01-02', today, false)).toBe('overdue')
  })

  it('is soon for the next seven days and later after that', () => {
    expect(dueTone('2026-10-12', today, false)).toBe('soon')
    expect(dueTone('2026-10-18', today, false)).toBe('soon')
    expect(dueTone('2026-10-19', today, false)).toBe('later')
    expect(dueTone('2999-12-31', today, false)).toBe('later')
  })

  it('counts days across a month and a year end', () => {
    expect(dueTone('2027-01-03', '2026-12-28', false)).toBe('soon')
    expect(dueTone('2027-01-05', '2026-12-28', false)).toBe('later')
  })

  it('is never urgent for a Done issue', () => {
    expect(dueTone('2020-01-02', today, true)).toBe('later')
  })
})

describe('rowSprint', () => {
  const closed = { id: 3, name: 'S3', state: 'closed', endDate: null }
  const future = { id: 7, name: 'S7', state: 'future', endDate: null }
  const active = { id: 5, name: 'S5', state: 'active', endDate: null }

  it('prefers the active sprint, then the newest', () => {
    expect(rowSprint(sprints(closed, active, future))).toEqual(active)
    expect(rowSprint(sprints(closed, future))).toEqual(future)
    expect(rowSprint(sprints())).toBeUndefined()
  })
})

describe('timeValue', () => {
  const HOUR = 3600
  const story = {
    issueType: { id: '2', name: 'Story', subtask: false, hierarchyLevel: 0 },
    originalEstimateSeconds: 10 * HOUR,
    timeSpentSeconds: 2.5 * HOUR,
    remainingEstimateSeconds: 7.5 * HOUR,
  } as Issue
  const none = {
    ...story,
    originalEstimateSeconds: null,
    timeSpentSeconds: null,
    remainingEstimateSeconds: null,
  } as Issue

  it('writes hours and minutes, and Remaining % as 100 minus the percent used', () => {
    expect(timeValue(story, 'estimate')).toBe('10h')
    expect(timeValue(story, 'logged')).toBe('2h 30m')
    expect(timeValue(story, 'remaining')).toBe('7h 30m')
    expect(timeValue(story, 'remainingPercent')).toBe('75%')
  })

  it('takes Remaining from the remaining estimate, which may disagree with Remaining %', () => {
    expect(timeValue({ ...story, remainingEstimateSeconds: HOUR }, 'remaining')).toBe('1h')
    expect(timeValue({ ...story, remainingEstimateSeconds: HOUR }, 'remainingPercent')).toBe('75%')
  })

  it('floors Remaining % at 0% when more is logged than estimated, and reads 0% when exact', () => {
    expect(timeValue({ ...story, timeSpentSeconds: 12 * HOUR }, 'remainingPercent')).toBe('0%')
    expect(timeValue({ ...story, timeSpentSeconds: 10 * HOUR }, 'remainingPercent')).toBe('0%')
  })

  it('leaves Remaining % empty without an estimate, and reads no logged time as none', () => {
    expect(timeValue({ ...story, originalEstimateSeconds: null }, 'remainingPercent')).toBeNull()
    expect(timeValue({ ...story, timeSpentSeconds: null }, 'remainingPercent')).toBe('100%')
  })

  it('is empty for an issue Jira holds no time for', () => {
    for (const p of ['estimate', 'logged', 'remaining', 'remainingPercent'] as const) {
      expect(timeValue(none, p)).toBeNull()
    }
  })

  it('is empty for every property on an Epic', () => {
    const epic = {
      ...story,
      issueType: { ...story.issueType, name: 'Epic', hierarchyLevel: 1 },
    }
    for (const p of ['estimate', 'logged', 'remaining', 'remainingPercent'] as const) {
      expect(timeValue(epic, p)).toBeNull()
    }
  })
})
