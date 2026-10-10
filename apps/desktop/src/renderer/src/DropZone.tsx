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

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13V3m0 0L6 7m4-4 4 4M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13" />
    </svg>
  )
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
      className={`relative rounded-md ${dragging ? '[&>:not([data-drop-label])]:opacity-20' : ''} ${className}`}
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
        <div
          data-drop-label
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-accent bg-canvas/95 text-[13px] font-medium text-accent"
        >
          <UploadIcon />
          {label}
        </div>
      )}
    </div>
  )
}
