import type { Issue } from '@jira-mgr/core'
import { useRef, useState, type MouseEvent } from 'react'

import { useSetSummary } from './queries'

export interface SummaryEditorProps {
  issue: Issue
  onEditingChange: (editing: boolean) => void
  /** The edit ended, so the editor's controls are gone: the caller puts focus somewhere that still works. */
  onLeave: () => void
  /** The issue page's title scale, 24/600/32, where the Peek keeps 16/600. */
  page?: boolean
}

/**
 * What a key does in the summary field. Enter or Esc pressed while an IME composes belongs to the
 * IME, which Chromium reports as `isComposing` (the `keyCode` 229 check is Safari's and is
 * deprecated).
 */
export function summaryKeyAction(event: {
  key: string
  isComposing: boolean
}): 'save' | 'cancel' | null {
  if (event.isComposing) return null
  if (event.key === 'Enter') return 'save'
  return event.key === 'Escape' ? 'cancel' : null
}

/** The summary as a heading whose text is a button; a click, or `E`, swaps it for a field in place. */
export function SummaryEditor({ issue, onEditingChange, onLeave, page }: SummaryEditorProps) {
  const scale = page === true ? 'text-2xl leading-8 tracking-[-0.16px]' : 'text-base leading-snug'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(issue.summary)
  const [refused, setRefused] = useState(false)
  // Where the caret lands when the field mounts: the clicked character, else the end.
  const caret = useRef<number | null>(null)
  // Enter, Esc and the blur that ends the field all arrive for one edit; only the first counts.
  const ended = useRef(false)
  const save = useSetSummary()

  /** `leave` puts focus back on the page; a blur skips it, since focus has already gone where the user sent it. */
  function end(commit: boolean, leave: boolean) {
    if (ended.current) return
    ended.current = true
    const summary = draft.trim()
    setEditing(false)
    onEditingChange(false)
    if (leave) onLeave()
    if (!commit) return
    if (summary === '') setRefused(true)
    else if (summary !== issue.summary) save.mutate({ key: issue.key, summary })
  }

  function start(event: MouseEvent) {
    // A click carries a point (a keyboard activation has none), so the caret goes where it hit.
    caret.current =
      event.detail > 0
        ? (document.caretPositionFromPoint(event.clientX, event.clientY)?.offset ?? null)
        : null
    ended.current = false
    setDraft(issue.summary)
    setRefused(false)
    save.reset()
    setEditing(true)
    onEditingChange(true)
  }

  if (editing) {
    return (
      <input
        aria-label="Summary"
        autoFocus
        onFocus={(event) => {
          const input = event.currentTarget
          const at = Math.min(caret.current ?? input.value.length, input.value.length)
          input.setSelectionRange(at, at)
        }}
        value={draft}
        maxLength={255}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onKeyDown={(event) => {
          const action = summaryKeyAction({
            key: event.key,
            isComposing: event.nativeEvent.isComposing,
          })
          if (action !== null) end(action === 'save', true)
        }}
        onBlur={() => {
          end(true, false)
        }}
        className={`-mx-2 w-[calc(100%+1rem)] rounded-md border border-field-border bg-panel px-2 py-0.5 font-semibold ${scale}`}
      />
    )
  }
  return (
    <div className="space-y-2">
      <h2 className={`font-semibold ${scale}`}>
        <button
          type="button"
          aria-keyshortcuts="E"
          aria-description="Edit summary"
          title="Edit summary (E)"
          onClick={start}
          className="-mx-2 w-[calc(100%+1rem)] cursor-text rounded-md border border-transparent px-2 py-0.5 text-left hover:bg-hover"
        >
          {issue.summary}
        </button>
      </h2>
      {refused && (
        <p role="alert" className="text-danger">
          A summary cannot be empty, so {issue.key} keeps its old one.
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-danger">
          Could not save the summary, so {issue.key} shows its old one again. {save.error.message}
        </p>
      )}
    </div>
  )
}
