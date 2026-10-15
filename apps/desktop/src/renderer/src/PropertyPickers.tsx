import type { Issue } from '@jira-mgr/core'
import { STATUS_ORDER } from '@jira-mgr/core/hierarchy'
import { SWAPPABLE_TYPES, type SwappableType } from '@jira-mgr/core/issue'
import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import type { CurrentUser, FieldChoice, IssueChanges, StatusOption } from '../../shared/ipc'
import { Avatar, withAvatars } from './Avatar'
import { Reason } from './Failure'
import { LabelDot, PriorityBars } from './Glyphs'
import { useNotify, type Notify } from './notify'
import { current } from './optimistic'
import { ParentPrompt } from './ParentPrompt'
import { Picker, menuProps, type MenuMode, type PickerOption } from './Picker'
import { StatusDot } from './StatusDot'
import {
  NONE,
  STATE_LABELS,
  assigneeChoices,
  assigneeOptions,
  assigneePatch,
  currentSprint,
  isLabel,
  labelsPatch,
  parentChoices,
  parentMatch,
  priorityPatch,
  projectLabels,
  recentAssignees,
  refusedNotice,
  shownSprints,
  sprintPatch,
  statusPatch,
  typePatch,
  type ParentMatch,
  type Person,
} from './properties'
import { changedFields } from './undo'
import {
  useEditIssue,
  useFieldOptions,
  useSetSprint,
  useSetStatus,
  useSprints,
  useTransitions,
  useUsers,
} from './queries'
import { TypeIcon } from './TypeIcon'
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
  /** Set by the context menu, which shows the picker as one of its items. */
  menu?: MenuMode
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
export function StatusPicker({ issue, menu }: PickerProps) {
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
      {...menuProps(menu)}
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
export function AssigneePicker({ issue, issues, me, menu }: AssigneeProps) {
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
      {...menuProps(menu)}
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
export function PriorityPicker({ issue, menu }: PickerProps) {
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
      {...menuProps(menu)}
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
export function LabelsPicker({ issue, issues, menu }: PickerProps & { issues: readonly Issue[] }) {
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
      {...menuProps(menu)}
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

/** The issue types a Story, Task or Bug can become (Q23). */
export function TypePicker({ issue, menu }: PickerProps) {
  const change = useIssueChange(issue)
  const [open, setOpen] = useState(false)
  const types = useFieldOptions('issueType', open)

  function choose(id: string) {
    const choice = types.data?.find((c) => c.id === id)
    if (choice === undefined || issue.issueType.id === id) return
    change('Type', { type: choice.name as SwappableType }, typePatch(issue, choice))
  }

  return (
    <Picker
      {...menuProps(menu)}
      label="Type"
      valueText={issue.issueType.name}
      options={fromChoices(
        types.data?.filter((t) => (SWAPPABLE_TYPES as readonly string[]).includes(t.name)),
      ).map((o) => ({ ...o, leading: <TypeIcon type={{ name: o.label }} decorative /> }))}
      selected={[issue.issueType.id]}
      onSelect={choose}
      onOpenChange={setOpen}
      note={types.isPending ? 'Loading types' : undefined}
    />
  )
}

/** Backlog and the project's sprints, closed ones listed but not chosen. Opened by `Shift+C`. */
export function SprintPicker({ issue, menu }: PickerProps) {
  const setSprint = useSetSprint()
  const attempt = useAttempt(issue.key)
  const [open, setOpen] = useState(false)
  const [allSprints, setAllSprints] = useState(false)
  const sprints = useSprints(allSprints, open)
  const sprint = currentSprint(issue)
  const sprintList = shownSprints(sprints.data ?? [], allSprints)
  const options: PickerOption[] = [
    { id: NONE, label: 'Backlog' },
    ...sprintList.map((s) => ({
      id: String(s.id),
      label: s.name,
      detail: STATE_LABELS[s.state],
      // Jira refuses a move into a closed sprint.
      disabled: s.state === 'closed',
    })),
  ]

  function choose(id: string) {
    const target = id === NONE ? null : sprintList.find((s) => String(s.id) === id)
    if (target === undefined) return
    if ((sprint === null ? NONE : String(sprint.id)) === id) return
    const patch = sprintPatch(issue, target)
    attempt('Sprint', patch, () =>
      setSprint.mutateAsync({ key: issue.key, sprintId: target?.id ?? null, patch }),
    )
  }

  return (
    <Picker
      {...menuProps(menu)}
      label="Sprint"
      shortcut="Shift+C"
      valueText={sprint?.name ?? 'Backlog'}
      options={options}
      selected={[sprint === null ? NONE : String(sprint.id)]}
      onSelect={choose}
      onOpenChange={setOpen}
      note={
        sprints.isPending ? (
          'Loading sprints'
        ) : sprints.isError ? (
          <Reason lead="Could not load the sprints." error={sprints.error} />
        ) : undefined
      }
      footer={
        <button
          type="button"
          data-row
          aria-pressed={allSprints}
          onClick={() => {
            setAllSprints(!allSprints)
          }}
          className="mt-1 flex h-8 w-full items-center rounded px-2 text-left text-xs hover:bg-hover"
        >
          {allSprints ? 'Show fewer sprints' : 'Show all sprints'}
        </button>
      }
    />
  )
}

/**
 * The issues that can hold this one, searched by key and summary. A parent whose Customer or
 * Engagement differs asks first (Q16). Opened by `Shift+P`.
 */
export function ParentPicker({ issue, issues, menu }: PickerProps & { issues: readonly Issue[] }) {
  const change = useIssueChange(issue)
  const [prompt, setPrompt] = useState<{ parent: Issue; match: ParentMatch } | null>(null)
  const [query, setQuery] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  // The question outlives the list, so a menu waits for its answer before it closes.
  const asking = useRef(false)
  // The dialog unmounts with its answer, so focus goes back to the button that asked.
  const wasPrompting = useRef(false)
  useEffect(() => {
    if (prompt === null && wasPrompting.current) trigger.current?.focus()
    wasPrompting.current = prompt !== null
  }, [prompt])
  const parent = issues.find((i) => i.key === issue.parentKey)
  const list = parentChoices(issue, issues, query)
  const options: PickerOption[] = list.shown.map((p) => ({
    id: p.key,
    label: p.summary,
    leading: <span className="shrink-0 font-mono text-xs text-muted">{p.key}</span>,
  }))

  function choose(key: string) {
    const target = issues.find((i) => i.key === key)
    if (target === undefined || key === issue.parentKey) return
    const match = parentMatch(issue, target)
    if (match.customer === null && match.engagement === null) {
      change('Parent', { parentKey: key }, { parentKey: key })
      return
    }
    asking.current = true
    setPrompt({ parent: target, match })
  }

  function answer(withMatch: boolean | null) {
    const asked = prompt
    asking.current = false
    setPrompt(null)
    if (asked !== null && withMatch !== null) {
      const copy = withMatch ? asked.match : { customer: null, engagement: null }
      change(
        'Parent',
        {
          parentKey: asked.parent.key,
          ...(copy.customer && { customerId: copy.customer.id }),
          ...(copy.engagement && { engagementId: copy.engagement.id }),
        },
        {
          parentKey: asked.parent.key,
          ...(copy.customer && { customer: copy.customer }),
          ...(copy.engagement && { engagement: copy.engagement }),
        },
      )
    }
    menu?.onPicked()
  }

  return (
    <>
      <Picker
        {...menuProps(menu)}
        label="Parent"
        shortcut="Shift+P"
        wide
        triggerRef={trigger}
        valueText={
          issue.parentKey === null
            ? 'None'
            : `${issue.parentKey}${parent === undefined ? '' : ` ${parent.summary}`}`
        }
        options={options}
        selected={issue.parentKey === null ? [] : [issue.parentKey]}
        searchable
        onQuery={setQuery}
        onSelect={choose}
        onPicked={
          menu === undefined
            ? undefined
            : () => {
                if (!asking.current) menu.onPicked()
              }
        }
        note={
          list.total > list.shown.length
            ? `Showing ${String(list.shown.length)} of ${String(list.total)}. Keep typing to narrow.`
            : undefined
        }
      />
      {prompt !== null && (
        <ParentPrompt
          subject={issue.key}
          parent={prompt.parent}
          match={prompt.match}
          onChoose={answer}
          onCancel={() => {
            answer(null)
          }}
        />
      )}
    </>
  )
}
