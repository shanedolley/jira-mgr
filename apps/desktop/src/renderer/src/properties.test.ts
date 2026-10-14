import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import type { SprintOption } from '../../shared/ipc'
import {
  assignMeOutcome,
  assigneeChoices,
  assigneePatch,
  currentSprint,
  hoursFromText,
  hoursText,
  isLabel,
  labelsPatch,
  matchWords,
  parentChoices,
  parentMatch,
  projectLabels,
  recentAssignees,
  refusedNotice,
  shownSprints,
  sprintPatch,
  statusPatch,
  typePatch,
} from './properties'

const person = (accountId: string, displayName = accountId) => ({
  accountId,
  displayName,
  avatarUrl: null,
})

function issue(key: string, extra: Partial<Issue> = {}): Issue {
  return {
    key,
    summary: `Summary of ${key}`,
    issueType: { id: '10', name: 'Story', subtask: false, hierarchyLevel: 0 },
    status: { id: '1', name: 'To Do', category: 'new' },
    labels: [],
    sprints: [],
    assignee: null,
    customer: null,
    engagement: null,
    updated: '2026-10-01T00:00:00.000Z',
    ...extra,
  } as Issue
}

describe('recentAssignees', () => {
  it('lists assignees by the most recently updated issue, without me', () => {
    const issues = [
      issue('P-1', { assignee: person('ann'), updated: '2026-10-01T00:00:00.000Z' }),
      issue('P-2', { assignee: person('bob'), updated: '2026-10-05T00:00:00.000Z' }),
      issue('P-3', { assignee: person('me'), updated: '2026-10-09T00:00:00.000Z' }),
      issue('P-4', { assignee: person('ann'), updated: '2026-10-07T00:00:00.000Z' }),
      issue('P-5'),
    ]
    expect(recentAssignees(issues, 'me').map((p) => p.accountId)).toEqual(['ann', 'bob'])
  })

  it('keeps at most five', () => {
    const issues = Array.from({ length: 8 }, (_, i) =>
      issue(`P-${String(i)}`, {
        assignee: person(`u${String(i)}`),
        updated: `2026-10-0${String(i + 1)}T00:00:00.000Z`,
      }),
    )
    const recent = recentAssignees(issues, 'me')
    expect(recent).toHaveLength(5)
    expect(recent[0]?.accountId).toBe('u7')
  })
})

describe('assigneeChoices', () => {
  const me = person('me', 'Test User')
  const recent = [person('ann', 'Ann Lee')]

  it('puts Me and the recent assignees first, then the others from the search', () => {
    const found = [person('ann', 'Ann Lee'), person('cy', 'Cy Young')]
    const { suggested, others } = assigneeChoices(me, recent, found, '')
    expect(suggested.map((p) => p.accountId)).toEqual(['me', 'ann'])
    expect(others.map((p) => p.accountId)).toEqual(['cy'])
  })

  it('filters the suggested ones by the query, in any case', () => {
    const { suggested } = assigneeChoices(me, recent, [], 'ann')
    expect(suggested.map((p) => p.accountId)).toEqual(['ann'])
  })

  it('works before the current user has loaded', () => {
    expect(assigneeChoices(undefined, recent, [], '').suggested).toHaveLength(1)
  })
})

describe('shownSprints', () => {
  const sprint = (
    id: number,
    state: SprintOption['state'],
    startDate: string | null,
    endDate: string | null = null,
  ): SprintOption => ({ id, name: `S${String(id)}`, state, startDate, endDate })
  const all = [
    sprint(1, 'closed', '2026-08-01', '2026-08-14'),
    sprint(2, 'future', null),
    sprint(3, 'future', '2026-11-01'),
    sprint(4, 'active', '2026-10-01'),
    sprint(5, 'closed', '2026-09-01', '2026-09-14'),
    sprint(6, 'future', '2026-10-20'),
  ]

  it('shows the active sprint and dated future sprints, soonest first', () => {
    expect(shownSprints(all, false).map((s) => s.id)).toEqual([4, 6, 3])
  })

  it('keeps closed and undated sprints behind Show all, closed newest first', () => {
    expect(shownSprints(all, true).map((s) => s.id)).toEqual([4, 6, 3, 2, 5, 1])
  })
})

describe('currentSprint', () => {
  const s = (id: number, state: string) => ({ id, name: `S${String(id)}`, state })

  it('prefers the active sprint, then a future one, and never a closed one', () => {
    expect(currentSprint({ sprints: [s(1, 'closed'), s(2, 'future'), s(3, 'active')] })?.id).toBe(3)
    expect(currentSprint({ sprints: [s(1, 'closed'), s(2, 'future')] })?.id).toBe(2)
    expect(currentSprint({ sprints: [s(1, 'closed')] })).toBeNull()
  })
})

describe('labels', () => {
  it('lists the project labels, the most used first', () => {
    const issues = [
      issue('P-1', { labels: ['docs', 'ops'] }),
      issue('P-2', { labels: ['ops'] }),
      issue('P-3', { labels: ['api'] }),
    ]
    expect(projectLabels(issues)).toEqual(['ops', 'api', 'docs'])
  })

  it('accepts a label with no spaces and refuses one with a space', () => {
    expect(isLabel('needs-review')).toBe(true)
    expect(isLabel('two words')).toBe(false)
    expect(isLabel('')).toBe(false)
  })

  it('patches the labels on and off without duplicating', () => {
    const base = issue('P-1', { labels: ['a', 'b'] })
    expect(labelsPatch(base, 'c', true)).toEqual({ labels: ['a', 'b', 'c'] })
    expect(labelsPatch(base, 'a', true)).toEqual({ labels: ['b', 'a'] })
    expect(labelsPatch(base, 'a', false)).toEqual({ labels: ['b'] })
  })
})

describe('parentChoices', () => {
  const epic = (n: number, extra: Partial<Issue> = {}) =>
    issue(`P-${String(n)}`, {
      issueType: { id: '9', name: 'Epic', subtask: false, hierarchyLevel: 1 },
      ...extra,
    })

  it('offers Epics to a Story, open ones first and newest key first', () => {
    const done = { status: { id: '3', name: 'Done', category: 'done' as const } }
    const issues = [epic(9, done), epic(10), epic(100), issue('P-1'), issue('P-2')]
    const { shown } = parentChoices(issue('P-1'), issues, '')
    expect(shown.map((p) => p.key)).toEqual(['P-100', 'P-10', 'P-9'])
  })

  it('matches the key or the summary and reports the total beyond the limit', () => {
    const issues = Array.from({ length: 5 }, (_, i) => epic(i + 1))
    const { shown, total } = parentChoices(issue('P-99'), issues, 'summary of', 2)
    expect(shown).toHaveLength(2)
    expect(total).toBe(5)
    expect(parentChoices(issue('P-99'), issues, 'p-3').shown.map((p) => p.key)).toEqual(['P-3'])
  })
})

describe('parentMatch', () => {
  const acme = { id: '1', value: 'Acme' }
  const beta = { id: '2', value: 'Beta' }
  const north = { id: '7', value: 'North' }

  it('asks nothing when the parent holds the same Customer and Engagement', () => {
    const own = issue('P-1', { customer: acme, engagement: north })
    const parent = issue('P-2', { customer: acme, engagement: north })
    expect(parentMatch(own, parent)).toEqual({ customer: null, engagement: null })
  })

  it('names the Customer and the Engagement that differ', () => {
    const own = issue('P-1', { customer: acme, engagement: north })
    const parent = issue('P-2', { customer: beta, engagement: { id: '8', value: 'South' } })
    const result = parentMatch(own, parent)
    expect(result).toEqual({ customer: beta, engagement: { id: '8', value: 'South' } })
    expect(matchWords(result)).toBe('Customer and Engagement')
  })

  it('names only the field that differs, and never offers to clear one', () => {
    const own = issue('P-1', { customer: acme, engagement: north })
    const parent = issue('P-2', { customer: beta, engagement: null })
    const result = parentMatch(own, parent)
    expect(result).toEqual({ customer: beta, engagement: null })
    expect(matchWords(result)).toBe('Customer')
  })

  it('offers a parent value to an issue that has none', () => {
    expect(parentMatch(issue('P-1'), issue('P-2', { customer: acme })).customer).toEqual(acme)
  })
})

describe('patches', () => {
  it('assigns a person, or clears the assignee', () => {
    expect(assigneePatch(person('ann', 'Ann'))).toEqual({
      assignee: { accountId: 'ann', displayName: 'Ann', avatarUrl: null },
    })
    expect(assigneePatch(null)).toEqual({ assignee: null })
  })

  it('moves the status, keeping the category when Jira sent none', () => {
    const base = issue('P-1', { status: { id: '1', name: 'To Do', category: 'new' } })
    expect(statusPatch(base, { id: '2', name: 'In Progress', category: 'indeterminate' })).toEqual({
      status: { id: '2', name: 'In Progress', category: 'indeterminate' },
    })
    expect(statusPatch(base, { id: '5', name: 'Hold', category: null }).status?.category).toBe(
      'new',
    )
  })

  it('changes the type name and id but keeps the hierarchy level', () => {
    const patch = typePatch(issue('P-1'), { id: '11', name: 'Bug' })
    expect(patch.issueType).toEqual({ id: '11', name: 'Bug', subtask: false, hierarchyLevel: 0 })
  })

  it('moves into a sprint keeping the closed ones, and to the backlog dropping the open one', () => {
    const base = issue('P-1', {
      sprints: [
        { id: 1, name: 'Old', state: 'closed' },
        { id: 2, name: 'Now', state: 'active' },
      ],
    })
    const target: SprintOption = {
      id: 3,
      name: 'Next',
      state: 'future',
      startDate: '2026-11-01',
      endDate: null,
    }
    expect(sprintPatch(base, target).sprints?.map((s) => s.id)).toEqual([1, 3])
    expect(sprintPatch(base, null).sprints?.map((s) => s.id)).toEqual([1])
  })
})

describe('assignMeOutcome', () => {
  const me = { accountId: 'u1' }

  it('waits while the signed-in user is unknown, even for an unassigned issue', () => {
    expect(assignMeOutcome(issue('A-1', { assignee: null }), undefined)).toBe('wait')
    expect(assignMeOutcome(issue('A-1', { assignee: person('u2') }), undefined)).toBe('wait')
  })

  it('leaves an issue that is already mine', () => {
    expect(assignMeOutcome(issue('A-1', { assignee: person('u1') }), me)).toBe('mine')
  })

  it("takes an unassigned issue and another person's", () => {
    expect(assignMeOutcome(issue('A-1', { assignee: null }), me)).toBe('assign')
    expect(assignMeOutcome(issue('A-1', { assignee: person('u2') }), me)).toBe('assign')
  })
})

describe('refusedNotice', () => {
  it("names the property and gives Jira's reason, with no request", () => {
    const notice = refusedNotice(
      'Priority',
      new Error('Jira answered 400: priority: Not allowed for this issue.'),
    )
    expect(notice).toEqual({
      title: 'Priority not changed. Jira refused it: priority: Not allowed for this issue.',
      notes: [],
      warned: true,
    })
  })

  it("keeps Jira's next step when it gave no reason, and ends a sentence", () => {
    expect(refusedNotice('Status', new Error('Jira answered 403. Ask a Jira admin.')).title).toBe(
      'Status not changed. Jira refused it: Ask a Jira admin.',
    )
    expect(refusedNotice('Labels', new Error('Jira answered 400: no spaces')).title).toBe(
      'Labels not changed. Jira refused it: no spaces.',
    )
  })

  it('words a 5xx, or an answer with no reason, as a fault and keeps the next step', () => {
    expect(refusedNotice('Priority', new Error('Jira answered 500.')).title).toBe(
      'Priority not changed. Jira answered 500 and did not apply it.',
    )
    expect(refusedNotice('Priority', new Error('Jira answered 502.')).title).toBe(
      'Priority not changed. Jira answered 502 and did not apply it.',
    )
    expect(refusedNotice('Priority', new Error('Jira answered 503. Try again later.')).title).toBe(
      'Priority not changed. Jira answered 503 and did not apply it. Try again later.',
    )
    expect(refusedNotice('Priority', new Error('Jira answered 500: Boom.')).title).toBe(
      'Priority not changed. Jira answered 500 and did not apply it. Boom.',
    )
  })

  it('does not say Jira refused a failure that Jira never answered', () => {
    expect(refusedNotice('Sprint', new Error('Could not reach Jira.')).title).toBe(
      'Sprint not changed. Could not reach Jira.',
    )
    expect(refusedNotice('Sprint', 'odd').title).toBe('Sprint not changed. odd.')
  })
})

describe('Time remaining as a duration', () => {
  it.each([
    [null, ''],
    [0, '0m'],
    [0.25, '15m'],
    [1.5, '1h 30m'],
    [2, '2h'],
    [1 / 3, '20m'],
    [0.005, '0m'],
    [0.01, '1m'],
    [1000, '1000h'],
  ])('shows %j hours as %j', (hours, text) => {
    expect(hoursText(hours)).toBe(text)
  })

  it.each([
    ['', null],
    ['  ', null],
    ['0m', 0],
    ['15m', 0.25],
    ['1h 30m', 1.5],
    ['2h', 2],
    ['1d', 8],
    ['1w', 40],
  ])('reads %j as %j hours', (text, hours) => {
    expect(hoursFromText(text)).toBe(hours)
  })

  it.each(['soon', '1.5', '2', '-1h'])('refuses %j', (text) => {
    expect(hoursFromText(text)).toBeUndefined()
  })

  it('reads back what it shows', () => {
    for (const hours of [0.25, 1.5, 7.75]) expect(hoursFromText(hoursText(hours))).toBe(hours)
  })
})
