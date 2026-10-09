import { useContext, type DragEvent, type ReactNode } from 'react'

import { FileDragContext } from './fileDrag'

interface DropZoneProps {
  /** Shown over the zone while a file is dragged over the page, and what the drop does. */
  label: string
  /** The files dropped on the zone, unless something inside it took the drop already. */
  onFiles: (files: File[]) => void
  className?: string
  children: ReactNode
}

const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

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
        // The editor takes image files dropped on it while editing and says so with preventDefault.
        if (event.defaultPrevented || !carriesFiles(event)) return
        event.preventDefault()
        const files = Array.from(event.dataTransfer.files)
        if (files.length > 0) onFiles(files)
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
