import type { Issue } from '@jira-mgr/core'
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'

import type { CurrentUser } from '../../shared/ipc'
import {
  CLOSED,
  cellReducer,
  focusLost,
  type CellMode,
  type CellProperty,
  type CellTarget,
} from './cell'
import { DateEditor } from './DateEditor'
import {
  AssigneePicker,
  LabelsPicker,
  PriorityPicker,
  SprintPicker,
  StatusPicker,
} from './PropertyPickers'

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

  // A press that is released away from its cell sends no click, so the next real click must not be
  // taken for its second half. The click follows the release at once, so a frame later is safe.
  const pressed = state.pressed !== null
  useEffect(() => {
    if (!pressed) return
    let frame = 0
    const onRelease = () => {
      frame = requestAnimationFrame(() => {
        dispatch({ type: 'press', cell: null })
      })
    }
    document.addEventListener('pointerup', onRelease, { capture: true, once: true })
    return () => {
      document.removeEventListener('pointerup', onRelease, true)
      cancelAnimationFrame(frame)
    }
  }, [pressed])

  return {
    target: state.target,
    /** Changes on each open: the key that mounts each editor afresh. */
    opens: state.opens,
    open: (target: CellTarget<HTMLElement>, pointer: boolean) => {
      dispatch({ type: 'open', target, pointer })
    },
    close: () => {
      dispatch({ type: 'close' })
    },
  }
}

/** What an editor can read when it opens: the issue as the caches show it now, the loaded issues and the user. */
export interface CellContext {
  issue: Issue
  issues: readonly Issue[]
  me: CurrentUser | undefined
  /** Passed to the editor: a `Picker` or a `CellPopover` takes it as its `cell`. */
  cell: CellMode
}

/**
 * The editor each property opens: a list from `PropertyPickers.tsx` given `cell` (see
 * `StatusPicker`), or a `CellPopover` around a field for an editor that is not a list.
 */
const EDITORS: Record<CellProperty, (context: CellContext) => ReactNode> = {
  status: ({ issue, cell }) => <StatusPicker issue={issue} cell={cell} />,
  assignee: ({ issue, issues, me, cell }) => (
    <AssigneePicker issue={issue} issues={issues} me={me} cell={cell} />
  ),
  dueDate: ({ issue, cell }) => (
    <DateEditor issue={issue} field="dueDate" label="Due date" cell={cell} />
  ),
  priority: ({ issue, cell }) => <PriorityPicker issue={issue} cell={cell} />,
  labels: ({ issue, issues, cell }) => <LabelsPicker issue={issue} issues={issues} cell={cell} />,
  sprint: ({ issue, cell }) => <SprintPicker issue={issue} cell={cell} />,
  startDate: ({ issue, cell }) => (
    <DateEditor issue={issue} field="startDate" label="Start date" cell={cell} />
  ),
}

interface CellEditorProps {
  target: CellTarget<HTMLElement>
  /** The issue as the caches show it now, so the editor marks the current value. */
  issue: Issue
  issues: readonly Issue[]
  me: CurrentUser | undefined
  onClose: () => void
}

/**
 * Opens the editor of `target.property` against `target.cell`, the element the user clicked. It
 * mounts open and unmounts when closed. The popover closes on Esc, a click outside or a choice,
 * and when the cell scrolls or leaves the page, which would leave it hanging in the air. A scroll
 * in the first two frames is ignored: the row that was clicked may have been scrolled into view.
 * Add a property by adding an entry to `EDITORS` (see the Cell Editor section of the README).
 */
export function CellEditor({ target, issue, issues, me, onClose }: CellEditorProps) {
  const { cell } = target

  // Before the editor's own effect shows the popover, so it finds its anchor.
  useLayoutEffect(() => {
    cell.style.setProperty('anchor-name', CELL_ANCHOR)
    return () => {
      cell.style.removeProperty('anchor-name')
    }
  }, [cell])

  const closeAway = useEffectEvent(onClose)
  useEffect(() => {
    let armed = false
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        armed = true
      })
    })
    const onScroll = (event: Event) => {
      if (armed && event.target instanceof Node && event.target.contains(cell)) closeAway()
    }
    window.addEventListener('scroll', onScroll, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [cell])

  // The Tree unmounts a row that leaves its window, taking the cell with it, and a resize can
  // hide it. Either leaves the popover hanging over nothing.
  useEffect(() => {
    if (!cell.isConnected) closeAway()
  })
  useEffect(() => {
    // The first callback comes at once, with the cell's size as it is.
    const observer = new ResizeObserver(() => {
      const { width, height } = cell.getBoundingClientRect()
      if (!cell.isConnected || width === 0 || height === 0) closeAway()
    })
    observer.observe(cell)
    return () => {
      observer.disconnect()
    }
  }, [cell])

  return EDITORS[target.property]({ issue, issues, me, cell: { anchor: CELL_ANCHOR, onClose } })
}
