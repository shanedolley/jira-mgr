import type { Issue } from '@jira-mgr/core'
import { propertyRules } from '@jira-mgr/core/issue'
import { useEffect, useState, type ReactNode, type RefObject } from 'react'

import type { CurrentUser } from '../../shared/ipc'
import { CustomerMismatch, useMatchCustomer, type Mismatch } from './CustomerMismatch'
import { blockText } from './editor/readOnly'
import { AssigneePicker, LabelsPicker, PriorityPicker, StatusPicker } from './PropertyPickers'
import { useIssueDetail, usePendingFields } from './queries'
import { Spinner } from './Spinner'
import { SummaryEditor } from './SummaryEditor'
import { pressOf } from './timer'
import { useTimer } from './timerQueries'
import { TypeIcon } from './TypeIcon'

/**
 * One property of the Peek, 32px tall. A picker brings its own padding and chevron; `readOnly`
 * gives a plain value the same padding, so both line up, and the first of them follows an 8px gap.
 */
function Property({
  name,
  readOnly = false,
  first = false,
  field,
  pending = false,
  children,
}: {
  name: string
  /** The issue field it edits, so the row can flash when Jira refuses the edit. */
  field?: string
  readOnly?: boolean
  /** An edit of it waits on Jira: the value shows dimmed with a spinner (`styles.css`). */
  pending?: boolean
  /** The first read-only row: the gap that sets it apart from the editable ones. */
  first?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-field={field}
      className={`grid h-8 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-1 ${first ? 'mt-2' : ''}`}
    >
      <dt className="truncate px-2 text-muted">{name}</dt>
      <dd
        aria-busy={pending || undefined}
        data-pending={pending || undefined}
        className={`min-w-0 truncate ${readOnly ? 'px-2' : ''}`}
      >
        {children}
        {pending && <Spinner />}
      </dd>
    </div>
  )
}

/**
 * The Peek's copy buttons are icons, so the header's five buttons fit the Peek at the narrowest
 * window (348px) in a wide font. The name and key are in `aria-label` and `title`.
 */
const COPY_BUTTON = 'btn btn-sm btn-icon app-no-drag text-muted hover:text-ink'
const COPY_ICON = {
  'aria-hidden': true,
  viewBox: '0 0 16 16',
  className: 'size-3.5',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** How long the Peek holds still on an issue before it reads the description. */
const READ_DELAY_MS = 180
/** How long a description the Peek read stays fresh, so a row visited again shows it without a read. */
const FRESH_MS = 30_000

/**
 * The first three lines of the description as plain text, with no editor. The Peek follows the
 * active row, so the read waits until the user stops on one, and a copy read lately is reused.
 * A copy the cache already holds shows at once, whatever the delay.
 */
function PeekDescription({ issueKey }: { issueKey: string }) {
  // The Peek is keyed by the issue, so this starts again, unread, on each row the user moves to.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(true)
    }, READ_DELAY_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [])
  const detail = useIssueDetail(issueKey, {
    enabled: settled,
    staleTime: FRESH_MS,
    refetchOnWindowFocus: false,
  })
  const text = detail.data?.description == null ? '' : blockText(detail.data.description)
  return (
    <section aria-label="Description" className="space-y-1">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">Description</h2>
      {detail.isError ? (
        <p className="text-muted">Could not load the description.</p>
      ) : detail.data === undefined ? (
        <p className="text-muted">Loading description</p>
      ) : text === '' ? (
        <p className="text-muted">No description</p>
      ) : (
        <p className="line-clamp-3 whitespace-pre-line break-words">{text}</p>
      )}
    </section>
  )
}

interface PeekProps {
  /** `undefined` when the issue no longer exists in the loaded data. */
  issue: Issue | undefined
  /** Every loaded issue: the assignee and label pickers draw their choices from them. */
  issues: readonly Issue[]
  me: CurrentUser | undefined
  /** Set when the issue's Customer differs from its Epic's. */
  mismatch: Mismatch | null
  /** False when a refetch or a filter removed the issue from the Tree. */
  inView: boolean
  onClose: () => void
  /** Opens the issue's full page. */
  onOpenPage: (key: string) => void
  /** Opens the delete confirmation for the issue. */
  onDelete: (issue: Issue) => void
  /** `T` or the timer button: starts the timer, or opens the stop or switch dialog. */
  onTimer: (issueKey: string) => void
  /** `Y`, `U` or a copy button: puts the issue's key or its Jira link on the clipboard. */
  onCopy: (issueKey: string, what: 'key' | 'link') => void
  onEditingChange: (editing: boolean) => void
  onLeave: () => void
  /** True while the full page covers the Peek, so nothing in it can be reached. */
  inert: boolean
  asideRef: RefObject<HTMLElement | null>
}

/** Keyed by the issue, so moving to another one drops the edit state and any error of the last. */
function PeekIssue({
  issue,
  issues,
  me,
  mismatch,
  inView,
  onTimer,
  onEditingChange,
  onLeave,
}: Pick<
  PeekProps,
  'issues' | 'me' | 'mismatch' | 'inView' | 'onTimer' | 'onEditingChange' | 'onLeave'
> & {
  issue: Issue
}) {
  const fix = useMatchCustomer(issue)
  const timer = useTimer().data?.timer ?? null
  const pending = usePendingFields(issue.key)
  return (
    <div className="space-y-5 px-5 pb-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs text-muted">
            <TypeIcon type={issue.issueType} />
            {issue.key}
            {issue.parentKey !== null && ` in ${issue.parentKey}`}
          </p>
          {propertyRules(issue.issueType).estimates && (
            <button
              type="button"
              aria-keyshortcuts="T"
              onClick={() => {
                onTimer(issue.key)
              }}
              className="btn btn-sm"
            >
              {pressOf(timer, issue.key) === 'stop' ? 'Stop timer' : 'Start timer'}
            </button>
          )}
        </div>
        {!inView && <p className="text-xs text-muted">No longer in this view</p>}
      </div>
      <SummaryEditor issue={issue} onEditingChange={onEditingChange} onLeave={onLeave} />
      <PeekDescription issueKey={issue.key} />
      <dl data-issue={issue.key}>
        <Property name="Status" field="status" pending={pending.has('status')}>
          <StatusPicker issue={issue} />
        </Property>
        <Property name="Assignee" field="assignee" pending={pending.has('assignee')}>
          <AssigneePicker issue={issue} issues={issues} me={me} />
        </Property>
        <Property name="Priority" field="priority" pending={pending.has('priority')}>
          <PriorityPicker issue={issue} />
        </Property>
        <Property name="Labels" field="labels" pending={pending.has('labels')}>
          <LabelsPicker issue={issue} issues={issues} />
        </Property>
        <Property name="Type" readOnly first>
          {issue.issueType.name}
        </Property>
        <Property name="Customer" readOnly>
          {issue.customer?.value ?? 'None'}
        </Property>
        <Property name="Engagement" readOnly>
          {issue.engagement?.value ?? 'None'}
        </Property>
        <Property name="Updated" readOnly>
          {new Date(issue.updated).toLocaleDateString()}
        </Property>
      </dl>
      {mismatch !== null && (
        <CustomerMismatch
          mismatch={mismatch}
          onMatch={() => {
            fix.match(mismatch)
          }}
        />
      )}
      {fix.error !== null && (
        <p role="alert" className="text-xs text-danger">
          {fix.error}
        </p>
      )}
    </div>
  )
}

/**
 * The space-bar preview: summary, key, a 3-line read-only description, status, type, people,
 * Customer and Engagement. The summary edits in place, Start timer follows the `T` rule (never on
 * an Epic), a mismatch offers its one-click fix, and Open goes to the full page. Status,
 * Assignee, Priority and Labels are the page's own pickers, so the Tree's `S`, `A`, `P` and `L`
 * open them here (D7) without leaving the list.
 */
export function IssueDetail({
  issue,
  issues,
  me,
  mismatch,
  inView,
  onClose,
  onOpenPage,
  onDelete,
  onTimer,
  onCopy,
  onEditingChange,
  onLeave,
  inert,
  asideRef,
}: PeekProps) {
  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      data-key-scope
      inert={inert}
      aria-label="Peek"
      className="col-start-3 row-start-1 min-h-0 overflow-y-auto border-l border-line bg-panel"
    >
      <div className="app-drag flex h-10 shrink-0 items-center justify-end gap-2 px-3">
        {issue !== undefined && (
          <>
            <button
              type="button"
              onClick={() => {
                onOpenPage(issue.key)
              }}
              className="btn btn-sm app-no-drag"
            >
              Open
            </button>
            <button
              type="button"
              aria-label="Copy key"
              title="Copy key (Y)"
              aria-keyshortcuts="Y"
              onClick={() => {
                onCopy(issue.key, 'key')
              }}
              className={COPY_BUTTON}
            >
              <svg {...COPY_ICON}>
                <circle cx="5.5" cy="10.5" r="2.5" />
                <path d="m7.4 8.6 6.1-6.1M11.5 4.5l1.5 1.5M9.5 6.5 11 8" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Copy link"
              title="Copy link (U)"
              aria-keyshortcuts="U"
              onClick={() => {
                onCopy(issue.key, 'link')
              }}
              className={COPY_BUTTON}
            >
              <svg {...COPY_ICON}>
                <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5l-.7.7M9.5 6.5a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5l.7-.7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                onDelete(issue)
              }}
              className="btn btn-sm btn-delete app-no-drag"
            >
              Delete
            </button>
          </>
        )}
        <button type="button" onClick={onClose} className="btn btn-sm app-no-drag">
          Close
        </button>
      </div>
      {issue === undefined ? (
        <p className="px-5 pb-6 text-muted">This issue is no longer available.</p>
      ) : (
        <PeekIssue
          key={issue.key}
          issue={issue}
          issues={issues}
          me={me}
          mismatch={mismatch}
          inView={inView}
          onTimer={onTimer}
          onEditingChange={onEditingChange}
          onLeave={onLeave}
        />
      )}
    </aside>
  )
}
