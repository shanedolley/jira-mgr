import { createContext, useEffect, useState } from 'react'

/** True while a drag that carries files is over the window. Drop zones read it to light up. */
export const FileDragContext = createContext(false)

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true

/**
 * Tracks a file drag over the whole window, for a page to share with its drop zones. It also
 * stops the browser's own handling of a dropped file, which would navigate the window to it.
 * The state clears when the drag leaves the window, on a drop, when the drag ends and on Esc.
 */
export function useFileDrag(): boolean {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // dragenter and dragleave fire for every element crossed, so count them to know when the
    // drag has left the window.
    let depth = 0
    const clear = () => {
      depth = 0
      setDragging(false)
    }
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
      // Keeps the highlight right if a leave was counted wrongly.
      setDragging(true)
    }
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      depth--
      // Leaving to nothing means leaving the window, whatever the count says.
      if (depth <= 0 || event.relatedTarget === null) clear()
    }
    const drop = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault()
      clear()
    }
    // Captured, so Esc ends the drag before the page's own Esc would leave the page.
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || depth === 0) return
      event.preventDefault()
      event.stopPropagation()
      clear()
    }
    document.addEventListener('dragenter', enter)
    document.addEventListener('dragover', over)
    document.addEventListener('dragleave', leave)
    document.addEventListener('drop', drop)
    document.addEventListener('dragend', clear)
    document.addEventListener('keydown', key, true)
    window.addEventListener('blur', clear)
    return () => {
      document.removeEventListener('dragenter', enter)
      document.removeEventListener('dragover', over)
      document.removeEventListener('dragleave', leave)
      document.removeEventListener('drop', drop)
      document.removeEventListener('dragend', clear)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return dragging
}
