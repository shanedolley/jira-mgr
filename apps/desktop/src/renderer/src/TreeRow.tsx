import type { Issue } from '@jira-mgr/core'
import { sprintLabel, sprintTitle, type RowProperty } from '@jira-mgr/core/display'
import type { Progress } from '@jira-mgr/core/hierarchy'
import { propertyRules } from '@jira-mgr/core/issue'
import { memo, type ReactNode } from 'react'

import { Avatar } from './Avatar'
import { isCellProperty, type CellProperty } from './cell'
import { EstimateCell } from './EstimateField'
import { LabelDot, PriorityBars, priorityLevel } from './Glyphs'
import { Icon, PENCIL } from './Icon'
import { keyOf } from './keymap'
import { useLogWork } from './logWork'
import { ProgressPill, progressText } from './Progress'
import { dueTone, localDay, rowSprint, shortDate, timeValue, type TimeProperty } from './rowProps'
import { Slot } from './Slot'
import { holdFade, StatusDot } from './StatusDot'
import { summaryClick } from './summaryEdit'
import { TimerClock } from './TimerClock'
import { HEADER_GAP, HEADER_HEIGHT, ROW_HEIGHT, type TreeRow as Row } from './tree'
import { TypeIcon } from './TypeIcon'

/** The DOM id of a row, which the Tree's `aria-activedescendant` points at. */
export const rowDomId = (id: string) => `tree-row-${id}`

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`

/** Whether a priority is drawn as a glyph: not the default level (Medium) and one the glyph knows. */
const hasPriorityGlyph = (
  priority: Issue['priority'],
): priority is NonNullable<Issue['priority']> =>
  priority !== null &&
  priorityLevel(priority.name) !== 0 &&
  priorityLevel(priority.name) !== priorityLevel('Medium')

/** How many open issues hold a row's issue up, and how many it holds up. */
export interface BlockCounts {
  blockedBy: number
  blocking: number
}

const NO_BLOCKS: BlockCounts = { blockedBy: 0, blocking: 0 }

const blockedTitle = (n: number) => `Blocked by ${plural(n, 'issue')}`
const blockingTitle = (n: number) => `Blocking ${plural(n, 'issue')}`

/** What each time property is called: lower-cased in a row's name, as is in a slot's title and label. */
const TIME_NAMES: Record<TimeProperty, string> = {
  estimate: 'Original estimate',
  logged: 'Logged',
  remaining: 'Remaining',
  remainingPercent: 'Remaining percent',
}

const isTime = (property: RowProperty): property is TimeProperty => property in TIME_NAMES

/**
 * The accessible name of a row, in one format per kind. An issue's name ends with what the row
 * shows only as a glyph, a pill or a column: its open blockers, its priority when not Medium, its
 * due date and time values when their properties are on, and its children's progress. The rest of
 * the contents are presentation only.
 */
export function rowName(
  row: Row,
  properties: readonly RowProperty[] = [],
  blocks: BlockCounts = NO_BLOCKS,
  progress?: Progress,
): string {
  switch (row.kind) {
    case 'customer':
      return `${row.customer?.value ?? 'No Customer'}, ${plural(row.count, 'issue')}`
    case 'noEpic':
      return `No Epic, ${plural(row.count, 'issue')}`
    case 'chip':
      return `${String(row.doneCount)} done`
    case 'issue': {
      const { issue, contextOnly, customerMismatch } = row.node
      const sprint = properties.includes('sprint') ? rowSprint(issue) : undefined
      return [
        issue.key,
        issue.issueType.name,
        issue.status.name,
        issue.summary,
        issue.assignee?.displayName ?? 'unassigned',
        ...(customerMismatch === null ? [] : ['Customer differs from Epic']),
        ...(contextOnly ? ['context'] : []),
        ...(blocks.blockedBy > 0 ? [blockedTitle(blocks.blockedBy).toLowerCase()] : []),
        ...(blocks.blocking > 0 ? [blockingTitle(blocks.blocking).toLowerCase()] : []),
        ...(hasPriorityGlyph(issue.priority) ? [`priority ${issue.priority.name}`] : []),
        ...(properties.includes('due') && issue.dueDate !== null ? [`due ${issue.dueDate}`] : []),
        ...(sprint === undefined ? [] : [`sprint ${sprintTitle(sprint)}`]),
        ...properties.filter(isTime).flatMap((property) => {
          const value = timeValue(issue, property)
          return value === null ? [] : [`${TIME_NAMES[property].toLowerCase()} ${value}`]
        }),
        ...(progress === undefined ? [] : [progressText(progress)]),
      ].join(', ')
    }
  }
}

/**
 * The progress a row shows: a Story, Task or Bug (hierarchy level 0) with sub-issues. An Epic, a
 * Subtask and a childless issue show none.
 */
export function rowProgress(
  row: Row,
  progress: ReadonlyMap<string, Progress>,
): Progress | undefined {
  return row.kind === 'issue' && row.node.issue.issueType.hierarchyLevel === 0
    ? progress.get(row.node.issue.key)
    : undefined
}

function Chevron({ row }: { row: Row }) {
  if (!row.expandable) return <span aria-hidden className="size-4 shrink-0" />
  return (
    <svg
      aria-hidden
      data-chevron
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 rounded text-muted hover:bg-line ${row.expanded ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4.5 9.5 8 6 11.5" />
    </svg>
  )
}

/**
 * Wraps a row's status dot, priority slot or avatar, which open that property's picker on a click in
 * a popover anchored to the cell (the cell editor). The Tree owns every key, so this is a click
 * target only: `S`, `P` and `A` are the keyboard's way to the same pickers. It selects no text. The
 * priority slot is often empty, so it shows its target as a faint outline on hover, where the round
 * dot and avatar fill.
 */
function Pick({
  property,
  title,
  children,
}: {
  property: 'status' | 'priority' | 'assignee'
  title: string
  children: ReactNode
}) {
  return (
    <span
      data-pick={property}
      title={title}
      className={`inline-flex shrink-0 cursor-pointer select-none p-0.5 -m-0.5 ${
        property === 'priority'
          ? 'rounded hover:outline hover:outline-1 hover:outline-line'
          : 'rounded-full hover:bg-line'
      }`}
    >
      {children}
    </span>
  )
}

/**
 * The pencil after a row's summary, which opens the summary editor on a click. It shows under the
 * pointer and is a click target only, as `Pick` is: `E` is the keyboard's way to the same editor.
 */
function EditPencil() {
  return (
    <span
      data-edit="summary"
      title="Edit summary (E)"
      className="-ml-1 inline-flex shrink-0 cursor-pointer rounded p-0.5 text-muted opacity-0 hover:bg-line group-hover/row:opacity-100"
    >
      <Icon path={PENCIL} />
    </span>
  )
}

/**
 * The checkbox in an issue row's left gutter, drawn only: a click on it is read by the row, and `X`
 * is the keyboard's way to the same. It shows under the pointer, on the active row and, once any
 * row is checked, on every row. A checked box is the one place the accent fills, as a control.
 */
function Check({ checked, shown }: { checked: boolean; shown: boolean }) {
  return (
    <span
      aria-hidden
      data-check
      className={`absolute left-0.5 flex size-4 items-center justify-center group-hover/row:opacity-100 group-data-[active=true]/row:opacity-100 ${shown ? 'opacity-100' : 'opacity-0'}`}
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" strokeLinecap="round">
        <rect
          x="1.5"
          y="1.5"
          width="13"
          height="13"
          rx="3.5"
          className={checked ? 'fill-accent' : 'stroke-muted'}
          strokeWidth="1.25"
        />
        {checked && (
          <path
            d="m4.8 8.3 2.2 2.2 4.2-4.6"
            className="stroke-accent-ink"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </span>
  )
}

/** Adds an issue to a group: a header's "+" opens create with that group's Customer. */
function AddButton({ row, onAdd }: { row: Row; onAdd: (row: Row) => void }) {
  const customer = row.kind === 'customer' || row.kind === 'noEpic' ? row.customer : null
  const label =
    row.kind === 'noEpic'
      ? `No Epic in ${customer?.value ?? 'No Customer'}`
      : (customer?.value ?? 'No Customer')
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`Add issue to ${label}`}
      title="Add issue"
      // Keeps focus in the Tree, so the click moves neither the active row nor the keyboard.
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={(event) => {
        event.stopPropagation()
        onAdd(row)
      }}
      // The row's double-click must not open the issue an earlier click armed.
      onDoubleClick={(event) => {
        event.stopPropagation()
      }}
      className="btn btn-sm btn-icon btn-ghost opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 group-data-[active=true]/row:opacity-100"
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
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
    </button>
  )
}

function mismatchTitle(mismatch: {
  own: { value: string } | null
  epic: { value: string } | null
}) {
  return `Customer: ${mismatch.own?.value ?? 'none'}. Epic's Customer: ${mismatch.epic?.value ?? 'none'}.`
}

const PILL =
  'inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-1.5 text-[11px] leading-4 tabular-nums'

/**
 * Pills for the open issues that hold a row's issue up and the open issues it holds up, drawn only
 * when a count is above zero. The red is the icon's, and the shapes differ so the pair reads
 * without colour: a disc for blocked, a square for blocking. The count is text, so it keeps its contrast.
 */
function BlockPills({ blockedBy, blocking }: BlockCounts) {
  return (
    <>
      {blockedBy > 0 && (
        <span data-pill="blocked" title={blockedTitle(blockedBy)} className={PILL}>
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 text-danger">
            <circle cx="8" cy="8" r="6.5" fill="currentColor" />
            <path d="M5 8h6" stroke="var(--panel)" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          {blockedBy}
        </span>
      )}
      {blocking > 0 && (
        <span data-pill="blocking" title={blockingTitle(blocking)} className={PILL}>
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="size-3.5 shrink-0 text-danger"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
            <path d="M5.5 8h5" />
          </svg>
          {blocking}
        </span>
      )}
    </>
  )
}

/**
 * The priority bars in a fixed slot, drawn only above or below the default (Medium), so the column
 * lines up. The Tree row wraps the slot in a `Pick` and the Sprint page row in a `Slot`, so an empty
 * slot is still a click target.
 */
export function PrioritySlot({ priority }: { priority: Issue['priority'] }) {
  const shown = hasPriorityGlyph(priority)
  return (
    <span data-slot="priority" className="inline-flex size-4 shrink-0 items-center justify-center">
      {shown && <PriorityBars name={priority.name} />}
    </span>
  )
}

/** The priority slot as a click target for the cell editor: drawn or empty, it keeps its 16px. */
export function PriorityCell({ priority }: { priority: Issue['priority'] }) {
  return (
    <Pick property="priority" title="Change priority">
      <PrioritySlot priority={priority} />
    </Pick>
  )
}

const DUE_TONES = {
  overdue: 'text-danger',
  soon: 'text-status-doing',
  later: 'text-muted',
} as const

/**
 * The due date in a fixed slot. The whole slot, filled or empty, is a click target for the date
 * editor (`data-pick`, as `Pick` marks a cell). On the Tree `Shift+D` is the keyboard's way to it;
 * on the Sprint page (`always`) the slot is a `Slot` button, which takes Enter and Space natively.
 * Without `onEditCell` the Sprint page's slot is drawn only.
 */
function DueDate({
  issue,
  today,
  always,
  onEditCell,
}: {
  issue: Issue
  today: string
  always: boolean
  onEditCell?: (issue: Issue, property: CellProperty, cell: HTMLElement) => void
}) {
  const due = issue.dueDate
  const tone = due === null ? null : dueTone(due, today, issue.status.category === 'done')
  const key = keyOf('dueDate')
  const text = due === null ? undefined : `Due ${due}`
  const editable = !always || onEditCell !== undefined
  const shared = {
    'data-prop': 'due',
    'data-pick': editable ? 'dueDate' : undefined,
    'data-tone': tone ?? undefined,
    title: always
      ? (text ?? (editable ? 'Set due date' : undefined))
      : `${text ?? 'Set due date'}${key === undefined ? '' : ` (${key})`}`,
    className: `inline-flex w-[6rem] shrink-0 items-center justify-end gap-1 whitespace-nowrap text-xs text-muted ${editable ? 'cursor-pointer select-none rounded hover:bg-line' : ''}`,
  }
  const content = due !== null && tone !== null && (
    <>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className={`size-3.5 shrink-0 ${DUE_TONES[tone]}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.5 3.5h11v10h-11ZM2.5 6.5h11M5.5 2v3M10.5 2v3" />
      </svg>
      {shortDate(due, today)}
    </>
  )
  return always && onEditCell !== undefined ? (
    <Slot
      {...shared}
      aria-label={`Due date of ${issue.key}: ${due ?? 'none'}`}
      aria-haspopup="dialog"
      onClick={(event) => {
        onEditCell(issue, 'dueDate', event.currentTarget)
      }}
    >
      {content}
    </Slot>
  ) : (
    <span {...shared}>{content}</span>
  )
}

/**
 * A time property in a fixed slot: empty without a value, so the columns line up. The Tree row's
 * name already says what each value is; the label is for the Sprint page's rows, which have none.
 */
export function TimeCell({
  issue,
  property,
  always,
}: {
  issue: Issue
  property: TimeProperty
  always: boolean
}) {
  const log = useLogWork()
  // The estimate is edited in place, except on an Epic, which has none.
  if (property === 'estimate' && propertyRules(issue.issueType).estimates) {
    return <EstimateCell issue={issue} always={always} />
  }
  const value = timeValue(issue, property)
  // The Logged slot, filled or empty, opens the Log work modal. An Epic has no time tracking, so no target.
  const target =
    property === 'logged' && log !== null && propertyRules(issue.issueType).estimates ? log : null
  const shared = {
    'data-prop': property,
    title:
      value === null
        ? target === null
          ? undefined
          : 'Log work'
        : `${TIME_NAMES[property]} ${value}`,
    className: `shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted ${property === 'remainingPercent' ? 'w-12' : 'w-16'} ${target === null ? '' : 'cursor-pointer rounded hover:bg-line'}`,
  }
  const text = (
    <>
      {value !== null && <span className="sr-only">{TIME_NAMES[property]} </span>}
      {value}
    </>
  )
  if (target === null) return <span {...shared}>{text}</span>
  // The label replaces the text as the name, so it keeps the value.
  const label = `Log work on ${issue.key}, ${value === null ? 'nothing logged' : `${TIME_NAMES[property]} ${value}`}`
  // On the Sprint page the slot is a button beside the row's own. In the Tree the row's click would
  // open the Peek, and its double-click the issue.
  return always ? (
    <Slot
      {...shared}
      aria-label={label}
      onClick={() => {
        target(issue)
      }}
    >
      {text}
    </Slot>
  ) : (
    <span
      {...shared}
      role="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        target(issue)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
      }}
    >
      {text}
    </span>
  )
}

function DateCell({ property, at, today }: { property: string; at: string; today: string }) {
  return (
    <span
      data-prop={property}
      title={`${property === 'created' ? 'Created' : 'Updated'} ${localDay(at)}`}
      className="w-[4.5rem] shrink-0 whitespace-nowrap text-right text-xs text-muted"
    >
      {shortDate(at, today)}
    </span>
  )
}

/**
 * The Tree's property strip shrinks to what the row has left once the title has its minimum, and a
 * slot that no longer fits wraps to a second line, below the strip's one-line height and clipped.
 * The trailing slots drop first and the title is never squeezed out. `gap-y-5` and `h-5` keep a
 * wrapped slot clear of the strip.
 */
const TREE_PROPS =
  'hidden h-5 min-w-0 flex-wrap content-start justify-end gap-y-5 overflow-hidden @tree:flex [&>*]:h-5 [&>*]:leading-5'

/**
 * The properties the Display menu chose, in the menu's order. Each keeps a fixed slot, so the
 * columns line up down the list. The Tree shows them only while it is wide, as the title needs the
 * room; `always` is for the Sprint page's list: it shows them at any width, and they wrap onto their own line when the title would have no room.
 */
export function Properties({
  issue,
  properties,
  today,
  always = false,
  id,
  onEditCell,
}: {
  issue: Issue
  properties: readonly RowProperty[]
  today: string
  always?: boolean
  /**
   * Opens the cell editor on a Sprint page cell; the cells that have an editor are slots only when
   * it is set. The Tree's cells are read by the row's click.
   */
  onEditCell?: (issue: Issue, property: CellProperty, cell: HTMLElement) => void
  /** Lets the Sprint page's row button describe itself by these values. */
  id?: string
}) {
  if (properties.length === 0) return null
  const sprint = rowSprint(issue)
  // The Sprint slot is a click target, on the Sprint page a button once it can open the editor.
  // An Epic or a Subtask has no sprint, so its slot is not.
  const sprintCell = propertyRules(issue.issueType).sprint && (!always || onEditCell !== undefined)
  const [firstLabel, ...moreLabels] = issue.labels
  return (
    <span
      id={id}
      data-props
      className={`items-center gap-x-2 ${always ? 'flex max-w-full flex-wrap justify-end gap-y-1' : TREE_PROPS}`}
    >
      {properties.map((property) => {
        switch (property) {
          case 'labels': {
            const chips = firstLabel !== undefined && (
              <>
                <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-line px-1.5 leading-4 text-ink">
                  <LabelDot />
                  <span className="truncate">{firstLabel}</span>
                </span>
                {moreLabels.length > 0 && <span>+{moreLabels.length}</span>}
              </>
            )
            // The whole slot is the cell editor's target, filled or empty. The Tree's row reads the
            // click; the Sprint page's slot is a button beside the row's own (Slot).
            const shared = {
              'data-prop': 'labels',
              'data-pick': 'labels',
              title: issue.labels.join(', ') || 'Add labels',
              className:
                'flex w-24 shrink-0 cursor-pointer select-none items-center justify-end gap-1 rounded-md text-xs text-muted hover:bg-line',
            }
            return always ? (
              <Slot
                key={property}
                {...shared}
                aria-label={`Labels of ${issue.key}: ${issue.labels.join(', ') || 'none'}`}
                aria-haspopup="listbox"
                onClick={(event) => {
                  onEditCell?.(issue, 'labels', event.currentTarget)
                }}
              >
                {chips}
              </Slot>
            ) : (
              <span key={property} {...shared}>
                {chips}
              </span>
            )
          }
          case 'sprint': {
            const shared = {
              'data-prop': 'sprint',
              'data-pick': sprintCell ? 'sprint' : undefined,
              title:
                sprint === undefined
                  ? sprintCell
                    ? 'Set sprint'
                    : undefined
                  : sprintTitle(sprint),
              className: `w-[6.5rem] shrink-0 truncate text-right text-xs text-muted ${sprintCell ? 'cursor-pointer select-none rounded hover:bg-line' : ''}`,
            }
            const text = sprint === undefined ? undefined : sprintLabel(sprint, today)
            // On the Sprint page the slot is a button beside the row's own, named by its value.
            return always && onEditCell !== undefined && sprintCell ? (
              <Slot
                key={property}
                {...shared}
                aria-label={`Sprint of ${issue.key}: ${sprint?.name ?? 'Backlog'}`}
                aria-haspopup="listbox"
                onClick={(event) => {
                  onEditCell(issue, 'sprint', event.currentTarget)
                }}
              >
                {text}
              </Slot>
            ) : (
              <span key={property} {...shared}>
                {text}
              </span>
            )
          }
          case 'estimate':
          case 'logged':
          case 'remaining':
          case 'remainingPercent':
            return <TimeCell key={property} issue={issue} property={property} always={always} />
          case 'due':
            return (
              <DueDate
                key={property}
                issue={issue}
                today={today}
                always={always}
                onEditCell={onEditCell}
              />
            )
          case 'created':
            return <DateCell key={property} property={property} at={issue.created} today={today} />
          case 'updated':
            return <DateCell key={property} property={property} at={issue.updated} today={today} />
        }
      })}
    </span>
  )
}

function Content({
  row,
  timing,
  properties,
  shown,
  today,
  blocks,
  progress,
  onAdd,
}: {
  row: Row
  timing: boolean
  properties: readonly RowProperty[]
  shown: number
  today: string
  blocks: BlockCounts
  progress: Progress | undefined
  onAdd: (row: Row) => void
}) {
  switch (row.kind) {
    case 'customer':
      return (
        <>
          <span className="min-w-0 truncate font-semibold">
            {row.customer?.value ?? 'No Customer'}
          </span>
          <span className="ml-auto shrink-0 text-xs text-muted">
            {row.count === 0 ? 'No issues' : plural(row.count, 'issue')}
          </span>
          <AddButton row={row} onAdd={onAdd} />
        </>
      )
    case 'noEpic':
      return (
        <>
          <span className="min-w-0 truncate font-medium text-muted">No Epic</span>
          <span className="ml-auto shrink-0 text-xs text-muted">{plural(row.count, 'issue')}</span>
          <AddButton row={row} onAdd={onAdd} />
        </>
      )
    case 'chip':
      return (
        <span className="rounded-md border border-line px-2 text-xs text-muted">
          {row.expanded ? `Hide ${String(row.doneCount)} done` : `${String(row.doneCount)} done`}
        </span>
      )
    case 'issue': {
      const { issue, contextOnly, customerMismatch } = row.node
      return (
        <span {...holdFade(issue.status)} className="flex min-w-0 flex-1 items-center gap-2">
          <TypeIcon type={issue.issueType} />
          <Pick property="status" title="Change status">
            <StatusDot status={issue.status} />
          </Pick>
          <span className="tree-key w-[5.5rem] min-w-fit shrink-0 text-xs font-[450] tabular-nums text-muted">
            {issue.key}
          </span>
          <span
            data-summary
            className={`tree-summary min-w-0 flex-1 truncate text-muted @tree:min-w-20 ${contextOnly ? 'font-normal' : 'font-medium'}`}
          >
            {issue.summary}
          </span>
          <EditPencil />
          <BlockPills {...blocks} />
          {customerMismatch !== null && (
            <span
              title={mismatchTitle(customerMismatch)}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-1.5 text-[11px] leading-4"
            >
              <span aria-hidden className="size-1.5 rounded-full bg-status-doing" />
              Customer differs
            </span>
          )}
          {timing && <TimerClock issueKey={issue.key} className="shrink-0" />}
          {progress !== undefined && <ProgressPill progress={progress} />}
          <PriorityCell priority={issue.priority} />
          <Properties issue={issue} properties={properties.slice(0, shown)} today={today} />
          <Pick property="assignee" title="Change assignee">
            <Avatar person={issue.assignee} />
          </Pick>
        </span>
      )
    }
  }
}

interface TreeRowProps {
  row: Row
  /** Where the row's slot starts, in pixels from the top of the list. */
  top: number
  active: boolean
  /** The row whose issue the Peek shows. */
  selected: boolean
  /** The row's issue is checked, for a bulk action. */
  checked: boolean
  /** Some row is checked, so every issue row shows its checkbox. */
  selecting: boolean
  /** The shared timer runs on this row's issue. */
  timing: boolean
  /** The row is being dragged to a new place among its siblings. */
  dragging: boolean
  /** The edge a drop would land beside, drawn as a line; `undefined` for every other row. */
  dropEdge: 'above' | 'below' | undefined
  /** The row properties the Display menu chose, shown on issue rows while the Tree is wide. */
  properties: readonly RowProperty[]
  /** How many of `properties`, from the first, fit in every row, which the Tree works out. */
  shown: number
  /** Today's local date, which the due date's colour and the short dates read. */
  today: string
  /** The open issues holding this row's issue up, and held up by it, as counts so the memo holds. */
  blockedBy: number
  blocking: number
  /**
   * `toggle` is a click on the checkbox and `range` a Shift+click, which check instead of opening.
   * `active` is a click on the status dot, which only makes the row active.
   */
  onClick: (
    id: string,
    onChevron: boolean,
    select: 'toggle' | 'range' | 'activate' | undefined,
    detail: number,
  ) => void
  /**
   * The issue a double-click opens, set by a first click: the row's issue, or `null` for a header,
   * a chip, the checkbox, the status dot, the avatar, the chevron or a Shift+click, which keep
   * their own double-click.
   */
  onArm: (id: string | null) => void
  /** A double-click, which opens the armed issue's page as Enter does. */
  onOpen: () => void
  /**
   * A click that asks for the summary editor, after `onClick` has made the row active. `wait` is a
   * second click on the summary, which a double-click may turn into a page open.
   */
  onEdit: (issue: Issue, wait: boolean) => void
  /** A click on the row's status dot or avatar, after `onClick` has made the row active: the cell editor opens on `cell`. */
  onCell: (issue: Issue, property: CellProperty, cell: HTMLElement) => void
  /** Done over total of the issue's children, which the row shows beside its title, as numbers so the memo holds. */
  done: number | undefined
  total: number | undefined
  /** A click on a group header's "+". */
  onAdd: (row: Row) => void
}

/** One row of any kind, positioned by the window. The Tree owns every key, so a row holds no button. */
export const TreeRow = memo(function TreeRow({
  row,
  top,
  active,
  selected,
  checked,
  selecting,
  timing,
  dragging,
  dropEdge,
  properties,
  shown,
  today,
  blockedBy,
  blocking,
  onClick,
  onArm,
  onOpen,
  onEdit,
  onCell,
  done,
  total,
  onAdd,
}: TreeRowProps) {
  const blocks = { blockedBy, blocking }
  const progress = done === undefined || total === undefined ? undefined : { done, total }
  // A header, a chip and an ancestor shown only as context cannot be checked.
  const checkable = row.kind === 'issue' && !row.node.contextOnly
  return (
    <div
      id={rowDomId(row.id)}
      role="treeitem"
      aria-label={rowName(row, properties, blocks, progress)}
      aria-level={row.level}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-selected={selected ? true : undefined}
      aria-checked={checkable && selecting ? checked : undefined}
      aria-keyshortcuts={row.kind === 'issue' ? 'E' : undefined}
      data-active={active}
      data-row-id={row.id}
      // An issue row drags to a new place among its siblings; a header and a chip do not.
      draggable={row.kind === 'issue'}
      data-dragging={dragging ? 'true' : undefined}
      data-drop={dropEdge}
      // A Shift+click checks a range, so it must not also select the text it crosses. Stopping the
      // default also stops the click from focusing the Tree, so the Tree takes focus here.
      onMouseDown={(event) => {
        if (!event.shiftKey) return
        event.preventDefault()
        event.currentTarget.closest<HTMLElement>('[role="tree"]')?.focus()
      }}
      onClick={(event) => {
        const target = event.target as Element
        if (event.detail === 1) {
          const own =
            target.closest('[data-check], [data-pick], [data-chevron], [data-edit]') !== null
          onArm(row.kind === 'issue' && !own && !event.shiftKey ? row.id : null)
        }
        const pick = target.closest<HTMLElement>('[data-pick]')
        const picked = pick?.dataset.pick
        // An in-row field or a cell with its own editor makes its row active and leaves the Peek as it is.
        // A Shift+click on the status dot or avatar checks a range instead, so it opens no editor.
        const select =
          target.closest('[data-check]') !== null
            ? 'toggle'
            : target.closest('[data-edit]') !== null
              ? 'activate'
              : event.shiftKey
                ? 'range'
                : isCellProperty(picked) && row.kind === 'issue'
                  ? 'activate'
                  : undefined
        onClick(row.id, target.closest('[data-chevron]') !== null, select, event.detail)
        if (row.kind !== 'issue') return
        const edit = summaryClick({
          active,
          selected,
          detail: event.detail,
          shiftKey: event.shiftKey,
          onSummary: target.closest('[data-summary]') !== null,
          onPencil: target.closest('[data-edit="summary"]') !== null,
        })
        if (edit !== null) onEdit(row.node.issue, edit === 'later')
        if (select === 'activate' && pick !== null && isCellProperty(picked)) {
          onCell(row.node.issue, picked, pick)
        }
      }}
      // A double-click opens the issue its first click hit, not the row under the pointer by then:
      // the Peek opening can move the rows between the two clicks.
      onDoubleClick={onOpen}
      data-band={row.kind === 'customer' ? '' : undefined}
      style={{
        // A header's slot starts with the gap above it, so the band sits at the slot's foot.
        top: row.kind === 'customer' ? top + HEADER_GAP : top,
        height: row.kind === 'customer' ? HEADER_HEIGHT : ROW_HEIGHT,
        paddingLeft: 4 + (row.level - 1) * 16,
      }}
      className="tree-row group/row absolute inset-x-2 flex cursor-default items-center gap-2 rounded-lg pr-2"
    >
      {checkable && <Check checked={checked} shown={selecting} />}
      <Chevron row={row} />
      <Content
        row={row}
        timing={timing}
        properties={properties}
        shown={shown}
        today={today}
        blocks={blocks}
        progress={progress}
        onAdd={onAdd}
      />
    </div>
  )
})
