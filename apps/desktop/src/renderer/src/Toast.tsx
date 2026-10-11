import { useEffect, useEffectEvent, useRef, useState, type FocusEvent } from 'react'

import type { Notice } from './create'

/** A plain notice stays this long. One that reports a failure stays until dismissed. */
const LINGER_MS = 10_000
/** After the pointer or focus leaves, a notice that was held stays this much longer. */
const RESTART_MS = 5_000

interface ToastProps {
  notice: Notice
  /** Opens the issue the notice is about. */
  onOpen?: () => void
  /** Undoes the edit the notice reports. */
  onUndo?: () => void
  /** Sends the failed edit again. */
  onRetry?: () => void
  /** The notice's time ran out. Focus stays where the user has it. */
  onDismiss: () => void
  /** The Dismiss button was clicked, so focus has nowhere to go but the body. */
  onDismissClick: () => void
}

const ACTION = 'btn btn-sm btn-ghost text-accent'

function Icon({ warned }: { warned: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`mt-0.5 size-4 shrink-0 ${warned ? 'text-danger' : 'text-muted'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {warned ? (
        <path d="M8 2 1.5 13.5h13L8 2ZM8 6.5v3.2M8 11.6v.1" />
      ) : (
        <path d="m3.5 8.5 3 3 6-7" />
      )}
    </svg>
  )
}

/**
 * One notice for the corner stack: what just happened and anything Jira did differently, with
 * Undo after a field edit and Retry after a refusal. A failure is an alert and stays; the rest
 * goes after a while, and the time stops while the pointer rests on the notice or focus is in it.
 */
export function Toast({ notice, onOpen, onUndo, onRetry, onDismiss, onDismissClick }: ToastProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const delay = useRef(LINGER_MS)
  const held = hovered || focused
  const expire = useEffectEvent(onDismiss)

  useEffect(() => {
    if (held) {
      delay.current = RESTART_MS
      return
    }
    if (notice.warned) return
    const timer = setTimeout(() => {
      expire()
    }, delay.current)
    return () => {
      clearTimeout(timer)
    }
  }, [held, notice.warned])

  return (
    <li>
      <div
        role={notice.warned ? 'alert' : undefined}
        onMouseEnter={() => {
          setHovered(true)
        }}
        onMouseLeave={() => {
          setHovered(false)
        }}
        onFocus={() => {
          setFocused(true)
        }}
        onBlur={(event: FocusEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
        className="flex w-fit max-w-full items-start gap-2 rounded-lg border border-line bg-panel py-1.5 pl-3 pr-1.5 shadow-[0_8px_24px_oklch(0_0_0/0.18)]"
      >
        <Icon warned={notice.warned} />
        <div className="min-w-0 flex-1 py-0.5">
          <p className="break-words">{notice.title}</p>
          {notice.notes.map((note) => (
            <p key={note} className="break-words text-xs text-muted">
              {note}
            </p>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {onUndo !== undefined && (
            <button type="button" onClick={onUndo} className={ACTION}>
              Undo
            </button>
          )}
          {onRetry !== undefined && (
            <button type="button" onClick={onRetry} className={ACTION}>
              Retry
            </button>
          )}
          {onOpen !== undefined && (
            <button type="button" onClick={onOpen} className={ACTION}>
              Open
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismissClick}
            className="btn btn-sm btn-icon btn-ghost"
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
    </li>
  )
}
