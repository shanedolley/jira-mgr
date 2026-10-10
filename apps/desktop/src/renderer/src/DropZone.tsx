import { useContext, type DragEvent, type ReactNode } from 'react'

import { FileDragContext } from './fileDrag'

interface DropZoneProps {
  /** Shown over the zone while a file is dragged over the page, and what the drop does. */
  label: string
  /**
   * The files dropped on the zone. `handled` is true when something inside it, such as the
   * editor, took the drop already, so the zone should report only what that left over.
   */
  onFiles: (files: File[], handled: boolean) => void
  className?: string
  children: ReactNode
}

const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

/** The drops a zone took, so the page does not attach their files a second time. */
const claimed = new WeakSet<Event>()

/** True when a zone took this drop. The page's own drop handler skips it. */
export const isClaimed = (event: Event): boolean => claimed.has(event)

/**
 * A place on the page that takes dropped files. Every zone lights up with its own label while a
 * file is dragged anywhere over the page (`useFileDrag`), so several zones can show at once.
 */
export function DropZone({ label, onFiles, className = '', children }: DropZoneProps) {
  const dragging = useContext(FileDragContext)
  return (
    <div
      data-drop-zone={label}
      className={`relative rounded-md ${dragging ? 'outline-2 outline-dashed outline-accent' : ''} ${className}`}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return
        // The editor takes image files dropped on it while editing and says so with preventDefault.
        const handled = event.defaultPrevented
        claimed.add(event.nativeEvent)
        event.preventDefault()
        const files = Array.from(event.dataTransfer.files)
        if (files.length > 0) onFiles(files, handled)
      }}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-md bg-canvas/80 font-medium text-accent">
          {label}
        </div>
      )}
    </div>
  )
}
