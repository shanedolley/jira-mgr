import { useEffect, type KeyboardEvent } from 'react'

interface DiscardDialogProps {
  title: string
  keepLabel: string
  discardLabel: string
  onKeep: () => void
  onDiscard: () => void
}

/**
 * An in-page confirmation, not a native `confirm()`, so it never blocks the renderer and a test
 * can reach it by role. Keep is focused first and Esc keeps, without also cancelling the edit
 * behind it. Focus goes back to where it was when the dialog closes.
 */
export function DiscardDialog({
  title,
  keepLabel,
  discardLabel,
  onKeep,
  onDiscard,
}: DiscardDialogProps) {
  useEffect(() => {
    const opener = document.activeElement
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onKeep()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-(--scrim)">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="discard-title"
        onKeyDown={onKeyDown}
        className="w-[min(26rem,calc(100vw-2rem))] space-y-4 rounded-xl border border-line bg-panel p-4 shadow-[0_16px_48px_var(--dialog-shadow)]"
      >
        <p id="discard-title" className="font-medium">
          {title}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus onClick={onKeep} className="btn btn-primary">
            {keepLabel}
          </button>
          <button type="button" onClick={onDiscard} className="btn btn-delete">
            {discardLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
