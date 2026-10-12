import type { Issue } from '@jira-mgr/core'
import { useId, useRef, useState } from 'react'

import type { BatchProgress, CurrentUser, FieldChoice } from '../../shared/ipc'
import { withAvatars } from './Avatar'
import {
  assigneeAction,
  customerAction,
  labelAction,
  planBulk,
  priorityAction,
  refusedBatchNotice,
  sprintAction,
  statusAction,
  type BulkAction,
} from './batch'
import { LabelDot, PriorityBars } from './Glyphs'
import type { Notify } from './notify'
import type { BatchRun } from './optimistic'
import { Picker, type PickerOption, type PickerVariant } from './Picker'
import {
  NONE,
  STATE_LABELS,
  assigneeChoices,
  assigneeOptions,
  isLabel,
  projectLabels,
  recentAssignees,
  shownSprints,
  type Person,
} from './properties'
import { statusChoices, statusOptions } from './PropertyPickers'
import { useFieldOptions, useSprints, useTransitions, useUsers, type BatchOptions } from './queries'
import { useDebounced } from './useDebounced'

/** What every property picker of the bar needs. */
interface ChoiceProps {
  /** The checked issues, in the order they were checked. */
  checked: readonly Issue[]
  /** Every loaded issue: the recent assignees and the labels come from them. */
  all: readonly Issue[]
  me: CurrentUser | undefined
  variant: PickerVariant
  disabled: boolean
  /** Sends the action. `stay` keeps the Actions menu open, for a picker that chooses several. */
  apply: (action: BulkAction, stay?: boolean) => void
}

/** What a picker's trigger shows. The accessible name is the property alone, as the action it opens. */
const trigger = (label: string) => ({ label, triggerLabel: label, valueText: label, selected: [] })

/**
 * The statuses the first checked issue can reach, with its own. A status another issue cannot
 * reach is refused for that issue alone, and named in the notice.
 */
function StatusChoice({ checked, variant, disabled, apply }: ChoiceProps) {
  const [open, setOpen] = useState(false)
  const lead = checked[0]
  const transitions = useTransitions(lead?.key ?? '', open && lead !== undefined)
  const choices = lead === undefined ? [] : statusChoices(lead, transitions.data ?? [])
  return (
    <Picker
      {...trigger('Status')}
      variant={variant}
      disabled={disabled}
      options={statusOptions(choices)}
      numbered
      onSelect={(id) => {
        const choice = choices.find((o) => o.id === id)
        if (choice !== undefined) apply(statusAction(choice))
      }}
      onOpenChange={setOpen}
      note={transitions.isPending ? 'Loading statuses' : undefined}
    />
  )
}

function AssigneeChoice({ all, me, variant, disabled, apply }: ChoiceProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const found = useUsers(useDebounced(query.trim()), open)
  const meUser: Person | undefined =
    me === undefined
      ? undefined
      : { accountId: me.accountId, displayName: me.displayName, avatarUrl: me.avatarUrl }
  const choices = assigneeChoices(
    meUser,
    recentAssignees(all, me?.accountId ?? ''),
    found.data ?? [],
    query.trim(),
  )
  const people = new Map<string, Person>(
    [...choices.suggested, ...choices.others].map((p) => [p.accountId, p]),
  )
  return (
    <Picker
      {...trigger('Assignee')}
      variant={variant}
      disabled={disabled}
      options={withAvatars(assigneeOptions(choices, query, me?.accountId), people)}
      searchable
      onQuery={setQuery}
      onSelect={(id) => {
        const person = id === NONE ? null : (people.get(id) ?? null)
        if (id === NONE || person !== null) apply(assigneeAction(person))
      }}
      onOpenChange={setOpen}
      note={found.isFetching ? 'Searching' : undefined}
    />
  )
}

const fromChoices = (choices: FieldChoice[] | undefined): PickerOption[] =>
  (choices ?? []).map((c) => ({ id: c.id, label: c.name }))

function PriorityChoice({ variant, disabled, apply }: ChoiceProps) {
  const [open, setOpen] = useState(false)
  const priorities = useFieldOptions('priority', open)
  return (
    <Picker
      {...trigger('Priority')}
      variant={variant}
      disabled={disabled}
      options={fromChoices(priorities.data).map((o) => ({
        ...o,
        leading: <PriorityBars name={o.label} />,
      }))}
      numbered
      onSelect={(id) => {
        const choice = priorities.data?.find((c) => c.id === id)
        if (choice !== undefined) apply(priorityAction(choice))
      }}
      onOpenChange={setOpen}
      note={priorities.isPending ? 'Loading priorities' : undefined}
    />
  )
}

/** A label is on when every checked issue has it. Choosing one adds it to the rest, or removes it from all. */
function LabelsChoice({ checked, all, variant, disabled, apply }: ChoiceProps) {
  const held = projectLabels(checked).filter((label) =>
    checked.every((issue) => issue.labels.includes(label)),
  )
  const options: PickerOption[] = [
    ...new Set([...checked.flatMap((i) => i.labels), ...projectLabels(all)]),
  ].map((label) => ({ id: label, label, leading: <LabelDot /> }))
  const toggle = (label: string) => {
    apply(labelAction(label, !held.includes(label)), true)
  }
  return (
    <Picker
      {...trigger('Labels')}
      selected={held}
      variant={variant}
      disabled={disabled}
      options={options}
      multiple
      searchable
      create={{ valid: isLabel, label: (text) => `Create "${text}"` }}
      onSelect={toggle}
      onCreate={(text) => {
        apply(labelAction(text, true), true)
      }}
    />
  )
}

function SprintChoice({ variant, disabled, apply }: ChoiceProps) {
  const [open, setOpen] = useState(false)
  const sprints = useSprints(false, open)
  const shown = shownSprints(sprints.data ?? [], false)
  return (
    <Picker
      {...trigger('Sprint')}
      variant={variant}
      disabled={disabled}
      options={[
        { id: NONE, label: 'Backlog' },
        ...shown.map((s) => ({ id: String(s.id), label: s.name, detail: STATE_LABELS[s.state] })),
      ]}
      onSelect={(id) => {
        const sprint = shown.find((s) => String(s.id) === id)
        if (id === NONE) apply(sprintAction(null))
        else if (sprint !== undefined) apply(sprintAction(sprint))
      }}
      onOpenChange={setOpen}
      note={sprints.isPending ? 'Loading sprints' : undefined}
    />
  )
}

function CustomerChoice({ variant, disabled, apply }: ChoiceProps) {
  const [open, setOpen] = useState(false)
  const customers = useFieldOptions('customer', open)
  return (
    <Picker
      {...trigger('Customer')}
      variant={variant}
      disabled={disabled}
      options={fromChoices(customers.data)}
      searchable
      onSelect={(id) => {
        const choice = customers.data?.find((c) => c.id === id)
        if (choice !== undefined) apply(customerAction(choice))
      }}
      onOpenChange={setOpen}
      note={customers.isPending ? 'Loading Customers' : undefined}
    />
  )
}

interface BulkBarProps {
  /** The checked issues, in the order they were checked. */
  checked: readonly Issue[]
  /** Every loaded issue. */
  all: readonly Issue[]
  me: CurrentUser | undefined
  /** The running batch's progress, or `null` between batches. */
  progress: BatchProgress | null
  run: (options: BatchOptions) => Promise<BatchRun>
  onNotice: Notify
  /** Unchecks every issue. */
  onClear: () => void
}

/**
 * The bar that floats over the foot of the Tree while issues are checked: how many, Status as the
 * primary action, an Actions menu of every property, and a clear button. The selection stays after
 * an action, so another can follow. While a batch runs the count reads its progress and the
 * actions wait, since a second batch over the same issues would race the first.
 */
export function BulkBar({ checked, all, me, progress, run, onNotice, onClear }: BulkBarProps) {
  const menuId = useId()
  const menu = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  if (checked.length === 0) return null
  const running = busy || progress !== null

  function apply(action: BulkAction, stay = false) {
    // The ref answers a second click in the same tick, before `busy` has rendered.
    const plan = planBulk(checked, action, running || inFlight.current)
    if (!('run' in plan)) {
      if (plan.stop !== null) onNotice(plan.stop)
      return
    }
    if (!stay) menu.current?.hidePopover()
    inFlight.current = true
    setBusy(true)
    const items = plan.run
    run({ items, title: action.title }).then(
      ({ refused }) => {
        inFlight.current = false
        setBusy(false)
        if (refused.length > 0) onNotice(refusedBatchNotice(capital(action.what), refused))
      },
      (failure: unknown) => {
        inFlight.current = false
        setBusy(false)
        onNotice({
          title: `Could not change the ${action.what}`,
          notes: [failure instanceof Error ? failure.message : 'The batch failed.'],
          warned: true,
        })
      },
    )
  }

  const shared = { checked, all, me, disabled: running, apply }
  return (
    <div
      role="toolbar"
      aria-label="Selected issues"
      className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-line bg-panel py-1.5 pl-3 pr-1.5 shadow-[0_8px_24px_oklch(0_0_0/0.18)]"
    >
      <span aria-live="polite" className="min-w-[7.5rem] truncate tabular-nums">
        {progress === null
          ? `${String(checked.length)} selected`
          : `Updating ${String(progress.done)} of ${String(progress.total)}`}
      </span>
      <StatusChoice {...shared} variant="chip" />
      <button
        type="button"
        popoverTarget={menuId}
        disabled={running}
        style={{ anchorName: `--bulk-${menuId.replaceAll(/[^a-zA-Z0-9]/g, '')}` }}
        className="btn btn-sm gap-2"
      >
        Actions
      </button>
      <div
        ref={menu}
        id={menuId}
        popover="auto"
        style={{
          positionAnchor: `--bulk-${menuId.replaceAll(/[^a-zA-Z0-9]/g, '')}`,
          positionArea: 'block-start span-inline-end',
          positionTryFallbacks: 'flip-block, flip-inline',
          margin: '0 0 4px',
        }}
        className="menu w-44"
      >
        <StatusChoice {...shared} variant="row" />
        <AssigneeChoice {...shared} variant="row" />
        <LabelsChoice {...shared} variant="row" />
        <PriorityChoice {...shared} variant="row" />
        <SprintChoice {...shared} variant="row" />
        <CustomerChoice {...shared} variant="row" />
      </div>
      <button
        type="button"
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        onClick={onClear}
        className="btn btn-sm btn-icon btn-ghost"
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  )
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
