import type { Issue } from '@jira-mgr/core'
import { describeDate, formatDay, parseDateInput } from '@jira-mgr/core/dates'
import { formatEstimate, parseEstimate, propertyRules } from '@jira-mgr/core/issue'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import type { CurrentUser, FieldChoice } from '../../shared/ipc'
import { DateInput } from './DateInput'
import { Reason } from './Failure'
import { Picker, type PickerOption } from './Picker'
import {
  AssigneePicker,
  LabelsPicker,
  ParentPicker,
  PriorityPicker,
  SprintPicker,
  StatusPicker,
  TypePicker,
  useIssueChange,
} from './PropertyPickers'
import { Row } from './PropertyRow'
import { useToday } from './today'
import {
  currentSprint,
  customerPatch,
  engagementPatch,
  hoursFromText,
  hoursText,
} from './properties'
import { useFieldOptions, usePendingFields } from './queries'

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
  'h-7 w-full min-w-0 rounded-md border border-field-border bg-transparent px-2 hover:bg-hover focus:bg-canvas disabled:opacity-60'

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
  /** The key that focuses the field from the page, such as `Shift+D`. */
  shortcut?: string
  /** What the field holds now. A change from outside replaces the draft. */
  value: string
  /** A `date` field reads a typed phrase or `dd/mm/yyyy`, shows the day it means, and sends `YYYY-MM-DD` or `''`. */
  type?: 'text' | 'date'
  /** Shown while the field is empty. */
  placeholder?: string
  /** A clock before the text, for durations. */
  clock?: boolean
  /** Called with the draft when it changed and the user left the field or pressed Enter. */
  onCommit: (draft: string) => void
  /** Whether a draft can be sent. A draft that cannot is shown as an error and not sent. */
  valid?: (draft: string) => boolean
  hint?: string
  /** The longest text the field takes. */
  maxLength?: number
  /** Marks the field for a `CellPopover`, which focuses it on opening. */
  autofocus?: boolean
  /** Sends a changed draft when the field unmounts without a blur, as a popover closed by a scroll does. */
  commitOnUnmount?: boolean
  /** Called with a date draft that cannot be read when the field unmounts, so the user hears that nothing saved. */
  onUnreadable?: (draft: string) => void
  /** Called after Tab or a click on a date suggestion has saved, as Enter would end an edit. */
  onPick?: (input: HTMLInputElement) => void
  /** A date's suggestion goes under the element with this CSS anchor name, not under the field. */
  suggestUnder?: string
}

/** A field that edits locally and saves on Enter or when focus leaves, and reverts on Esc. */
export function TextField({
  label,
  shortcut,
  value,
  type = 'text',
  placeholder,
  clock = false,
  onCommit,
  valid = () => true,
  hint,
  maxLength,
  autofocus = false,
  commitOnUnmount = false,
  onUnreadable,
  onPick,
  suggestUnder,
}: TextFieldProps) {
  const isDate = type === 'date'
  const today = useToday()
  // A date shows as the field reads it back, `10 Nov`, and not as the `YYYY-MM-DD` it holds.
  const shown = isDate && value !== '' ? formatDay(value, today) : value
  const [draft, setDraft] = useState(shown)
  // Whether the last attempt to save a date found a phrase it could not read.
  const [unread, setUnread] = useState(false)
  // Jira's answer replaces what was typed, adjusting state during render as React advises.
  const [seen, setSeen] = useState(shown)
  if (seen !== shown) {
    setSeen(shown)
    setDraft(shown)
    setUnread(false)
  }
  const invalid = draft !== shown && !valid(draft)
  // The draft last sent. Jira's answer lands a render later, and until it does `draft` still
  // differs from `value`, so Enter followed at once by leaving the field would send it twice.
  const sent = useRef<string | null>(null)
  // The day that draft meant. A click, a blur and an unmount can each carry a different text for
  // the same day, so a day goes out once.
  const sentDay = useRef<string | null>(null)

  /** Saves the text if it changed. False when a date cannot be read, so the draft stays. */
  function commit(closing = false, text = draft): boolean {
    if (text === shown || text === sent.current) return true
    if (!valid(text)) return true
    // An emptied date field clears the date.
    const day = !isDate ? text : text.trim() === '' ? '' : parseDateInput(text, today)
    if (day === null) {
      setUnread(true)
      if (closing) onUnreadable?.(text)
      return false
    }
    if (day === sentDay.current) return true
    if (day === value) {
      setDraft(shown)
      return true
    }
    sent.current = text
    sentDay.current = day
    onCommit(day)
    return true
  }

  // The field can unmount with a draft nobody left or confirmed. A passive cleanup runs after the
  // input has gone, so it reads the last render's draft rather than the element.
  const flush = useEffectEvent(() => {
    if (commitOnUnmount) commit(true)
  })
  useEffect(
    () => () => {
      flush()
    },
    [],
  )

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      // An unreadable date keeps its field and its message, so the Enter goes no further.
      if (!commit()) event.stopPropagation()
    } else if (event.key === 'Escape') {
      // The page's own Esc is for leaving, and this one only abandons the edit.
      event.stopPropagation()
      sent.current = null
      sentDay.current = null
      setUnread(false)
      setDraft(shown)
    }
  }

  // The day the draft means, shown before it saves so a misread phrase is caught.
  const meant =
    isDate && !unread && draft !== shown && draft.trim() !== ''
      ? parseDateInput(draft, today)
      : null
  if (isDate) {
    return (
      <DateInput
        label={label}
        anchor={suggestUnder}
        aria-keyshortcuts={shortcut}
        maxLength={maxLength ?? 100}
        data-autofocus={autofocus || undefined}
        placeholder={placeholder}
        value={draft}
        unread={unread}
        // Text that already reads as the replacement has nothing left to offer.
        suggestion={
          meant === null || formatDay(meant, today) === draft
            ? null
            : { label: describeDate(meant), text: formatDay(meant, today) }
        }
        onChange={(text) => {
          sent.current = null
          sentDay.current = null
          setUnread(false)
          setDraft(text)
        }}
        onAccept={(text, how, input) => {
          setDraft(text)
          // Tab would leave the field and save through its blur, but a cell editor may swallow
          // that blur (Tab to Clear), so the accept saves here, once, whichever follows. An
          // editor that ends with the accept keeps Tab from moving focus on, as Enter does.
          const saved = commit(false, text)
          if (saved) onPick?.(input)
          return how === 'tab' && saved && onPick !== undefined
        }}
        onBlur={() => {
          commit()
        }}
        onKeyDown={onKeyDown}
        noteClassName="block px-2 text-xs"
        className={`${FIELD} aria-invalid:border-danger`}
      />
    )
  }
  return (
    <>
      <div className="relative">
        {clock && <ClockIcon />}
        <input
          type="text"
          autoComplete="off"
          aria-label={label}
          aria-keyshortcuts={shortcut}
          maxLength={maxLength}
          data-autofocus={autofocus || undefined}
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => {
            sent.current = null
            setUnread(false)
            setDraft(event.target.value)
          }}
          onBlur={() => {
            commit()
          }}
          onKeyDown={onKeyDown}
          className={`${FIELD} aria-invalid:border-danger ${clock ? 'pl-7' : ''}`}
        />
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
  const pending = usePendingFields(issue.key)
  const [customerOpen, setCustomerOpen] = useState(false)
  const customers = useFieldOptions('customer', customerOpen)
  const [engagementOpen, setEngagementOpen] = useState(false)
  const engagements = useFieldOptions('engagement', engagementOpen)

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

  const sprint = currentSprint(issue)

  // Dates and estimates
  const originalEstimate =
    issue.originalEstimateSeconds === null ? '' : formatEstimate(issue.originalEstimateSeconds)
  const timeRemaining = hoursText(issue.timeRemainingHours)
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
            <TypePicker issue={issue} />
          </Row>
        )}
        {rules.parent && (
          <Row name="Parent" field="parentKey" pending={pending.has('parentKey')}>
            <ParentPicker issue={issue} issues={issues} />
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
                <SprintPicker issue={issue} />
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
            shortcut="Shift+S"
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
            shortcut="Shift+D"
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
                shortcut="Shift+E"
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
                name="Time left"
                field="timeRemainingHours"
                pending={pending.has('timeRemainingHours')}
              >
                <TextField
                  clock
                  label="Time left"
                  value={timeRemaining}
                  valid={(draft) => hoursFromText(draft) !== undefined}
                  hint="Use a duration such as 2h 30m."
                  onCommit={(draft) => {
                    const hours = hoursFromText(draft)
                    if (hours === undefined || hours === issue.timeRemainingHours) return
                    change(
                      'Time left',
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
    </aside>
  )
}
