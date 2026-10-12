import type { Issue } from '@jira-mgr/core'
import { STATUS_ORDER } from '@jira-mgr/core/hierarchy'
import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { CurrentUser, FieldChoice, IssueChanges, StatusOption } from '../../shared/ipc'
import { Avatar, withAvatars } from './Avatar'
import { Reason } from './Failure'
import { LabelDot, PriorityBars } from './Glyphs'
import { useNotify, type Notify } from './notify'
import { current } from './optimistic'
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
  refusedNotice,
  statusPatch,
  type Person,
} from './properties'
import { changedFields } from './undo'
import { useEditIssue, useFieldOptions, useSetStatus, useTransitions, useUsers } from './queries'
import { useDebounced } from './useDebounced'

/**
 * Sends an edit of issue `key` that changes the fields of `patch`. A refusal, which has shown the
 * old value again, goes to the toast with Retry and flashes the issue's row and those fields'
 * rows. It does so even when the control that sent the edit has gone, such as a Peek that moved
 * on to another issue. Retry sends the edit again only while the fields still show what they
 * showed before this edit was sent; a later edit of one of them, from anywhere, would be
 * overwritten, so it refuses instead.
 */
export function attemptWith(
  notify: Notify,
  client: QueryClient,
  key: string,
  what: string,
  patch: Partial<Issue>,
  send: () => Promise<unknown>,
): void {
  // Taken before the edit is sent. At refusal time the cache may already show a newer edit of
  // the same fields that was queued behind this one.
  const before = current(client, key)
  const fields = Object.keys(patch)
  send().then(undefined, (failure: unknown) => {
    notify(refusedNotice(what, failure), {
      flash: { key, fields },
      retry: () => {
        const now = current(client, key)
        const changed =
          before === undefined || now === undefined
            ? ''
            : changedFields(pick(before, fields), pick(now, fields))
        if (changed === '') {
          attemptWith(notify, client, key, what, patch, send)
          return
        }
        notify({
          title: `Did not retry the ${what} of ${key}`,
          notes: [`Its ${changed} changed since, and the retry would overwrite that.`],
          warned: true,
        })
      },
    })
  })
}

/** The values of `fields` on `issue`. A field the issue lacks is listed as `undefined`, so it still compares. */
const pick = (issue: Issue, fields: readonly string[]): Partial<Issue> =>
  Object.fromEntries(fields.map((field) => [field, issue[field as keyof Issue]]))

/** `attemptWith` for a control that sits inside the Shell's notice context. */
export function useAttempt(key: string) {
  const notify = useNotify()
  const client = useQueryClient()
  return (what: string, patch: Partial<Issue>, send: () => Promise<unknown>): void => {
    attemptWith(notify, client, key, what, patch, send)
  }
}

/** Sends an edit with its optimistic patch. `what` names the property, as in "Priority not changed." */
export function useIssueChange(issue: Issue) {
  const edit = useEditIssue()
  const attempt = useAttempt(issue.key)
  return (what: string, changes: IssueChanges, patch: Partial<Issue>) => {
    attempt(what, patch, () => edit.mutateAsync({ key: issue.key, changes, patch }))
  }
}

interface PickerProps {
  issue: Issue
}

const fromChoices = (choices: FieldChoice[] | undefined): PickerOption[] =>
  (choices ?? []).map((c) => ({ id: c.id, label: c.name }))

/** The statuses the issue can reach now and its own, in Q21 order. */
export function statusChoices(issue: Issue, reachable: readonly StatusOption[]): StatusOption[] {
  const all = reachable.some((o) => o.id === issue.status.id)
    ? [...reachable]
    : [
        { id: issue.status.id, name: issue.status.name, category: issue.status.category },
        ...reachable,
      ]
  const rank = (name: string) => {
    const at = STATUS_ORDER.indexOf(name)
    return at < 0 ? STATUS_ORDER.length : at
  }
  return all.sort((a, b) => rank(a.name) - rank(b.name))
}

/** The picker's options for `choices`, each with its status dot. */
export const statusOptions = (choices: readonly StatusOption[]): PickerOption[] =>
  choices.map((o) => ({
    id: o.id,
    label: o.name,
    leading: <StatusDot status={{ id: o.id, name: o.name, category: o.category ?? 'new' }} />,
  }))

/** The statuses the issue can reach now, in Q21 order. Opened by `S`. */
export function StatusPicker({ issue }: PickerProps) {
  const setStatus = useSetStatus()
  const attempt = useAttempt(issue.key)
  const [open, setOpen] = useState(false)
  const transitions = useTransitions(issue.key, open)

  const options = statusOptions(statusChoices(issue, transitions.data ?? []))

  function choose(id: string) {
    const option = transitions.data?.find((o) => o.id === id)
    if (option === undefined || id === issue.status.id) return
    const patch = statusPatch(issue, option)
    attempt('Status', patch, () => setStatus.mutateAsync({ key: issue.key, statusId: id, patch }))
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
export function AssigneePicker({ issue, issues, me }: AssigneeProps) {
  const change = useIssueChange(issue)
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
    change('Assignee', { assignee: person?.accountId ?? null }, assigneePatch(person))
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
export function PriorityPicker({ issue }: PickerProps) {
  const change = useIssueChange(issue)
  const [open, setOpen] = useState(false)
  const priorities = useFieldOptions('priority', open)

  function choose(id: string) {
    const choice = priorities.data?.find((c) => c.id === id)
    if (choice === undefined || issue.priority?.id === id) return
    change('Priority', { priorityId: id }, priorityPatch(choice))
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
export function LabelsPicker({ issue, issues }: PickerProps & { issues: readonly Issue[] }) {
  const change = useIssueChange(issue)
  const options: PickerOption[] = [...new Set([...issue.labels, ...projectLabels(issues)])].map(
    (label) => ({ id: label, label, leading: <LabelDot /> }),
  )

  function toggle(label: string) {
    const on = !issue.labels.includes(label)
    change(
      'Labels',
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
