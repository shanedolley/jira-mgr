import type { Issue } from '@jira-mgr/core'
import type { RowProperty } from '@jira-mgr/core/display'
import type { Progress } from '@jira-mgr/core/hierarchy'
import { memo, type ReactNode } from 'react'

import { Avatar } from './Avatar'
import { LabelDot, PriorityBars, priorityLevel } from './Glyphs'
import { ProgressPill, progressText } from './Progress'
import { dueTone, localDay, rowSprint, shortDate } from './rowProps'
import { StatusDot } from './StatusDot'
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

/**
 * The accessible name of a row, in one format per kind. An issue's name ends with what the row
 * shows only as a glyph, a pill or a column: its open blockers, its priority when not Medium, its
 * due date when the Due property is on, and its children's progress. The rest of the contents are
 * presentation only.
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
        ...(progress === undefined ? [] : [progressText(progress)]),
      ].join(', ')
    }
  }
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
 * Wraps a row's status dot or avatar, which open that property's picker on a click. The Tree owns
 * every key, so this is a click target only: `S` and `A` are the keyboard's way to the same pickers.
 */
function Pick({
  property,
  title,
  children,
}: {
  property: 'status' | 'assignee'
  title: string
  children: ReactNode
}) {
  return (
    <span
      data-pick={property}
      title={title}
      className="inline-flex shrink-0 cursor-pointer rounded-full p-0.5 -m-0.5 hover:bg-line"
    >
      {children}
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

/** The priority bars in a fixed slot, drawn only above or below the default (Medium), so the column lines up. */
function PrioritySlot({ priority }: { priority: Issue['priority'] }) {
  const shown = hasPriorityGlyph(priority)
  return (
    <span
      data-slot="priority"
      title={shown ? `Priority: ${priority.name}` : undefined}
      className="inline-flex size-4 shrink-0 items-center justify-center"
    >
      {shown && <PriorityBars name={priority.name} />}
    </span>
  )
}

const DUE_TONES = {
  overdue: 'text-danger',
  soon: 'text-status-doing',
  later: 'text-muted',
} as const

function DueDate({ issue, today }: { issue: Issue; today: string }) {
  const due = issue.dueDate
  const tone = due === null ? null : dueTone(due, today, issue.status.category === 'done')
  return (
    <span
      data-prop="due"
      data-tone={tone ?? undefined}
      title={due === null ? undefined : `Due ${due}`}
      className="inline-flex w-[6rem] shrink-0 items-center justify-end gap-1 whitespace-nowrap text-xs text-muted"
    >
      {due !== null && tone !== null && (
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
      )}
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
 * The properties the Display menu chose, in the menu's order. Each keeps a fixed slot, so the
 * columns line up down the Tree, and they show only while the Tree is wide, as the title needs the room.
 */
function Properties({
  issue,
  properties,
  today,
}: {
  issue: Issue
  properties: readonly RowProperty[]
  today: string
}) {
  if (properties.length === 0) return null
  const sprint = rowSprint(issue)
  const [firstLabel, ...moreLabels] = issue.labels
  return (
    <span data-props className="hidden shrink-0 items-center gap-2 @2xl:flex">
      {properties.map((property) => {
        switch (property) {
          case 'labels':
            return (
              <span
                key={property}
                data-prop="labels"
                title={issue.labels.join(', ') || undefined}
                className="flex w-24 shrink-0 items-center justify-end gap-1 text-xs text-muted"
              >
                {firstLabel !== undefined && (
                  <>
                    <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-line px-1.5 leading-4 text-ink">
                      <LabelDot />
                      <span className="truncate">{firstLabel}</span>
                    </span>
                    {moreLabels.length > 0 && <span>+{moreLabels.length}</span>}
                  </>
                )}
              </span>
            )
          case 'sprint':
            return (
              <span
                key={property}
                data-prop="sprint"
                title={sprint?.name}
                className="w-24 shrink-0 truncate text-right text-xs text-muted"
              >
                {sprint?.name}
              </span>
            )
          case 'due':
            return <DueDate key={property} issue={issue} today={today} />
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
  today,
  blocks,
  progress,
  onAdd,
}: {
  row: Row
  timing: boolean
  properties: readonly RowProperty[]
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
      // Context rows read as muted text, which keeps AA contrast, rather than as faded ink.
      const tone = contextOnly ? 'text-muted' : ''
      return (
        <>
          <TypeIcon type={issue.issueType} />
          <Pick property="status" title="Change status">
            <StatusDot status={issue.status} />
          </Pick>
          <span className="tree-key w-[5.5rem] min-w-fit shrink-0 text-xs font-[450] tabular-nums text-muted">
            {issue.key}
          </span>
          <span className={`min-w-0 flex-1 truncate font-medium ${tone}`}>{issue.summary}</span>
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
          <PrioritySlot priority={issue.priority} />
          <Properties issue={issue} properties={properties} today={today} />
          <Pick property="assignee" title="Change assignee">
            <Avatar person={issue.assignee} />
          </Pick>
        </>
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
  /** The shared timer runs on this row's issue. */
  timing: boolean
  /** The row properties the Display menu chose, shown on issue rows while the Tree is wide. */
  properties: readonly RowProperty[]
  /** Today's local date, which the due date's colour and the short dates read. */
  today: string
  /** The open issues holding this row's issue up, and held up by it, as counts so the memo holds. */
  blockedBy: number
  blocking: number
  onClick: (id: string, onChevron: boolean) => void
  /** A click on the row's status dot or avatar, after `onClick` has made the row active. */
  onPick: (key: string, property: 'status' | 'assignee') => void
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
  timing,
  properties,
  today,
  blockedBy,
  blocking,
  onClick,
  onPick,
  done,
  total,
  onAdd,
}: TreeRowProps) {
  const blocks = { blockedBy, blocking }
  const progress = done === undefined || total === undefined ? undefined : { done, total }
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
      data-active={active}
      onClick={(event) => {
        const target = event.target as Element
        onClick(row.id, target.closest('[data-chevron]') !== null)
        const picked = target.closest<HTMLElement>('[data-pick]')?.dataset.pick
        if (row.kind === 'issue' && (picked === 'status' || picked === 'assignee')) {
          onPick(row.node.issue.key, picked)
        }
      }}
      data-band={row.kind === 'customer' ? '' : undefined}
      style={{
        // A header's slot starts with the gap above it, so the band sits at the slot's foot.
        top: row.kind === 'customer' ? top + HEADER_GAP : top,
        height: row.kind === 'customer' ? HEADER_HEIGHT : ROW_HEIGHT,
        paddingLeft: 4 + (row.level - 1) * 16,
      }}
      className="tree-row group/row absolute inset-x-2 flex cursor-default items-center gap-2 rounded-lg pr-2"
    >
      <Chevron row={row} />
      <Content
        row={row}
        timing={timing}
        properties={properties}
        today={today}
        blocks={blocks}
        progress={progress}
        onAdd={onAdd}
      />
    </div>
  )
})
