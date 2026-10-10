import type { Issue } from '@jira-mgr/core'
import { propertyRules } from '@jira-mgr/core/issue'
import { useState, type ReactNode, type RefObject } from 'react'

import type { CurrentUser } from '../../shared/ipc'
import { CustomerMismatch, useMatchCustomer, type Mismatch } from './CustomerMismatch'
import { blockText } from './editor/readOnly'
import { AssigneePicker, LabelsPicker, PriorityPicker, StatusPicker } from './PropertyPickers'
import { useIssueDetail } from './queries'
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
  children,
}: {
  name: string
  readOnly?: boolean
  /** The first read-only row: the gap that sets it apart from the editable ones. */
  first?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`grid h-8 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-1 ${first ? 'mt-2' : ''}`}
    >
      <dt className="truncate px-2 text-muted">{name}</dt>
      <dd className={`min-w-0 truncate ${readOnly ? 'px-2' : ''}`}>{children}</dd>
    </div>
  )
}

/** The first three lines of the description as plain text, with no editor. */
function PeekDescription({ issueKey }: { issueKey: string }) {
  const detail = useIssueDetail(issueKey)
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
  const [error, setError] = useState<string | null>(null)
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
              className="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
            >
              {pressOf(timer, issue.key) === 'stop' ? 'Stop timer' : 'Start timer'}
            </button>
          )}
        </div>
        {!inView && <p className="text-xs text-muted">No longer in this view</p>}
      </div>
      <SummaryEditor issue={issue} onEditingChange={onEditingChange} onLeave={onLeave} />
      <PeekDescription issueKey={issue.key} />
      <dl>
        <Property name="Status">
          <StatusPicker issue={issue} report={setError} />
        </Property>
        <Property name="Assignee">
          <AssigneePicker issue={issue} issues={issues} me={me} report={setError} />
        </Property>
        <Property name="Priority">
          <PriorityPicker issue={issue} report={setError} />
        </Property>
        <Property name="Labels">
          <LabelsPicker issue={issue} issues={issues} report={setError} />
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
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
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
  onEditingChange,
  onLeave,
  inert,
  asideRef,
}: PeekProps) {
  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
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
              className="app-no-drag rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => {
                onDelete(issue)
              }}
              className="app-no-drag rounded-md border border-line px-2 py-0.5 text-xs text-danger hover:bg-hover"
            >
              Delete
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          className="app-no-drag rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
        >
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
