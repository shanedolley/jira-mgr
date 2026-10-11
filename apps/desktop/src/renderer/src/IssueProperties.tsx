import type { Issue } from '@jira-mgr/core'
import {
  SWAPPABLE_TYPES,
  formatEstimate,
  parseEstimate,
  propertyRules,
  type SwappableType,
} from '@jira-mgr/core/issue'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import type { CurrentUser, FieldChoice } from '../../shared/ipc'
import { Reason } from './Failure'
import { ParentPrompt } from './ParentPrompt'
import { Picker, type PickerOption } from './Picker'
import {
  AssigneePicker,
  LabelsPicker,
  PriorityPicker,
  StatusPicker,
  useAttempt,
  useIssueChange,
} from './PropertyPickers'
import { Row } from './PropertyRow'
import {
  NONE,
  STATE_LABELS,
  currentSprint,
  customerPatch,
  engagementPatch,
  parentChoices,
  parentMatch,
  shownSprints,
  sprintPatch,
  typePatch,
  type ParentMatch,
} from './properties'
import { useFieldOptions, usePendingFields, useSetSprint, useSprints } from './queries'
import { TypeIcon } from './TypeIcon'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-line py-3 last:border-b-0">
      <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        {title}
      </h3>
      {children}
    </section>
  )
}

const FIELD =
  'peer h-7 w-full min-w-0 rounded-md border border-field-border bg-transparent px-2 hover:bg-hover focus:bg-canvas disabled:opacity-60'

/** The read-only rows follow the editable ones after an 8px gap. */
function ReadOnly({ children }: { children: ReactNode }) {
  return <div className="mt-2">{children}</div>
}

function ClockIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  )
}

interface TextFieldProps {
  label: string
  /** What the field holds now. A change from outside replaces the draft. */
  value: string
  type?: 'text' | 'date' | 'number'
  /** Shown while the field is empty. A date field draws it itself, since the browser's is a format. */
  placeholder?: string
  /** A clock before the text, for durations. */
  clock?: boolean
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
  clock = false,
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
  // The draft last sent. Jira's answer lands a render later, and until it does `draft` still
  // differs from `value`, so Enter followed at once by leaving the field would send it twice.
  const sent = useRef<string | null>(null)

  function commit(input: HTMLInputElement) {
    // A date or number field the user has half edited reports "" as its value, which is also what
    // an emptied field reports. Only an emptied one clears the property, so a half edit reverts.
    if (input.validity.badInput) {
      setDraft(value)
      return
    }
    if (draft === value || draft === sent.current) return
    if (!valid(draft)) return
    sent.current = draft
    onCommit(draft)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(event.currentTarget)
    } else if (event.key === 'Escape') {
      // The page's own Esc is for leaving, and this one only abandons the edit.
      event.stopPropagation()
      sent.current = null
      setDraft(value)
    }
  }

  const emptyDate = type === 'date' && draft === ''
  return (
    <>
      <div className="relative">
        {clock && <ClockIcon />}
        <input
          type={type}
          aria-label={label}
          aria-invalid={invalid || undefined}
          placeholder={type === 'date' ? undefined : placeholder}
          value={draft}
          onChange={(event) => {
            sent.current = null
            setDraft(event.target.value)
          }}
          onBlur={(event) => {
            commit(event.currentTarget)
          }}
          onKeyDown={onKeyDown}
          {...(type === 'number' ? { min: 0, step: 0.25 } : {})}
          className={`${FIELD} aria-invalid:border-danger ${clock ? 'pl-7' : ''} ${emptyDate ? 'date-empty' : ''}`}
        />
        {emptyDate && placeholder !== undefined && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted peer-focus:hidden"
          >
            {placeholder}
          </span>
        )}
      </div>
      {invalid && hint !== undefined && <p className="px-2 text-xs text-danger">{hint}</p>}
    </>
  )
}

interface IssuePropertiesProps {
  issue: Issue
  /** Every loaded issue: the pickers draw recent assignees, labels and parents from them. */
  issues: readonly Issue[]
  me: CurrentUser | undefined
  /** Opens the page of the issue's sprint, from the link beside the Sprint value. */
  onOpenSprint?: (id: number) => void
}

/**
 * The properties sidebar of the issue page: one picker or field per property, each an optimistic
 * edit that rolls back, with a toast and a Retry, when Jira refuses, and shows dimmed with a
 * spinner until Jira answers. Which properties show follows the issue
 * type (`propertyRules`); Jira has the last word on what it accepts.
 */
export function IssueProperties({ issue, issues, me, onOpenSprint }: IssuePropertiesProps) {
  const rules = propertyRules(issue.issueType)
  const setSprint = useSetSprint()
  const pending = usePendingFields(issue.key)
  const attempt = useAttempt(issue.key)
  const [prompt, setPrompt] = useState<{ parent: Issue; match: ParentMatch } | null>(null)
  const parentTrigger = useRef<HTMLButtonElement>(null)
  // The dialog unmounts with its answer, so focus goes back to the button that asked.
  const wasPrompting = useRef(false)
  useEffect(() => {
    if (prompt === null && wasPrompting.current) parentTrigger.current?.focus()
    wasPrompting.current = prompt !== null
  }, [prompt])

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

  const change = useIssueChange(issue)

  // Simple option fields
  const fromChoices = (choices: FieldChoice[] | undefined): PickerOption[] =>
    (choices ?? []).map((c) => ({ id: c.id, label: c.name }))

  function chooseCustomer(id: string) {
    const choice = customers.data?.find((c) => c.id === id)
    if (choice === undefined || issue.customer?.id === id) return
    change('Customer', { customerId: id }, customerPatch(choice))
  }

  function chooseEngagement(id: string) {
    const choice = engagements.data?.find((c) => c.id === id)
    if (choice === undefined || issue.engagement?.id === id) return
    change('Engagement', { engagementId: id }, engagementPatch(choice))
  }

  function chooseType(id: string) {
    const choice = types.data?.find((c) => c.id === id)
    if (choice === undefined || issue.issueType.id === id) return
    change('Type', { type: choice.name as SwappableType }, typePatch(issue, choice))
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
    const patch = sprintPatch(issue, target)
    attempt('Sprint', patch, () =>
      setSprint.mutateAsync({ key: issue.key, sprintId: target?.id ?? null, patch }),
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
      change('Parent', { parentKey: key }, { parentKey: key })
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
      'Parent',
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
  // Time left means nothing before an estimate, so it waits for one. A value Jira holds still shows.
  const hasEstimate = issue.originalEstimateSeconds !== null || issue.timeRemainingHours !== null

  return (
    <aside
      aria-label="Properties"
      data-issue={issue.key}
      className="min-h-0 overflow-y-auto border-l border-line bg-panel px-3 max-stack:min-h-auto max-stack:overflow-y-visible max-stack:border-l-0 max-stack:border-t"
    >
      <Group title="Status">
        <Row name="Status" field="status" pending={pending.has('status')}>
          <StatusPicker issue={issue} />
        </Row>
        <Row name="Assignee" field="assignee" pending={pending.has('assignee')}>
          <AssigneePicker issue={issue} issues={issues} me={me} />
        </Row>
        <Row name="Priority" field="priority" pending={pending.has('priority')}>
          <PriorityPicker issue={issue} />
        </Row>
        <Row name="Labels" field="labels" pending={pending.has('labels')}>
          <LabelsPicker issue={issue} issues={issues} />
        </Row>
      </Group>

      <Group title="Details">
        {rules.typeChange && (
          <Row name="Type" field="issueType" pending={pending.has('issueType')}>
            <Picker
              label="Type"
              valueText={issue.issueType.name}
              options={fromChoices(
                types.data?.filter((t) => (SWAPPABLE_TYPES as readonly string[]).includes(t.name)),
              ).map((o) => ({ ...o, leading: <TypeIcon type={{ name: o.label }} decorative /> }))}
              selected={[issue.issueType.id]}
              onSelect={chooseType}
              onOpenChange={setTypeOpen}
              note={types.isPending ? 'Loading types' : undefined}
            />
          </Row>
        )}
        {rules.parent && (
          <Row name="Parent" field="parentKey" pending={pending.has('parentKey')}>
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
        <Row name="Customer" field="customer" pending={pending.has('customer')}>
          <Picker
            label="Customer"
            valueText={issue.customer?.value ?? 'None'}
            options={fromChoices(customers.data)}
            selected={issue.customer === null ? [] : [issue.customer.id]}
            searchable
            onSelect={chooseCustomer}
            onOpenChange={setCustomerOpen}
            note={
              customers.isPending ? (
                'Loading Customers'
              ) : customers.isError ? (
                <Reason lead="Could not load the Customers." error={customers.error} />
              ) : undefined
            }
          />
        </Row>
        <Row name="Engagement" field="engagement" pending={pending.has('engagement')}>
          <Picker
            label="Engagement"
            valueText={issue.engagement?.value ?? 'None'}
            options={fromChoices(engagements.data)}
            selected={issue.engagement === null ? [] : [issue.engagement.id]}
            searchable
            onSelect={chooseEngagement}
            onOpenChange={setEngagementOpen}
            note={
              engagements.isPending ? (
                'Loading Engagements'
              ) : engagements.isError ? (
                <Reason lead="Could not load the Engagements." error={engagements.error} />
              ) : undefined
            }
          />
        </Row>
        {rules.sprint && (
          <Row name="Sprint" field="sprints" pending={pending.has('sprints')}>
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <Picker
                  label="Sprint"
                  valueText={sprint?.name ?? 'Backlog'}
                  options={sprintOptions}
                  selected={[sprint === null ? NONE : String(sprint.id)]}
                  onSelect={chooseSprint}
                  onOpenChange={setSprintOpen}
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
              </div>
              {sprint !== null && onOpenSprint !== undefined && (
                <button
                  type="button"
                  aria-label={`Open sprint ${sprint.name}`}
                  onClick={() => {
                    onOpenSprint(sprint.id)
                  }}
                  className="btn btn-sm shrink-0"
                >
                  Open
                </button>
              )}
            </div>
          </Row>
        )}
        {!rules.typeChange && (
          <ReadOnly>
            <Row name="Type">
              <span className="flex h-8 items-center px-2">{issue.issueType.name}</span>
            </Row>
          </ReadOnly>
        )}
      </Group>

      <Group title="Dates and time">
        <Row name="Start date" field="startDate" pending={pending.has('startDate')}>
          <TextField
            key={issue.startDate ?? ''}
            label="Start date"
            type="date"
            placeholder="Set start date"
            value={issue.startDate ?? ''}
            onCommit={(draft) => {
              change(
                'Start date',
                { startDate: draft === '' ? null : draft },
                {
                  startDate: draft === '' ? null : draft,
                },
              )
            }}
          />
        </Row>
        <Row name="Due date" field="dueDate" pending={pending.has('dueDate')}>
          <TextField
            key={issue.dueDate ?? ''}
            label="Due date"
            type="date"
            placeholder="Set due date"
            value={issue.dueDate ?? ''}
            onCommit={(draft) => {
              change(
                'Due date',
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
            <Row
              name="Estimate"
              field="originalEstimateSeconds"
              pending={pending.has('originalEstimateSeconds')}
            >
              <TextField
                label="Original estimate"
                value={originalEstimate}
                placeholder="Set estimate"
                clock
                valid={(draft) => parseEstimate(draft) !== null}
                hint="Use a duration such as 2h 30m."
                onCommit={(draft) => {
                  const seconds = parseEstimate(draft)
                  if (seconds === null) return
                  change(
                    'Original estimate',
                    { originalEstimate: draft.trim() },
                    { originalEstimateSeconds: seconds },
                  )
                }}
              />
            </Row>
            {hasEstimate && (
              <Row
                name="Time left (h)"
                field="timeRemainingHours"
                pending={pending.has('timeRemainingHours')}
              >
                <TextField
                  clock
                  label="Time remaining (h)"
                  type="number"
                  value={timeRemaining}
                  valid={(draft) => draft === '' || Number(draft) >= 0}
                  hint="Use a number of hours, 0 or more."
                  onCommit={(draft) => {
                    const hours = draft === '' ? null : Number(draft)
                    change(
                      'Time remaining',
                      { timeRemainingHours: hours },
                      {
                        timeRemainingHours: hours,
                      },
                    )
                  }}
                />
              </Row>
            )}
            <ReadOnly>
              <Row name="Remaining">
                <span className="flex h-8 items-center px-2">
                  <span className="sr-only">Remaining estimate, read-only: </span>
                  {issue.remainingEstimateSeconds === null
                    ? 'None'
                    : formatEstimate(issue.remainingEstimateSeconds)}
                </span>
              </Row>
            </ReadOnly>
          </>
        )}
      </Group>

      {prompt !== null && (
        <ParentPrompt
          subject={issue.key}
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
