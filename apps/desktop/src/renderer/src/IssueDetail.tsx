import type { Issue } from '@jira-mgr/core'
import { useState, type SyntheticEvent, type ReactNode } from 'react'

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

function SummaryEditor({ issue }: { issue: Issue }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(issue.summary)
  const save = useSetSummary()

  function submit(event: SyntheticEvent) {
    event.preventDefault()
    const summary = draft.trim()
    setEditing(false)
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
              if (event.key === 'Escape') setEditing(false)
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
            onClick={() => {
              setEditing(false)
            }}
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

/** Summary, key, status, type and assignee of the selected issue. The summary edits in place. */
export function IssueDetail({ issue }: { issue: Issue | undefined }) {
  if (issue === undefined) {
    return (
      <aside
        aria-label="Issue detail"
        className="grid place-items-center border-l border-line bg-panel p-6 text-muted"
      >
        <p>Select an issue to see it here.</p>
      </aside>
    )
  }
  return (
    <aside
      aria-label="Issue detail"
      className="min-h-0 overflow-y-auto border-l border-line bg-panel"
    >
      <div className="app-drag h-10 shrink-0" />
      <div className="space-y-5 px-5 pb-6">
        <p className="font-mono text-xs text-muted">{issue.key}</p>
        {/* Remounting on the key drops the edit state and any error of the previous issue. */}
        <SummaryEditor key={issue.key} issue={issue} />
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
          <Property name="Updated">{new Date(issue.updated).toLocaleDateString()}</Property>
        </dl>
      </div>
    </aside>
  )
}
