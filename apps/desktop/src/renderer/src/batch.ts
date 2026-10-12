import type { Issue } from '@jira-mgr/core'

import type { BatchChange, FieldChoice, SprintOption, StatusOption } from '../../shared/ipc'
import type { Notice } from './create'
import type { BatchRequestItem } from './optimistic'
import {
  assigneePatch,
  currentSprint,
  customerPatch,
  labelsPatch,
  priorityPatch,
  sprintPatch,
  statusPatch,
  type Person,
} from './properties'

/** At most this many keys are named in a notice; the rest are counted. */
export const NAMED_KEYS = 5

/** "1 issue", "2 issues". */
export const issues = (n: number): string => `${String(n)} ${n === 1 ? 'issue' : 'issues'}`

/** "PSAPAC-3, PSAPAC-4 and PSAPAC-5", or the first five and "and 2 more". */
export function namedKeys(keys: readonly string[]): string {
  const shown = keys.slice(0, NAMED_KEYS)
  if (keys.length > shown.length)
    return `${shown.join(', ')} and ${String(keys.length - shown.length)} more`
  return shown.length < 2
    ? (shown[0] ?? '')
    : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1) ?? ''}`
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * The notice for the issues a batch did not change: which ones, and why the first was refused. It
 * stays until dismissed, like any refusal. `what` names the field, as in "Status".
 */
export function refusedBatchNotice(
  what: string,
  refused: readonly { key: string; reason: string }[],
): Notice {
  const first = refused[0]
  return {
    title: `${what} not changed on ${issues(refused.length)}`,
    notes: [
      sentence(`Skipped ${namedKeys(refused.map(({ key }) => key))}`),
      ...(first === undefined ? [] : [sentence(`${first.key}: ${first.reason}`)]),
    ],
    warned: true,
  }
}

/** What one bulk action does to each issue, and how its notices read. */
export interface BulkAction {
  /** The field, as the undo words it: "status". */
  what: string
  /** What the toast says after the batch, from the count of issues Jira changed. */
  title: (changed: number) => string
  /** The change and the optimistic patch for one issue, or `null` when it already has the value. */
  change: (issue: Issue) => { change: BatchChange; patch: Partial<Issue> } | null
}

/** The batch for `action` over `issues`: only the issues the action would change. */
export function planBatch(issues: readonly Issue[], action: BulkAction): BatchRequestItem[] {
  return issues.flatMap((issue) => {
    const planned = action.change(issue)
    return planned === null ? [] : [{ key: issue.key, id: issue.id, ...planned }]
  })
}

export const statusAction = (option: StatusOption): BulkAction => ({
  what: 'status',
  title: (n) => `Status changed to ${option.name} on ${issues(n)}`,
  change: (issue) =>
    issue.status.id === option.id
      ? null
      : {
          change: { kind: 'status', statusId: option.id },
          patch: statusPatch(issue, option),
        },
})

/** `person` of `null` unassigns. */
export const assigneeAction = (person: Person | null): BulkAction => ({
  what: 'assignee',
  title: (n) => `Assignee changed to ${person?.displayName ?? 'Unassigned'} on ${issues(n)}`,
  change: (issue) =>
    (issue.assignee?.accountId ?? null) === (person?.accountId ?? null)
      ? null
      : {
          change: { kind: 'edit', changes: { assignee: person?.accountId ?? null } },
          patch: assigneePatch(person),
        },
})

export const priorityAction = (choice: FieldChoice): BulkAction => ({
  what: 'priority',
  title: (n) => `Priority changed to ${choice.name} on ${issues(n)}`,
  change: (issue) =>
    issue.priority?.id === choice.id
      ? null
      : {
          change: { kind: 'edit', changes: { priorityId: choice.id } },
          patch: priorityPatch(choice),
        },
})

export const customerAction = (choice: FieldChoice): BulkAction => ({
  what: 'Customer',
  title: (n) => `Customer changed to ${choice.name} on ${issues(n)}`,
  change: (issue) =>
    issue.customer?.id === choice.id
      ? null
      : {
          change: { kind: 'edit', changes: { customerId: choice.id } },
          patch: customerPatch(choice),
        },
})

/** Adds `label` to the issues that lack it, or with `on` false removes it from those that have it. */
export const labelAction = (label: string, on: boolean): BulkAction => ({
  what: 'labels',
  title: (n) => (on ? `Added ${label} to ${issues(n)}` : `Removed ${label} from ${issues(n)}`),
  change: (issue) =>
    issue.labels.includes(label) === on
      ? null
      : {
          change: {
            kind: 'edit',
            changes: on ? { addLabels: [label] } : { removeLabels: [label] },
          },
          patch: labelsPatch(issue, label, on),
        },
})

/** `sprint` of `null` moves the issues to the backlog. */
export const sprintAction = (sprint: SprintOption | null): BulkAction => ({
  what: 'sprint',
  title: (n) => `Sprint changed to ${sprint?.name ?? 'the backlog'} on ${issues(n)}`,
  change: (issue) =>
    (currentSprint(issue)?.id ?? null) === (sprint?.id ?? null)
      ? null
      : {
          change: { kind: 'sprint', sprintId: sprint?.id ?? null },
          patch: sprintPatch(issue, sprint),
        },
})
