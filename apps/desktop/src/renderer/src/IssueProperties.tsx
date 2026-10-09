import type { Issue } from '@jira-mgr/core'
import {
  SWAPPABLE_TYPES,
  formatEstimate,
  parseEstimate,
  propertyRules,
  type SwappableType,
} from '@jira-mgr/core/issue'
import { STATUS_ORDER } from '@jira-mgr/core/hierarchy'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import type { CurrentUser, FieldChoice, IssueChanges, SprintOption } from '../../shared/ipc'
import { ParentPrompt } from './ParentPrompt'
import { Picker, type PickerOption } from './Picker'
import { StatusDot } from './StatusDot'
import {
  assigneeChoices,
  assigneePatch,
  currentSprint,
  customerPatch,
  engagementPatch,
  isLabel,
  labelsPatch,
  parentChoices,
  parentMatch,
  priorityPatch,
  projectLabels,
  recentAssignees,
  shownSprints,
  sprintPatch,
  statusPatch,
  typePatch,
  type ParentMatch,
  type Person,
} from './properties'
import {
  useEditIssue,
  useFieldOptions,
  useSetSprint,
  useSetStatus,
  useSprints,
  useTransitions,
  useUsers,
} from './queries'

const NONE = '__none__'

const STATE_LABELS: Record<SprintOption['state'], string> = {
  active: 'Active',
  future: 'Future',
  closed: 'Closed',
}

/** The value after `delay` ms of holding still, so a search runs once the user pauses typing. */
function useDebounced<T>(value: T, delay = 200): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value)
    }, delay)
    return () => {
      clearTimeout(timer)
    }
  }, [value, delay])
  return settled
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-1">
      <span aria-hidden className="truncate px-2 text-muted">
        {name}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-0.5 border-b border-line py-3 last:border-b-0">
      <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        {title}
      </h3>
      {children}
    </section>
  )
}

const FIELD =
  'h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 hover:bg-hover focus:bg-canvas disabled:opacity-60'

interface TextFieldProps {
  label: string
  /** What the field holds now. A change from outside replaces the draft. */
  value: string
  type?: 'text' | 'date' | 'number'
  placeholder?: string
  /** Called with the draft when it changed and the user left the field or pressed Enter. */
  onCommit: (draft: string) => void
  /** Whether a draft can be sent. A draft that cannot is shown as an error and not sent. */
  valid?: (draft: string) => boolean
  hint?: string
}

/** A field that edits locally and saves on Enter or when focus leaves, and reverts on Esc. */
function TextField({
  label,
  value,
  type = 'text',
  placeholder,
  onCommit,
  valid = () => true,
  hint,
}: TextFieldProps) {
  const [draft, setDraft] = useState(value)
  // Jira's answer replaces what was typed, adjusting state during render as React advises.
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }
  const invalid = draft !== value && !valid(draft)

  function commit(input: HTMLInputElement) {
    // A date or number field the user has half edited reports "" as its value, which is also what
    // an emptied field reports. Only an emptied one clears the property, so a half edit reverts.
    if (input.validity.badInput) {
      setDraft(value)
      return
    }
    if (draft === value) return
    if (!valid(draft)) return
    onCommit(draft)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(event.currentTarget)
    } else if (event.key === 'Escape') {
      // The page's own Esc is for leaving, and this one only abandons the edit.
      event.stopPropagation()
      setDraft(value)
    }
  }

  return (
    <>
      <input
        type={type}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onBlur={(event) => {
          commit(event.currentTarget)
        }}
        onKeyDown={onKeyDown}
        {...(type === 'number' ? { min: 0, step: 0.25 } : {})}
        className={`${FIELD} ${invalid ? 'border-danger' : ''}`}
      />
      {invalid && hint !== undefined && <p className="px-2 text-xs text-danger">{hint}</p>}
    </>
  )
}

interface IssuePropertiesProps {
  issue: Issue
  /** Every loaded issue: the pickers draw recent assignees, labels and parents from them. */
  issues: readonly Issue[]
  me: CurrentUser | undefined
}

/**
 * The properties sidebar of the issue page: one picker or field per property, each an optimistic
 * edit that rolls back with a message when Jira refuses. Which properties show follows the issue
 * type (`propertyRules`); Jira has the last word on what it accepts.
 */
export function IssueProperties({ issue, issues, me }: IssuePropertiesProps) {
  const rules = propertyRules(issue.issueType)
  const edit = useEditIssue()
  const setStatus = useSetStatus()
  const setSprint = useSetSprint()
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<{ parent: Issue; match: ParentMatch } | null>(null)
  const parentTrigger = useRef<HTMLButtonElement>(null)
  // The dialog unmounts with its answer, so focus goes back to the button that asked.
  const wasPrompting = useRef(false)
  useEffect(() => {
    if (prompt === null && wasPrompting.current) parentTrigger.current?.focus()
    wasPrompting.current = prompt !== null
  }, [prompt])

  const [statusOpen, setStatusOpen] = useState(false)
  const transitions = useTransitions(issue.key, statusOpen)

  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [assigneeQuery, setAssigneeQuery] = useState('')
  const found = useUsers(useDebounced(assigneeQuery.trim()), assigneeOpen)

  const [priorityOpen, setPriorityOpen] = useState(false)
  const priorities = useFieldOptions('priority', priorityOpen)
  const [typeOpen, setTypeOpen] = useState(false)
  const types = useFieldOptions('issueType', typeOpen)
  const [customerOpen, setCustomerOpen] = useState(false)
  const customers = useFieldOptions('customer', customerOpen)
  const [engagementOpen, setEngagementOpen] = useState(false)
  const engagements = useFieldOptions('engagement', engagementOpen)

  const [sprintOpen, setSprintOpen] = useState(false)
  const [allSprints, setAllSprints] = useState(false)
  const sprints = useSprints(allSprints, sprintOpen)

  const [parentQuery, setParentQuery] = useState('')

  function fail(what: string, failure: Error) {
    setError(
      `Could not change ${what}, so ${issue.key} shows its old value again. ${failure.message}`,
    )
  }

  function change(what: string, changes: IssueChanges, patch: Partial<Issue>) {
    setError(null)
    edit.mutate(
      { key: issue.key, changes, patch },
      {
        onError: (failure) => {
          fail(what, failure)
        },
      },
    )
  }

  // Status
  const statusOptions: PickerOption[] = (() => {
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
    return [...all]
      .sort((a, b) => rank(a.name) - rank(b.name))
      .map((o) => ({
        id: o.id,
        label: o.name,
        leading: <StatusDot status={{ id: o.id, name: o.name, category: o.category ?? 'new' }} />,
      }))
  })()

  function chooseStatus(id: string) {
    const option = transitions.data?.find((o) => o.id === id)
    if (option === undefined || id === issue.status.id) return
    setError(null)
    setStatus.mutate(
      { key: issue.key, statusId: id, patch: statusPatch(issue, option) },
      {
        onError: (failure) => {
          fail('the status', failure)
        },
      },
    )
  }

  // Assignee
  const meUser: Person | undefined =
    me === undefined
      ? undefined
      : { accountId: me.accountId, displayName: me.displayName, avatarUrl: null }
  const recent = recentAssignees(issues, me?.accountId ?? '')
  const choices = assigneeChoices(meUser, recent, found.data ?? [], assigneeQuery.trim())
  const people = new Map<string, Person>(
    [...choices.suggested, ...choices.others].map((p) => [p.accountId, p]),
  )
  const assigneeOptions: PickerOption[] = [
    ...('unassigned'.includes(assigneeQuery.trim().toLowerCase())
      ? [{ id: NONE, label: 'Unassigned', group: 'Suggested' }]
      : []),
    ...choices.suggested.map((p) => ({
      id: p.accountId,
      label: p.accountId === me?.accountId ? 'Me' : p.displayName,
      ...(p.accountId === me?.accountId ? { detail: p.displayName } : {}),
      group: 'Suggested',
    })),
    ...choices.others.map((p) => ({ id: p.accountId, label: p.displayName, group: 'People' })),
  ]

  function chooseAssignee(id: string) {
    const person = id === NONE ? null : (people.get(id) ?? null)
    if (id !== NONE && person === null) return
    if ((issue.assignee?.accountId ?? NONE) === id) return
    change('the assignee', { assignee: person?.accountId ?? null }, assigneePatch(person))
  }

  // Simple option fields
  const fromChoices = (choices: FieldChoice[] | undefined): PickerOption[] =>
    (choices ?? []).map((c) => ({ id: c.id, label: c.name }))

  function chooseCustomer(id: string) {
    const choice = customers.data?.find((c) => c.id === id)
    if (choice === undefined || issue.customer?.id === id) return
    change('the Customer', { customerId: id }, customerPatch(choice))
  }

  function chooseEngagement(id: string) {
    const choice = engagements.data?.find((c) => c.id === id)
    if (choice === undefined || issue.engagement?.id === id) return
    change('the Engagement', { engagementId: id }, engagementPatch(choice))
  }

  function choosePriority(id: string) {
    const choice = priorities.data?.find((c) => c.id === id)
    if (choice === undefined || issue.priority?.id === id) return
    change('the priority', { priorityId: id }, priorityPatch(choice))
  }

  function chooseType(id: string) {
    const choice = types.data?.find((c) => c.id === id)
    if (choice === undefined || issue.issueType.id === id) return
    change('the type', { type: choice.name as SwappableType }, typePatch(issue, choice))
  }

  // Labels
  const labelOptions: PickerOption[] = [
    ...new Set([...issue.labels, ...projectLabels(issues)]),
  ].map((label) => ({ id: label, label }))

  function toggleLabel(label: string) {
    const on = !issue.labels.includes(label)
    change(
      'the labels',
      on ? { addLabels: [label] } : { removeLabels: [label] },
      labelsPatch(issue, label, on),
    )
  }

  // Sprint
  const sprint = currentSprint(issue)
  const sprintList = shownSprints(sprints.data ?? [], allSprints)
  const sprintOptions: PickerOption[] = [
    { id: NONE, label: 'Backlog' },
    ...sprintList.map((s) => ({
      id: String(s.id),
      label: s.name,
      detail: STATE_LABELS[s.state],
      // Jira refuses a move into a closed sprint.
      disabled: s.state === 'closed',
    })),
  ]

  function chooseSprint(id: string) {
    const target = id === NONE ? null : sprintList.find((s) => String(s.id) === id)
    if (target === undefined) return
    if ((sprint === null ? NONE : String(sprint.id)) === id) return
    setError(null)
    setSprint.mutate(
      { key: issue.key, sprintId: target?.id ?? null, patch: sprintPatch(issue, target) },
      {
        onError: (failure) => {
          fail('the sprint', failure)
        },
      },
    )
  }

  // Parent
  const parent = issues.find((i) => i.key === issue.parentKey)
  const parentList = parentChoices(issue, issues, parentQuery)
  const parentOptions: PickerOption[] = parentList.shown.map((p) => ({
    id: p.key,
    label: p.summary,
    leading: <span className="shrink-0 font-mono text-xs text-muted">{p.key}</span>,
  }))

  function chooseParent(key: string) {
    const target = issues.find((i) => i.key === key)
    if (target === undefined || key === issue.parentKey) return
    const match = parentMatch(issue, target)
    if (match.customer === null && match.engagement === null) {
      change('the parent', { parentKey: key }, { parentKey: key })
      return
    }
    setPrompt({ parent: target, match })
  }

  function moveUnder(withMatch: boolean) {
    if (prompt === null) return
    const { parent: target, match } = prompt
    setPrompt(null)
    const copy = withMatch ? match : { customer: null, engagement: null }
    change(
      'the parent',
      {
        parentKey: target.key,
        ...(copy.customer && { customerId: copy.customer.id }),
        ...(copy.engagement && { engagementId: copy.engagement.id }),
      },
      {
        parentKey: target.key,
        ...(copy.customer && { customer: copy.customer }),
        ...(copy.engagement && { engagement: copy.engagement }),
      },
    )
  }

  // Dates and estimates
  const originalEstimate =
    issue.originalEstimateSeconds === null ? '' : formatEstimate(issue.originalEstimateSeconds)
  const timeRemaining = issue.timeRemainingHours === null ? '' : String(issue.timeRemainingHours)

  return (
    <aside
      aria-label="Properties"
      className="min-h-0 overflow-y-auto border-l border-line bg-panel px-3"
    >
      <Group title="Status">
        <Row name="Status">
          <Picker
            label="Status"
            valueText={issue.status.name}
            leading={<StatusDot status={issue.status} />}
            options={statusOptions}
            selected={[issue.status.id]}
            onSelect={chooseStatus}
            onOpenChange={setStatusOpen}
            note={
              transitions.isPending
                ? 'Loading statuses'
                : transitions.isError
                  ? `Could not load the statuses. ${transitions.error.message}`
                  : undefined
            }
          />
        </Row>
        <Row name="Assignee">
          <Picker
            label="Assignee"
            valueText={issue.assignee?.displayName ?? 'Unassigned'}
            options={assigneeOptions}
            selected={[issue.assignee?.accountId ?? NONE]}
            searchable
            onQuery={setAssigneeQuery}
            onSelect={chooseAssignee}
            onOpenChange={setAssigneeOpen}
            note={
              found.isError
                ? `Could not search people. ${found.error.message}`
                : found.isFetching
                  ? 'Searching'
                  : undefined
            }
          />
        </Row>
        <Row name="Priority">
          <Picker
            label="Priority"
            valueText={issue.priority?.name ?? 'None'}
            options={fromChoices(priorities.data)}
            selected={issue.priority === null ? [] : [issue.priority.id]}
            onSelect={choosePriority}
            onOpenChange={setPriorityOpen}
            note={
              priorities.isPending
                ? 'Loading priorities'
                : priorities.isError
                  ? `Could not load the priorities. ${priorities.error.message}`
                  : undefined
            }
          />
        </Row>
        <Row name="Labels">
          <Picker
            label="Labels"
            valueText={issue.labels.length === 0 ? 'None' : issue.labels.join(', ')}
            options={labelOptions}
            selected={issue.labels}
            multiple
            searchable
            create={{ valid: isLabel, label: (text) => `Create "${text}"` }}
            onSelect={toggleLabel}
            onCreate={(text) => {
              if (!issue.labels.includes(text)) toggleLabel(text)
            }}
          />
        </Row>
      </Group>

      <Group title="Details">
        <Row name="Type">
          {rules.typeChange ? (
            <Picker
              label="Type"
              valueText={issue.issueType.name}
              options={fromChoices(
                types.data?.filter((t) => (SWAPPABLE_TYPES as readonly string[]).includes(t.name)),
              )}
              selected={[issue.issueType.id]}
              onSelect={chooseType}
              onOpenChange={setTypeOpen}
              note={types.isPending ? 'Loading types' : undefined}
            />
          ) : (
            <span className="flex h-7 items-center px-2">{issue.issueType.name}</span>
          )}
        </Row>
        {rules.parent && (
          <Row name="Parent">
            <Picker
              label="Parent"
              triggerRef={parentTrigger}
              valueText={
                issue.parentKey === null
                  ? 'None'
                  : `${issue.parentKey}${parent === undefined ? '' : ` ${parent.summary}`}`
              }
              options={parentOptions}
              selected={issue.parentKey === null ? [] : [issue.parentKey]}
              searchable
              onQuery={setParentQuery}
              onSelect={chooseParent}
              note={
                parentList.total > parentList.shown.length
                  ? `Showing ${String(parentList.shown.length)} of ${String(parentList.total)}. Keep typing to narrow.`
                  : undefined
              }
            />
          </Row>
        )}
        <Row name="Customer">
          <Picker
            label="Customer"
            valueText={issue.customer?.value ?? 'None'}
            options={fromChoices(customers.data)}
            selected={issue.customer === null ? [] : [issue.customer.id]}
            searchable
            onSelect={chooseCustomer}
            onOpenChange={setCustomerOpen}
            note={
              customers.isPending
                ? 'Loading Customers'
                : customers.isError
                  ? `Could not load the Customers. ${customers.error.message}`
                  : undefined
            }
          />
        </Row>
        <Row name="Engagement">
          <Picker
            label="Engagement"
            valueText={issue.engagement?.value ?? 'None'}
            options={fromChoices(engagements.data)}
            selected={issue.engagement === null ? [] : [issue.engagement.id]}
            searchable
            onSelect={chooseEngagement}
            onOpenChange={setEngagementOpen}
            note={
              engagements.isPending
                ? 'Loading Engagements'
                : engagements.isError
                  ? `Could not load the Engagements. ${engagements.error.message}`
                  : undefined
            }
          />
        </Row>
        {rules.sprint && (
          <Row name="Sprint">
            <Picker
              label="Sprint"
              valueText={sprint?.name ?? 'Backlog'}
              options={sprintOptions}
              selected={[sprint === null ? NONE : String(sprint.id)]}
              onSelect={chooseSprint}
              onOpenChange={setSprintOpen}
              note={
                sprints.isPending
                  ? 'Loading sprints'
                  : sprints.isError
                    ? `Could not load the sprints. ${sprints.error.message}`
                    : undefined
              }
              footer={
                <button
                  type="button"
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
          </Row>
        )}
      </Group>

      <Group title="Dates and time">
        <Row name="Start date">
          <TextField
            key={issue.startDate ?? ''}
            label="Start date"
            type="date"
            value={issue.startDate ?? ''}
            onCommit={(draft) => {
              change(
                'the start date',
                { startDate: draft === '' ? null : draft },
                {
                  startDate: draft === '' ? null : draft,
                },
              )
            }}
          />
        </Row>
        <Row name="Due date">
          <TextField
            key={issue.dueDate ?? ''}
            label="Due date"
            type="date"
            value={issue.dueDate ?? ''}
            onCommit={(draft) => {
              change(
                'the due date',
                { dueDate: draft === '' ? null : draft },
                {
                  dueDate: draft === '' ? null : draft,
                },
              )
            }}
          />
        </Row>
        {rules.estimates && (
          <>
            <Row name="Estimate">
              <TextField
                label="Original estimate"
                value={originalEstimate}
                placeholder="2h 30m"
                valid={(draft) => parseEstimate(draft) !== null}
                hint="Use a duration such as 2h 30m."
                onCommit={(draft) => {
                  const seconds = parseEstimate(draft)
                  if (seconds === null) return
                  change(
                    'the original estimate',
                    { originalEstimate: draft.trim() },
                    { originalEstimateSeconds: seconds },
                  )
                }}
              />
            </Row>
            <Row name="Remaining">
              <span className="flex h-7 items-center px-2">
                <span className="sr-only">Remaining estimate, read-only: </span>
                {issue.remainingEstimateSeconds === null
                  ? 'None'
                  : formatEstimate(issue.remainingEstimateSeconds)}
              </span>
            </Row>
            <Row name="Time left (h)">
              <TextField
                label="Time remaining (h)"
                type="number"
                value={timeRemaining}
                valid={(draft) => draft === '' || Number(draft) >= 0}
                hint="Use a number of hours, 0 or more."
                onCommit={(draft) => {
                  const hours = draft === '' ? null : Number(draft)
                  change(
                    'the time remaining',
                    { timeRemainingHours: hours },
                    {
                      timeRemainingHours: hours,
                    },
                  )
                }}
              />
            </Row>
          </>
        )}
      </Group>

      {error !== null && (
        <p role="alert" className="border-t border-line py-3 text-xs text-danger">
          {error}
        </p>
      )}

      {prompt !== null && (
        <ParentPrompt
          issue={issue}
          parent={prompt.parent}
          match={prompt.match}
          onChoose={moveUnder}
          onCancel={() => {
            setPrompt(null)
          }}
        />
      )}
    </aside>
  )
}
