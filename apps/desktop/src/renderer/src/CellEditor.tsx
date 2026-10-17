import type { Issue } from '@jira-mgr/core'
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'

import { CLOSED, cellReducer, focusLost, type CellProperty, type CellTarget } from './cell'
import type { CellMode } from './Picker'
import { StatusPicker } from './PropertyPickers'

/** The anchor name the cell being edited carries. One editor is open at a time. */
const CELL_ANCHOR = '--cell-editor'

/** The marker of a row's clickable cell. The click handler of the row reads it. */
const CELL_SELECTOR = '[data-pick]'

/**
 * Holds the open cell editor. `open` takes the cell the user clicked (`pointer`) or the one a key
 * chose; `close` is what the picker calls once its list has closed. Once the editor is gone,
 * focus goes to `restoreFocus` if the list took it along, as an Esc or a choice does; a click that
 * put focus somewhere else keeps it there.
 */
export function useCellEditor(restoreFocus: () => void) {
  const [state, dispatch] = useReducer(cellReducer<HTMLElement>, CLOSED)
  const isOpen = state.target !== null
  const wasOpen = useRef(false)

  const settleFocus = useEffectEvent(() => {
    if (focusLost(document.activeElement, document.body)) restoreFocus()
  })
  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    // Two frames on, so a choice has moved its row by then: on the Sprint page that remounts the
    // row's button and takes the focus with it.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        settleFocus()
      })
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [isOpen])

  // While the list is open, a press on its own cell closes it before the click arrives; remember it.
  useEffect(() => {
    if (!isOpen) return
    const onPress = (event: PointerEvent) => {
      const cell =
        event.target instanceof Element ? event.target.closest<HTMLElement>(CELL_SELECTOR) : null
      dispatch({ type: 'press', cell })
    }
    document.addEventListener('pointerdown', onPress, true)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
    }
  }, [isOpen])

  return {
    target: state.target,
    open: (target: CellTarget<HTMLElement>, pointer: boolean) => {
      dispatch({ type: 'open', target, pointer })
    },
    close: () => {
      dispatch({ type: 'close' })
    },
  }
}

/** The picker each property opens. Each one hands `cell` to its `Picker`, which then draws no trigger. */
const PICKERS: Record<CellProperty, (issue: Issue, cell: CellMode) => ReactNode> = {
  status: (issue, cell) => <StatusPicker issue={issue} cell={cell} />,
}

interface CellEditorProps {
  target: CellTarget<HTMLElement>
  /** The issue as the caches show it now, so the picker marks the current value. */
  issue: Issue
  onClose: () => void
}

/**
 * Opens the picker of `target.property` against `target.cell`, the element the user clicked. It
 * mounts open and unmounts when closed. The list closes on Esc, a click outside or a choice, and
 * when the page scrolls under the cell, which would leave the list hanging in the air.
 * Add a property by adding an entry to `PICKERS`, passing `cell` to its picker (see `StatusPicker`).
 */
export function CellEditor({ target, issue, onClose }: CellEditorProps) {
  const { cell } = target

  // Before the picker's own effect shows the list, so the list finds its anchor.
  useLayoutEffect(() => {
    cell.style.setProperty('anchor-name', CELL_ANCHOR)
    return () => {
      cell.style.removeProperty('anchor-name')
    }
  }, [cell])

  useEffect(() => {
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(cell)) onClose()
    }
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [cell, onClose])

  return PICKERS[target.property](issue, { anchor: CELL_ANCHOR, onClose })
}
