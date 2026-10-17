import type { Issue } from '@jira-mgr/core'
import type { Progress } from '@jira-mgr/core/hierarchy'
import { useMemo, useState, type RefObject } from 'react'

import { Avatar } from './Avatar'
import { PriorityBars } from './Glyphs'
import {
  DEFAULT_EPIC_SORT,
  EPIC_COLUMNS,
  clickSort,
  epicRows,
  sortEpics,
  type EpicColumn,
  type EpicRow,
} from './overview'
import { OVERVIEW_ROW, OverviewFrame, TH, keepInView, type OverviewLoad } from './OverviewFrame'
import { NotLoaded, PercentDone, progressText } from './Progress'
import { dueTone, shortDate } from './rowProps'
import { holdFade, StatusDot } from './StatusDot'

const ARROWS = { asc: 'M8 12.5v-9M4.5 7 8 3.5 11.5 7', desc: 'M8 3.5v9M4.5 9 8 12.5 11.5 9' }

function SortHeader({
  column,
  label,
  sort,
  onSort,
}: {
  column: EpicColumn
  label: string
  sort: { column: EpicColumn; direction: 'asc' | 'desc' }
  onSort: (column: EpicColumn) => void
}) {
  const on = sort.column === column
  return (
    <th
      scope="col"
      aria-sort={on ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
      className={TH}
    >
      <button
        type="button"
        onClick={() => {
          onSort(column)
        }}
        className={`inline-flex items-center gap-1 rounded hover:text-ink ${on ? 'font-medium text-ink' : ''}`}
      >
        {label}
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={`size-3.5 ${on ? '' : 'invisible'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={ARROWS[on ? sort.direction : 'asc']} />
        </svg>
      </button>
    </th>
  )
}

function Row({
  row,
  today,
  doneFailed,
  onOpen,
}: {
  row: EpicRow
  today: string
  /** The Done issues failed to load, so the issue count and percent are unknown. */
  doneFailed: boolean
  onOpen: (key: string) => void
}) {
  const { issue, progress } = row
  // A table row cannot hold one fading element, so each cell fades alone; the row keeps its hover.
  // The first cell fades the key and summary inside its button, not the cell, so the button's focus
  // outline stays at full strength.
  const fade = holdFade(issue.status)
  const due = issue.dueDate
  const overdue =
    due !== null && dueTone(due, today, issue.status.category === 'done') === 'overdue'
  return (
    <tr
      data-issue-key={issue.key}
      onClick={() => {
        onOpen(issue.key)
      }}
      className="h-10 cursor-default border-t border-line hover:bg-hover"
    >
      <th scope="row" className="max-w-0 min-w-56 px-3 text-left font-normal">
        <button
          type="button"
          {...OVERVIEW_ROW}
          data-overview-key={issue.key}
          className="flex w-full min-w-0 items-center gap-2 text-left"
        >
          <span {...fade} className="w-[5.5rem] shrink-0 text-xs tabular-nums text-muted">
            {issue.key}
          </span>
          <span {...fade} className="min-w-0 truncate font-medium">
            {issue.summary}
          </span>
        </button>
      </th>
      <td {...fade} className="max-w-40 truncate px-3" title={issue.customer?.value}>
        {issue.customer?.value}
      </td>
      <td {...fade} className="px-3">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <StatusDot status={issue.status} />
          {issue.status.name}
        </span>
      </td>
      <td {...fade} className="px-3">
        {issue.priority !== null && (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <PriorityBars name={issue.priority.name} />
            {issue.priority.name}
          </span>
        )}
      </td>
      <td {...fade} className="px-3">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <Avatar person={issue.assignee} />
          {issue.assignee?.displayName ?? <span className="text-muted">Unassigned</span>}
        </span>
      </td>
      <td
        {...fade}
        className="px-3 tabular-nums"
        title={progress === undefined ? undefined : progressText(progress)}
      >
        {doneFailed ? <NotLoaded /> : (progress?.total ?? 0)}
      </td>
      <td
        {...fade}
        className={`px-3 whitespace-nowrap ${overdue ? 'text-danger' : ''}`}
        title={due === null ? undefined : `Due ${due}`}
      >
        {due === null ? null : shortDate(due, today)}
      </td>
      <td
        {...fade}
        className="px-3 whitespace-nowrap"
        title={progress === undefined ? undefined : progressText(progress)}
      >
        {doneFailed ? <NotLoaded /> : <PercentDone progress={progress} />}
      </td>
    </tr>
  )
}

/**
 * The Epics table: one row per Epic with its Customer, Status, Priority, Assignee, the number of
 * issues under it, its due date and the share of them that is Done. A header sorts by its column,
 * and a row opens the Epic's page. The counts are the loaded issues', so they grow once the Done
 * issues load, and the Issues and % done cells read "Not loaded" if that load fails.
 */
export function EpicsPage({
  issues,
  progress,
  today,
  doneLoading,
  load,
  front,
  pageRef,
  onBack,
  onOpen,
}: {
  issues: readonly Issue[]
  progress: ReadonlyMap<string, Progress>
  today: string
  /** The Done issues are still loading, so the counts are not final. */
  doneLoading: boolean
  load: OverviewLoad
  front: boolean
  pageRef: RefObject<HTMLElement | null>
  onBack: () => void
  onOpen: (key: string) => void
}) {
  const [sort, setSort] = useState(DEFAULT_EPIC_SORT)
  const rows = useMemo(() => sortEpics(epicRows(issues, progress), sort), [issues, progress, sort])
  const count = `${String(rows.length)} ${rows.length === 1 ? 'Epic' : 'Epics'}`
  return (
    <OverviewFrame
      title="Epics"
      front={front}
      pageRef={pageRef}
      onBack={onBack}
      count={count}
      doneLoading={doneLoading}
      load={load}
    >
      {rows.length === 0 ? (
        <p className="p-4 text-muted">No Epics.</p>
      ) : (
        <div onFocus={keepInView} className="min-h-0 flex-1 overflow-auto px-4 text-sm">
          <table className="w-full min-w-[56rem] border-collapse">
            <thead>
              <tr>
                {EPIC_COLUMNS.map((c) => (
                  <SortHeader
                    key={c.id}
                    column={c.id}
                    label={c.label}
                    sort={sort}
                    onSort={(column) => {
                      setSort((current) => clickSort(current, column))
                    }}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row
                  key={row.issue.key}
                  row={row}
                  today={today}
                  doneFailed={load.doneFailed}
                  onOpen={onOpen}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OverviewFrame>
  )
}
