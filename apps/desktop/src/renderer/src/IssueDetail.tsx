import type { Issue } from '@jira-mgr/core'
import { useState, type ReactNode, type RefObject } from 'react'

import type { CurrentUser } from '../../shared/ipc'
import { CustomerMismatch, useMatchCustomer, type Mismatch } from './CustomerMismatch'
import { AssigneePicker, LabelsPicker, PriorityPicker, StatusPicker } from './PropertyPickers'
import { SummaryEditor } from './SummaryEditor'
import { TypeIcon } from './TypeIcon'

/** `control` pulls a picker's button left by its own padding, so its text lines up with the plain values. */
function Property({
  name,
  control = false,
  children,
}: {
  name: string
  control?: boolean
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-2 py-1">
      <dt className="text-muted">{name}</dt>
      <dd className={`min-w-0 truncate ${control ? '-ml-2' : ''}`}>{children}</dd>
    </div>
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
  onEditingChange,
  onLeave,
}: Pick<PeekProps, 'issues' | 'me' | 'mismatch' | 'inView' | 'onEditingChange' | 'onLeave'> & {
  issue: Issue
}) {
  const fix = useMatchCustomer(issue)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="space-y-5 px-5 pb-6">
      <div className="space-y-1">
        <p className="flex items-center gap-2 font-mono text-xs text-muted">
          <TypeIcon type={issue.issueType} />
          {issue.key}
          {issue.parentKey !== null && ` in ${issue.parentKey}`}
        </p>
        {!inView && <p className="text-xs text-muted">No longer in this view</p>}
      </div>
      <SummaryEditor issue={issue} onEditingChange={onEditingChange} onLeave={onLeave} />
      <dl>
        <Property name="Status" control>
          <StatusPicker issue={issue} report={setError} />
        </Property>
        <Property name="Type">{issue.issueType.name}</Property>
        <Property name="Assignee" control>
          <AssigneePicker issue={issue} issues={issues} me={me} report={setError} />
        </Property>
        <Property name="Priority" control>
          <PriorityPicker issue={issue} report={setError} />
        </Property>
        <Property name="Labels" control>
          <LabelsPicker issue={issue} issues={issues} report={setError} />
        </Property>
        <Property name="Customer">{issue.customer?.value ?? 'None'}</Property>
        <Property name="Engagement">{issue.engagement?.value ?? 'None'}</Property>
        <Property name="Updated">{new Date(issue.updated).toLocaleDateString()}</Property>
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
 * The space-bar preview: summary, key, status, type, people, Customer and Engagement. The summary
 * edits in place, a mismatch offers its one-click fix, and Open goes to the full page. Status,
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
          onEditingChange={onEditingChange}
          onLeave={onLeave}
        />
      )}
    </aside>
  )
}
