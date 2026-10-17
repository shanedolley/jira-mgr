import type { Issue } from '@jira-mgr/core'
import { formatEstimate } from '@jira-mgr/core/issue'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

import { commitDraft, ESTIMATE_HINT } from './estimate'
import { useAttempt } from './PropertyPickers'
import { useEditIssue } from './queries'

const NAME = 'Original estimate'

/** The element focus returns to once the field closes on a key: the Tree, or the Sprint page's row. */
const HOME = '[role="tree"], button'

/** An estimate sent and not yet shown by the issue, and the estimate the issue showed when it was sent. */
interface Sent {
  seconds: number
  from: number | null
}

/**
 * The original estimate slot of an issue row, editable in place (#276). A click, `Shift+E` from the
 * Tree (the Shell clicks `[data-edit]`) or Enter on the Sprint page's focusable slot turns it into
 * a text field with its text selected. Enter saves and Escape cancels, each handing focus back to
 * the Tree. Leaving the field saves a valid draft and drops an invalid one. A refused draft stays
 * open under a hint. The save is the issue page's: an optimistic `originalEstimateSeconds`, a
 * re-read of the issue so Remaining and Remaining % follow, and a Retry toast on refusal.
 *
 * The Sprint page lists a report, not the Tree's caches, so the slot holds the sent estimate
 * itself until the issue shows another value, which is the re-read arriving or the edit rolling back.
 */
export function EstimateCell({ issue, always }: { issue: Issue; always: boolean }) {
  const edit = useEditIssue()
  const attempt = useAttempt(issue.key)
  const [sent, setSent] = useState<Sent | null>(null)
  if (sent !== null && issue.originalEstimateSeconds !== sent.from) setSent(null)
  const seconds = sent?.seconds ?? issue.originalEstimateSeconds
  const value = seconds === null ? null : formatEstimate(seconds)

  /** The draft while the field is open, `null` while it is closed. */
  const [draft, setDraft] = useState<string | null>(null)
  const [hint, setHint] = useState<CSSProperties | null>(null)
  const field = useRef<HTMLInputElement>(null)
  /** Set when the field has closed, so the blur that closing causes does not save again. */
  const closed = useRef(true)

  const editing = draft !== null
  useEffect(() => {
    if (!editing) return
    closed.current = false
    field.current?.focus()
    field.current?.select()
  }, [editing])

  function open() {
    setDraft(value ?? '')
    setHint(null)
  }

  function close(refocus: boolean) {
    closed.current = true
    const home = field.current?.closest<HTMLElement>(HOME)
    setDraft(null)
    setHint(null)
    if (refocus) home?.focus()
  }

  /** Saves a valid draft and closes. A draft that is not valid stays open when `keep` and is dropped otherwise. */
  function leave(keep: boolean, refocus: boolean) {
    const result = commitDraft(draft ?? '', issue.originalEstimateSeconds)
    if (result.kind === 'invalid' && keep) {
      const box = field.current?.getBoundingClientRect()
      if (box !== undefined) {
        setHint({ top: box.bottom + 4, right: window.innerWidth - box.right })
      }
      return
    }
    if (result.kind === 'save') {
      const { text, seconds: next } = result
      const from = issue.originalEstimateSeconds
      const patch = { originalEstimateSeconds: next }
      attempt(NAME, patch, async () => {
        setSent({ seconds: next, from })
        try {
          await edit.mutateAsync({ key: issue.key, changes: { originalEstimate: text }, patch })
        } catch (error) {
          setSent(null)
          throw error
        }
      })
    }
    close(refocus)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // The Tree and the Shell leave an input its keys: this one has only Enter and Escape of its own.
    if (event.key === 'Enter') {
      event.preventDefault()
      leave(true, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    }
  }

  if (draft === null) {
    return (
      <span
        data-prop="estimate"
        data-edit="estimate"
        title={value === null ? `Set ${NAME.toLowerCase()}` : `${NAME} ${value}`}
        // The Sprint page's rows are buttons, which also take Enter and Space. This slot takes them first.
        role={always ? 'button' : undefined}
        tabIndex={always ? 0 : undefined}
        onClick={(event) => {
          if (always) event.stopPropagation()
          open()
        }}
        onKeyDown={(event) => {
          if (!always || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          event.stopPropagation()
          open()
        }}
        onKeyUp={(event) => {
          if (event.key === ' ') event.preventDefault()
        }}
        className="min-h-5 w-16 shrink-0 cursor-text whitespace-nowrap rounded text-right text-xs tabular-nums text-muted hover:bg-line"
      >
        {value !== null && <span className="sr-only">{NAME} </span>}
        {value}
      </span>
    )
  }

  return (
    <span
      data-prop="estimate"
      className="relative inline-block min-h-5 w-16 shrink-0 text-right text-xs tabular-nums"
      // The field's clicks and keys are its own, whichever row or button holds it.
      onClick={(event) => {
        if (always) event.stopPropagation()
      }}
    >
      <input
        ref={field}
        type="text"
        draggable={false}
        aria-label={NAME}
        aria-keyshortcuts="Shift+E"
        aria-invalid={hint !== null || undefined}
        aria-describedby={hint === null ? undefined : `estimate-hint-${issue.key}`}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setHint(null)
        }}
        onBlur={() => {
          if (!closed.current) leave(false, false)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          // A space typed here must not press the Sprint row's button, which keyup would.
          if (event.key === ' ') event.preventDefault()
        }}
        className="h-5 w-full min-w-0 rounded border border-field-border bg-canvas px-1 text-right text-ink aria-invalid:border-danger"
      />
      {hint !== null && (
        <span
          id={`estimate-hint-${issue.key}`}
          role="alert"
          style={hint}
          className="fixed z-50 whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-xs text-danger shadow-lg"
        >
          {ESTIMATE_HINT}
        </span>
      )}
    </span>
  )
}
