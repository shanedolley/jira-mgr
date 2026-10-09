import type { Issue } from '@jira-mgr/core'
import { useState, type SyntheticEvent } from 'react'

import { useSetSummary } from './queries'

export interface SummaryEditorProps {
  issue: Issue
  onEditingChange: (editing: boolean) => void
  /** The edit ended with Esc: the Shell puts focus back on the Tree. */
  onLeave: () => void
}

/** The summary as a heading with an Edit button; editing swaps it for a field that saves on Enter. */
export function SummaryEditor({ issue, onEditingChange, onLeave }: SummaryEditorProps) {
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
