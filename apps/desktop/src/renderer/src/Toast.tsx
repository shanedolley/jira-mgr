import { useEffect } from 'react'

import type { Notice } from './create'

/** A plain notice stays this long. One that reports a failure stays until dismissed. */
const LINGER_MS = 10_000

interface ToastProps {
  notice: Notice
  /** Opens the issue the notice is about. */
  onOpen?: () => void
  onDismiss: () => void
}

/**
 * A notice in the corner: what just happened and anything Jira did differently. A failure is an
 * alert and stays; the rest is a status and goes after a while.
 */
export function Toast({ notice, onOpen, onDismiss }: ToastProps) {
  useEffect(() => {
    if (notice.warned) return
    const timer = setTimeout(onDismiss, LINGER_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [notice, onDismiss])

  return (
    <div
      role={notice.warned ? 'alert' : 'status'}
      className="fixed bottom-4 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 space-y-1 rounded-lg border border-line bg-panel p-3 shadow-[0_8px_24px_oklch(0_0_0/0.18)]"
    >
      <p className={`font-medium ${notice.warned ? 'text-danger' : ''}`}>{notice.title}</p>
      {notice.notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted">
          {notice.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onOpen !== undefined && (
          <button
            type="button"
            onClick={onOpen}
            className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
          >
            Open
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
