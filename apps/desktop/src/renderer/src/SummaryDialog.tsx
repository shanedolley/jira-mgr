import type { Issue } from '@jira-mgr/core'
import { useEffect, useRef, useState, type SyntheticEvent } from 'react'

import { Modal } from './Modal'
import { submitOnModEnter } from './modEnter'
import { useAttempt } from './PropertyPickers'
import { useSetSummary } from './queries'
import { FIELD } from './Section'
import { readSummaryDraft } from './summaryEdit'

interface SummaryDialogProps {
  issue: Issue
  onClose: () => void
  returnFocus: () => void
}

/**
 * The summary of one issue in a modal: a single field, selected on open. Enter or Save writes it
 * through the same mutation the page and the context menu use, so the row shows it at once, an
 * undo entry is kept and a refusal reverts with a Retry toast. An empty summary is refused in the
 * dialog; Esc, Cancel and a click outside close it with no write.
 */
export function SummaryDialog({ issue, onClose, returnFocus }: SummaryDialogProps) {
  const [draft, setDraft] = useState(issue.summary)
  const [refused, setRefused] = useState(false)
  const attempt = useAttempt(issue.key)
  const save = useSetSummary()
  const form = useRef<HTMLFormElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  // A click on the backdrop lands on the dialog itself. One that began inside, such as a drag that
  // selects text and ends outside, is not a click outside.
  useEffect(() => {
    const dialog = form.current?.closest('dialog')
    if (dialog === null || dialog === undefined) return
    let pressed = false
    const down = (event: MouseEvent) => {
      pressed = event.target === dialog
    }
    const click = (event: MouseEvent) => {
      if (pressed && event.target === dialog) close.current()
    }
    dialog.addEventListener('mousedown', down)
    dialog.addEventListener('click', click)
    return () => {
      dialog.removeEventListener('mousedown', down)
      dialog.removeEventListener('click', click)
    }
  }, [])

  function submit(event: SyntheticEvent) {
    event.preventDefault()
    const read = readSummaryDraft(draft, issue.summary)
    if (read.kind === 'empty') {
      setRefused(true)
      return
    }
    if (read.kind === 'save') {
      const { summary } = read
      attempt('Summary', { summary }, () => save.mutateAsync({ key: issue.key, summary }))
    }
    onClose()
  }

  return (
    <Modal titleId="summary-title" onClose={onClose} returnFocus={returnFocus}>
      <form
        ref={form}
        aria-label="Edit summary"
        onSubmit={submit}
        onKeyDown={submitOnModEnter}
        className="space-y-3 p-5"
      >
        <h2 id="summary-title" className="text-base font-semibold">
          Edit summary
        </h2>
        <label className="block space-y-0.5">
          <span className="block text-xs text-muted">Summary of {issue.key}</span>
          <input
            value={draft}
            maxLength={255}
            aria-invalid={refused || undefined}
            aria-describedby={refused ? 'summary-error' : undefined}
            onFocus={(event) => {
              event.currentTarget.select()
            }}
            onChange={(event) => {
              setDraft(event.target.value)
              setRefused(false)
            }}
            className={`${FIELD} w-full`}
          />
        </label>
        {refused && (
          <p id="summary-error" role="alert" className="text-danger">
            A summary cannot be empty.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}
