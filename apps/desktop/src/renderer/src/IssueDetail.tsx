import type { Issue } from '@jira-mgr/core'
import type { CustomerOption } from '@jira-mgr/core/hierarchy'
import { useState, type ReactNode, type RefObject, type SyntheticEvent } from 'react'

import { StatusDot } from './StatusDot'
import { useSetSummary } from './queries'

function Property({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-2 py-1">
      <dt className="text-muted">{name}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  )
}

interface SummaryEditorProps {
  issue: Issue
  onEditingChange: (editing: boolean) => void
  /** The edit ended with Esc: the Shell puts focus back on the Tree. */
  onLeave: () => void
}

function SummaryEditor({ issue, onEditingChange, onLeave }: SummaryEditorProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(issue.summary)
  const save = useSetSummary()

  function finish() {
    setEditing(false)
    onEditingChange(false)
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault()
    const summary = draft.trim()
    finish()
    if (summary !== '' && summary !== issue.summary) save.mutate({ key: issue.key, summary })
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="space-y-2">
        <label className="block">
          <span className="sr-only">Summary</span>
          <input
            autoFocus
            value={draft}
            maxLength={255}
            onChange={(event) => {
              setDraft(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              finish()
              onLeave()
            }}
            className="w-full rounded-md border border-line bg-panel px-2 py-1.5 text-base font-semibold"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1 font-medium text-accent-ink"
          >
            Save
          </button>
          <button
            type="button"
            onClick={finish}
            className="rounded-md border border-line px-3 py-1 hover:bg-hover"
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold leading-snug">{issue.summary}</h2>
      <button
        type="button"
        onClick={() => {
          setDraft(issue.summary)
          save.reset()
          setEditing(true)
          onEditingChange(true)
        }}
        className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
      >
        Edit summary
      </button>
      {save.isError && (
        <p role="alert" className="text-danger">
          Could not save the summary, so {issue.key} shows its old one again. {save.error.message}
        </p>
      )}
    </div>
  )
}

interface PeekProps {
  /** `undefined` when the issue no longer exists in the loaded data. */
  issue: Issue | undefined
  /** Set when the issue's Customer differs from its Epic's. */
  mismatch: { own: CustomerOption | null; epic: CustomerOption | null } | null
  /** False when a refetch or a filter removed the issue from the Tree. */
  inView: boolean
  onClose: () => void
  onEditingChange: (editing: boolean) => void
  onLeave: () => void
  asideRef: RefObject<HTMLElement | null>
}

/** The space-bar preview: summary, key, status, type, people, Customer and Engagement. The summary edits in place. */
export function IssueDetail({
  issue,
  mismatch,
  inView,
  onClose,
  onEditingChange,
  onLeave,
  asideRef,
}: PeekProps) {
  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      aria-label="Peek"
      className="min-h-0 overflow-y-auto border-l border-line bg-panel focus-visible:outline-none"
    >
      <div className="app-drag flex h-10 shrink-0 items-center justify-end px-3">
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
        <div className="space-y-5 px-5 pb-6">
          <div className="space-y-1">
            <p className="font-mono text-xs text-muted">
              {issue.key}
              {issue.parentKey !== null && ` in ${issue.parentKey}`}
            </p>
            {!inView && <p className="text-xs text-muted">No longer in this view</p>}
          </div>
          {/* Remounting on the key drops the edit state and any error of the previous issue. */}
          <SummaryEditor
            key={issue.key}
            issue={issue}
            onEditingChange={onEditingChange}
            onLeave={onLeave}
          />
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
            <p className="rounded-md border border-line px-3 py-2 text-xs">
              Customer differs from the Epic. Customer: {mismatch.own?.value ?? 'none'}. Epic&apos;s
              Customer: {mismatch.epic?.value ?? 'none'}.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
