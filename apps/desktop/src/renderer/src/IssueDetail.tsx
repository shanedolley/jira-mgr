import type { Issue } from '@jira-mgr/core'
import type { ReactNode, RefObject } from 'react'

import { CustomerMismatch, useMatchCustomer, type Mismatch } from './CustomerMismatch'
import { StatusDot } from './StatusDot'
import { SummaryEditor } from './SummaryEditor'

function Property({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-2 py-1">
      <dt className="text-muted">{name}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  )
}

interface PeekProps {
  /** `undefined` when the issue no longer exists in the loaded data. */
  issue: Issue | undefined
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
  mismatch,
  inView,
  onEditingChange,
  onLeave,
}: Pick<PeekProps, 'mismatch' | 'inView' | 'onEditingChange' | 'onLeave'> & { issue: Issue }) {
  const fix = useMatchCustomer(issue)
  return (
    <div className="space-y-5 px-5 pb-6">
      <div className="space-y-1">
        <p className="font-mono text-xs text-muted">
          {issue.key}
          {issue.parentKey !== null && ` in ${issue.parentKey}`}
        </p>
        {!inView && <p className="text-xs text-muted">No longer in this view</p>}
      </div>
      <SummaryEditor issue={issue} onEditingChange={onEditingChange} onLeave={onLeave} />
      <dl>
        <Property name="Status">
          <span className="inline-flex items-center gap-2">
            <StatusDot status={issue.status} />
            {issue.status.name}
          </span>
        </Property>
        <Property name="Type">{issue.issueType.name}</Property>
        <Property name="Assignee">{issue.assignee?.displayName ?? 'Unassigned'}</Property>
        <Property name="Customer">{issue.customer?.value ?? 'None'}</Property>
        <Property name="Engagement">{issue.engagement?.value ?? 'None'}</Property>
        <Property name="Updated">{new Date(issue.updated).toLocaleDateString()}</Property>
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
 * The space-bar preview: summary, key, status, type, people, Customer and Engagement. The summary
 * edits in place, a mismatch offers its one-click fix, and Open goes to the full page.
 */
export function IssueDetail({
  issue,
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
          mismatch={mismatch}
          inView={inView}
          onEditingChange={onEditingChange}
          onLeave={onLeave}
        />
      )}
    </aside>
  )
}
