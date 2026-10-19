import type { Issue } from '@jira-mgr/core'
import { useEffect, useRef } from 'react'

import { matchWords, type ParentMatch } from './properties'

interface ParentPromptProps {
  /** What moves: an issue key, or "this issue" for one not created yet. */
  subject: string
  /** The parent the user picked. */
  parent: Issue
  /** What the parent holds that differs from the issue. */
  match: ParentMatch
  /** Moves under the parent, also copying its Customer and Engagement when `withMatch`. */
  onChoose: (withMatch: boolean) => void
  onCancel: () => void
}

/**
 * Q16: when a new parent's Customer or Engagement differs from the issue's, asks whether to copy
 * them across before anything is sent. A modal dialog, so the question blocks the page until it
 * is answered, and Esc cancels the move.
 */
export function ParentPrompt({ subject, parent, match, onChoose, onCancel }: ParentPromptProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (element !== null && !element.open) element.showModal()
  }, [])

  const words = matchWords(match)
  const held = [
    match.customer && `Customer ${match.customer.value}`,
    match.engagement && `Engagement ${match.engagement.value}`,
  ]
    .filter(Boolean)
    .join(' and ')

  return (
    <dialog
      ref={dialog}
      aria-labelledby="parent-prompt-title"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      className="app-no-drag m-auto w-[26rem] rounded-xl border border-line bg-panel p-5 text-ink shadow-[0_16px_48px_var(--dialog-shadow)] backdrop:bg-(--scrim)"
    >
      <h2 id="parent-prompt-title" className="text-base font-semibold">
        Move {subject} under {parent.key}?
      </h2>
      <p className="mt-2">
        {parent.key} has {held}. Also set {words} to match?
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onChoose(false)
          }}
          className="btn"
        >
          Move only
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => {
            onChoose(true)
          }}
          className="btn btn-primary"
        >
          Move and set {words}
        </button>
      </div>
    </dialog>
  )
}
