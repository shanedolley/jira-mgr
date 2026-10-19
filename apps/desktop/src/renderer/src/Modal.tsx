import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  /** Names the dialog for a screen reader. */
  titleId: string
  /** Esc asks for this. A modal that must not close yet passes `closable={false}`. */
  onClose: () => void
  closable?: boolean
  /** Where focus goes when the control that opened the modal is gone, such as a deleted row's button. */
  returnFocus: () => void
  className?: string
  children: ReactNode
}

/**
 * A native modal `<dialog>`: the rest of the page goes inert and Tab stays inside, Esc asks to
 * close, and focus goes back to the control that opened it, or to `returnFocus` when that control
 * has left the page. The content is mounted only while the modal is open.
 */
export function Modal({
  titleId,
  onClose,
  closable = true,
  returnFocus,
  className = 'w-[min(34rem,calc(100vw-2rem))]',
  children,
}: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const fallback = useRef(returnFocus)
  useEffect(() => {
    fallback.current = returnFocus
  })

  useEffect(() => {
    const element = dialog.current
    const opener = document.activeElement
    if (element !== null && !element.open) element.showModal()
    return () => {
      element?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
      else fallback.current()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (closable) onClose()
      }}
      className={`app-no-drag m-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-line bg-panel p-0 text-ink shadow-[0_16px_48px_var(--dialog-shadow)] backdrop:bg-(--scrim) ${className}`}
    >
      {children}
    </dialog>
  )
}
