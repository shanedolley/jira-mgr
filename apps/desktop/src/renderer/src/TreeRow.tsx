import { memo } from 'react'

import { StatusDot } from './StatusDot'
import { ROW_HEIGHT, type TreeRow as Row } from './tree'

/** The DOM id of a row, which the Tree's `aria-activedescendant` points at. */
export const rowDomId = (id: string) => `tree-row-${id}`

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`

/** The accessible name of a row, in one format per kind. Its contents are presentation only. */
export function rowName(row: Row): string {
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

function mismatchTitle(mismatch: {
  own: { value: string } | null
  epic: { value: string } | null
}) {
  return `Customer: ${mismatch.own?.value ?? 'none'}. Epic's Customer: ${mismatch.epic?.value ?? 'none'}.`
}

function Content({ row }: { row: Row }) {
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
        </>
      )
    case 'noEpic':
      return (
        <>
          <span className="min-w-0 truncate font-medium text-muted">No Epic</span>
          <span className="ml-auto shrink-0 text-xs text-muted">{plural(row.count, 'issue')}</span>
        </>
      )
    case 'chip':
      return (
        <span className="rounded-full border border-line px-2 text-xs text-muted">
          {row.expanded ? `Hide ${String(row.doneCount)} done` : `${String(row.doneCount)} done`}
        </span>
      )
    case 'issue': {
      const { issue, contextOnly, customerMismatch } = row.node
      const isEpic = issue.issueType.hierarchyLevel >= 1
      // Context rows read as muted text, which keeps AA contrast, rather than as faded ink.
      const tone = contextOnly ? 'text-muted' : ''
      return (
        <>
          <StatusDot status={issue.status} />
          <span className="w-20 shrink-0 font-mono text-xs text-muted">{issue.key}</span>
          <span className={`min-w-0 flex-1 truncate ${tone} ${isEpic ? 'font-medium' : ''}`}>
            {issue.summary}
          </span>
          {customerMismatch !== null && (
            <span
              title={mismatchTitle(customerMismatch)}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-1.5 text-[11px] leading-4"
            >
              <span aria-hidden className="size-1.5 rounded-full bg-status-doing" />
              Customer
            </span>
          )}
          {isEpic && <span className="shrink-0 text-xs text-muted">{row.count}</span>}
          <span className="hidden w-14 shrink-0 truncate text-right text-xs text-muted @md:block">
            {issue.issueType.name}
          </span>
          <span
            aria-hidden
            className="grid size-5 shrink-0 place-items-center rounded-full border border-line text-[10px] text-muted"
          >
            {issue.assignee === null ? '' : initials(issue.assignee.displayName)}
          </span>
        </>
      )
    }
  }
}

interface TreeRowProps {
  row: Row
  index: number
  active: boolean
  /** The row whose issue the Peek shows. */
  selected: boolean
  onClick: (id: string, onChevron: boolean) => void
}

/** One row of any kind, positioned by the window. The Tree owns every key, so a row holds no button. */
export const TreeRow = memo(function TreeRow({
  row,
  index,
  active,
  selected,
  onClick,
}: TreeRowProps) {
  return (
    <div
      id={rowDomId(row.id)}
      role="treeitem"
      aria-label={rowName(row)}
      aria-level={row.level}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-selected={selected ? true : undefined}
      data-active={active}
      onClick={(event) => {
        onClick(row.id, (event.target as Element).closest('[data-chevron]') !== null)
      }}
      style={{
        top: index * ROW_HEIGHT,
        height: ROW_HEIGHT,
        paddingLeft: 12 + (row.level - 1) * 16,
      }}
      className={`absolute inset-x-0 flex cursor-default items-center gap-2 pr-4 hover:bg-hover ${row.kind === 'customer' ? 'bg-sidebar' : ''} aria-selected:bg-selected data-[active=true]:bg-hover group-focus:data-[active=true]:shadow-[inset_0_0_0_2px_var(--accent)]`}
    >
      <Chevron row={row} />
      <Content row={row} />
    </div>
  )
})
