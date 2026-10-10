import type { Issue } from '@jira-mgr/core'
import { STATUS_ORDER } from '@jira-mgr/core/hierarchy'
import { useState } from 'react'

import type { CurrentUser, FieldChoice, IssueChanges } from '../../shared/ipc'
import { Avatar, withAvatars } from './Avatar'
import { Reason } from './Failure'
import { LabelDot, PriorityBars } from './Glyphs'
import { Picker, type PickerOption } from './Picker'
import { StatusDot } from './StatusDot'
import {
  NONE,
  assigneeChoices,
  assigneeOptions,
  assigneePatch,
  isLabel,
  labelsPatch,
  priorityPatch,
  projectLabels,
  recentAssignees,
  statusPatch,
  type Person,
} from './properties'
import { useEditIssue, useFieldOptions, useSetStatus, useTransitions, useUsers } from './queries'
import { useDebounced } from './useDebounced'

/** Tells the caller what to show under the pickers: a message, or `null` to clear the last one. */
export type Report = (message: string | null) => void

/** What the user reads when Jira refuses an edit and the issue shows its old value again. */
export const refusal = (key: string, what: string, failure: Error) =>
  `Could not change ${what}, so ${key} shows its old value again. ${failure.message}`

/** Sends an edit with its optimistic patch. A refusal goes to `report`. */
export function useIssueChange(issue: Issue, report: Report) {
  const edit = useEditIssue()
  return (what: string, changes: IssueChanges, patch: Partial<Issue>) => {
    report(null)
    edit.mutate(
      { key: issue.key, changes, patch },
      {
        onError: (failure) => {
          report(refusal(issue.key, what, failure))
        },
      },
    )
  }
}

interface PickerProps {
  issue: Issue
  report: Report
}

const fromChoices = (choices: FieldChoice[] | undefined): PickerOption[] =>
  (choices ?? []).map((c) => ({ id: c.id, label: c.name }))

/** The statuses the issue can reach now, in Q21 order. Opened by `S`. */
export function StatusPicker({ issue, report }: PickerProps) {
  const setStatus = useSetStatus()
  const [open, setOpen] = useState(false)
  const transitions = useTransitions(issue.key, open)

  const reachable = transitions.data ?? []
  const all = reachable.some((o) => o.id === issue.status.id)
    ? reachable
    : [
        { id: issue.status.id, name: issue.status.name, category: issue.status.category },
        ...reachable,
      ]
  const rank = (name: string) => {
    const at = STATUS_ORDER.indexOf(name)
    return at < 0 ? STATUS_ORDER.length : at
  }
  const options: PickerOption[] = [...all]
    .sort((a, b) => rank(a.name) - rank(b.name))
    .map((o) => ({
      id: o.id,
      label: o.name,
      leading: <StatusDot status={{ id: o.id, name: o.name, category: o.category ?? 'new' }} />,
    }))

  function choose(id: string) {
    const option = transitions.data?.find((o) => o.id === id)
    if (option === undefined || id === issue.status.id) return
    report(null)
    setStatus.mutate(
      { key: issue.key, statusId: id, patch: statusPatch(issue, option) },
      {
        onError: (failure) => {
          report(refusal(issue.key, 'the status', failure))
        },
      },
    )
  }

  return (
    <Picker
      label="Status"
      shortcut="S"
      valueText={issue.status.name}
      leading={<StatusDot status={issue.status} />}
      options={options}
      selected={[issue.status.id]}
      numbered
      onSelect={choose}
      onOpenChange={setOpen}
      note={
        transitions.isPending ? (
          'Loading statuses'
        ) : transitions.isError ? (
          <Reason lead="Could not load the statuses." error={transitions.error} />
        ) : undefined
      }
    />
  )
}

interface AssigneeProps extends PickerProps {
  /** Every loaded issue: the recent assignees come from them. */
  issues: readonly Issue[]
  me: CurrentUser | undefined
}

/** Unassigned, Me, recent assignees, then a search of assignable users. Opened by `A`. */
export function AssigneePicker({ issue, issues, me, report }: AssigneeProps) {
  const change = useIssueChange(issue, report)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const found = useUsers(useDebounced(query.trim()), open)

  const meUser: Person | undefined =
    me === undefined
      ? undefined
      : { accountId: me.accountId, displayName: me.displayName, avatarUrl: me.avatarUrl }
  const choices = assigneeChoices(
    meUser,
    recentAssignees(issues, me?.accountId ?? ''),
    found.data ?? [],
    query.trim(),
  )
  const people = new Map<string, Person>(
    [...choices.suggested, ...choices.others].map((p) => [p.accountId, p]),
  )

  function choose(id: string) {
    const person = id === NONE ? null : (people.get(id) ?? null)
    if (id !== NONE && person === null) return
    if ((issue.assignee?.accountId ?? NONE) === id) return
    change('the assignee', { assignee: person?.accountId ?? null }, assigneePatch(person))
  }

  return (
    <Picker
      label="Assignee"
      shortcut="A"
      valueText={issue.assignee?.displayName ?? 'Unassigned'}
      leading={<Avatar person={issue.assignee} />}
      options={withAvatars(assigneeOptions(choices, query, me?.accountId), people)}
      selected={[issue.assignee?.accountId ?? NONE]}
      searchable
      onQuery={setQuery}
      onSelect={choose}
      onOpenChange={setOpen}
      note={
        found.isError ? (
          <Reason lead="Could not search people." error={found.error} />
        ) : found.isFetching ? (
          'Searching'
        ) : undefined
      }
    />
  )
}

/** The project's priorities from the create metadata. Opened by `P`. */
export function PriorityPicker({ issue, report }: PickerProps) {
  const change = useIssueChange(issue, report)
  const [open, setOpen] = useState(false)
  const priorities = useFieldOptions('priority', open)

  function choose(id: string) {
    const choice = priorities.data?.find((c) => c.id === id)
    if (choice === undefined || issue.priority?.id === id) return
    change('the priority', { priorityId: id }, priorityPatch(choice))
  }

  return (
    <Picker
      label="Priority"
      shortcut="P"
      valueText={issue.priority?.name ?? 'None'}
      options={fromChoices(priorities.data).map((o) => ({
        ...o,
        leading: <PriorityBars name={o.label} />,
      }))}
      selected={issue.priority === null ? [] : [issue.priority.id]}
      numbered
      onSelect={choose}
      onOpenChange={setOpen}
      note={
        priorities.isPending ? (
          'Loading priorities'
        ) : priorities.isError ? (
          <Reason lead="Could not load the priorities." error={priorities.error} />
        ) : undefined
      }
    />
  )
}

/** The labels on the loaded issues, which are the project's own (Q35); a new one can be typed. Opened by `L`. */
export function LabelsPicker({
  issue,
  issues,
  report,
}: PickerProps & { issues: readonly Issue[] }) {
  const change = useIssueChange(issue, report)
  const options: PickerOption[] = [...new Set([...issue.labels, ...projectLabels(issues)])].map(
    (label) => ({ id: label, label, leading: <LabelDot /> }),
  )

  function toggle(label: string) {
    const on = !issue.labels.includes(label)
    change(
      'the labels',
      on ? { addLabels: [label] } : { removeLabels: [label] },
      labelsPatch(issue, label, on),
    )
  }

  return (
    <Picker
      label="Labels"
      shortcut="L"
      valueText={issue.labels.length === 0 ? 'None' : issue.labels.join(', ')}
      options={options}
      selected={issue.labels}
      multiple
      searchable
      create={{ valid: isLabel, label: (text) => `Create "${text}"` }}
      onSelect={toggle}
      onCreate={(text) => {
        if (!issue.labels.includes(text)) toggle(text)
      }}
    />
  )
}
