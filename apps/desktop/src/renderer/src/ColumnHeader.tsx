import type { RowProperty } from '@jira-mgr/core/display'
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react'

import { clampWidth, colWidth, dragCap, setColWidth, type ColumnTarget } from './propertyFit'
import { HOLD_OPACITY } from './StatusDot'
import { PROPERTY_LABELS } from './TreeToolbar'

/**
 * The opacity of the names while the strip shows (#307), as the custom property `styles.css` reads:
 * Hold's 30%, with the name under the pointer in full. The Sprint page's strip spreads it too.
 */
export const nameFade = { '--name-fade': HOLD_OPACITY } as CSSProperties

/**
 * What a row leaves right of its property strip, in pixels: the avatar (20), the gap before it (8)
 * and the row's inset and padding (8 and 8). The header ends its strip the same distance from the
 * list's right edge, plus the list's scrollbar.
 */
const AFTER_STRIP = 44

/** A press on a name must travel this far before it is a drag, so a click on it does nothing. */
const MOVE_THRESHOLD = 4

/** Arrow keys resize a column by this many pixels, or by `BIG_STEP` with Shift held. */
const STEP = 8
const BIG_STEP = 32

interface Drag {
  property: RowProperty
  pointerId: number
  /** The pointer's x when the drag began, and the column's width then. */
  x: number
  start: number
  /** The width now, between 0 and `cap`. */
  width: number
  cap: number
  /** The element that holds the `--col-*` widths, and the separator under the pointer. */
  pane: HTMLElement
  separator: HTMLElement
}

interface Move {
  property: RowProperty
  pointerId: number
  /** The pointer's x when the press began. */
  x: number
  /** Whether the pointer has travelled `MOVE_THRESHOLD`. */
  started: boolean
  /** The place the column would take if released now. */
  to: number
  header: HTMLElement
  name: HTMLElement
}

interface ColumnHeaderProps {
  properties: readonly RowProperty[]
  /** The width each column is drawn at, which the Tree fits to its room. */
  fitted: Record<RowProperty, number>
  /** The pixels the strip may take, which caps a drag so the title keeps its minimum. */
  room: number
  /** The list's scrollbar width, which its rows do not have under them. */
  scrollbar: number
  /** A column resized to `width`, where 0 removes it. A drag reports once, on release. */
  onResize: (property: RowProperty, width: number) => void
  /** A column dragged or keyed to a new place. Returns the place it took, or `null` if it did not move. */
  onMove: (property: RowProperty, target: ColumnTarget) => number | null
}

/** A separator's spoken value. */
const pixels = (width: number) => `${String(width)} pixels`

const treeOf = (from: Element) =>
  from.closest('[data-tree-pane]')?.querySelector<HTMLElement>('[role="tree"]')

/**
 * The names of the Display properties above the Tree's list, each column's separator on its left
 * edge. The strip hangs from the avatar, so a column grows leftwards: the separator at its left
 * edge follows the pointer, and the title takes or gives the difference. A drag writes the width as
 * a CSS custom property on the Tree's container, so no row renders while it runs, and saves once,
 * on release. Releasing at 0 removes the column. Escape cancels. A focused separator takes
 * Left (wider) and Right (narrower) by 8px, 32px with Shift, and Delete or Backspace to remove.
 *
 * Each name also drags the column to a new place. The drop line shows the edge the column would land
 * beside, in this component's state alone, so no row renders while it runs; release saves once.
 * Escape cancels. A focused name takes Alt+Left and Alt+Right to move the column one place.
 *
 * The names and separators show only while the pointer is over the strip (a drag or a move keeps it
 * there by pointer capture) or focus is on a name or separator. `styles.css` draws that, and the
 * highlight down the column under the pointer.
 */
export function ColumnHeader({
  properties,
  fitted,
  room,
  scrollbar,
  onResize,
  onMove,
}: ColumnHeaderProps) {
  const drag = useRef<Drag | null>(null)
  const move = useRef<Move | null>(null)
  const header = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  /** The column being dragged to a new place, and where a release would put it. */
  const [moving, setMoving] = useState<{ property: RowProperty; to: number } | null>(null)
  /** The new place a key gave a column, for a screen reader. */
  const [said, setSaid] = useState('')
  /** The name a key moved, which takes focus back once its column is drawn in the new place. */
  const refocus = useRef<RowProperty | null>(null)
  useEffect(() => {
    if (refocus.current === null) return
    const name = header.current?.querySelector<HTMLElement>(`[data-col-name="${refocus.current}"]`)
    refocus.current = null
    if (name !== null && name !== undefined && document.activeElement !== name) name.focus()
  })
  const [removing, setRemoving] = useState<RowProperty | null>(null)
  /**
   * The width the last key set, until the next render draws it. A key can arrive before the render
   * of the last, and `fitted` is still the old width then.
   */
  const keyed = useRef<{ property: RowProperty; width: number } | null>(null)
  useEffect(() => {
    keyed.current = null
  })

  /** Ends a drag: saves its width on release, or puts the column back. */
  function end(commit: boolean) {
    const d = drag.current
    if (d === null) return
    drag.current = null
    setDragging(false)
    setRemoving(null)
    if (d.separator.hasPointerCapture(d.pointerId)) d.separator.releasePointerCapture(d.pointerId)
    // The Tree owns focus, as after any click in it. A removed column's separator leaves anyway.
    const tree = treeOf(d.separator)
    if (commit && d.width !== d.start) onResize(d.property, d.width)
    else {
      setColWidth(d.pane, d.property, d.start)
      d.separator.setAttribute('aria-valuenow', String(d.start))
      d.separator.setAttribute('aria-valuetext', pixels(d.start))
    }
    tree?.focus({ preventScroll: true })
  }

  /** Ends a move: saves the new place on release, or leaves the column where it was. */
  function endMove(commit: boolean) {
    const m = move.current
    if (m === null) return
    move.current = null
    setMoving(null)
    if (m.name.hasPointerCapture(m.pointerId)) m.name.releasePointerCapture(m.pointerId)
    if (m.started) treeOf(m.name)?.focus({ preventScroll: true })
    if (commit && m.started) onMove(m.property, { to: m.to })
  }

  const cancel = useEffectEvent(() => {
    end(false)
    endMove(false)
  })
  const active = dragging || moving !== null
  // Captured, so Escape ends the drag before the page's own Escape would leave the page.
  useEffect(() => {
    if (!active) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancel()
    }
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('keydown', key, true)
    }
  }, [active])

  function onNameDown(event: React.PointerEvent<HTMLButtonElement>, property: RowProperty) {
    const bar = event.currentTarget.closest<HTMLElement>('[data-column-header]')
    if (event.button !== 0 || drag.current !== null || move.current !== null || bar === null) return
    event.preventDefault()
    // The press stops the browser's own focus, so a click leaves the name focused for Alt+Arrow.
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    move.current = {
      property,
      pointerId: event.pointerId,
      x: event.clientX,
      started: false,
      to: properties.indexOf(property),
      header: bar,
      name: event.currentTarget,
    }
  }

  function onNameMove(event: React.PointerEvent<HTMLButtonElement>) {
    const m = move.current
    if (m?.pointerId !== event.pointerId) return
    if (!m.started) {
      if (Math.abs(event.clientX - m.x) < MOVE_THRESHOLD) return
      m.started = true
    }
    // The column whose centre is nearest the pointer is the place the drop would take.
    let to = m.to
    let nearest = Infinity
    m.header.querySelectorAll<HTMLElement>('[data-col]').forEach((cell, index) => {
      const box = cell.getBoundingClientRect()
      const gap = Math.abs(box.left + box.width / 2 - event.clientX)
      if (gap < nearest) {
        nearest = gap
        to = index
      }
    })
    m.to = to
    setMoving((now) =>
      now?.property === m.property && now.to === to ? now : { property: m.property, to },
    )
  }

  /** Alt with Left or Right moves the focused name's column one place; any other key is left alone. */
  function onNameKey(event: React.KeyboardEvent<HTMLButtonElement>, property: RowProperty) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    // The Tree and the Shell read arrows too, so the name keeps its keys.
    event.stopPropagation()
    const place = onMove(property, { step: event.key === 'ArrowLeft' ? -1 : 1 })
    if (place === null) return
    refocus.current = property
    setSaid(
      `${PROPERTY_LABELS[property]} moved to position ${String(place + 1)} of ${String(properties.length)}`,
    )
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>, property: RowProperty) {
    const pane = event.currentTarget.closest<HTMLElement>('[data-tree-pane]')
    if (event.button !== 0 || drag.current !== null || move.current !== null || pane === null)
      return
    // Stops the text selection and the focus a press would start, so the drag is the pointer's alone.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = fitted[property]
    drag.current = {
      property,
      pointerId: event.pointerId,
      x: event.clientX,
      start,
      width: start,
      cap: dragCap(properties, fitted, property, room),
      pane,
      separator: event.currentTarget,
    }
    setDragging(true)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (d?.pointerId !== event.pointerId) return
    // The strip hangs from the right, so the pointer moving left widens the column.
    const width = clampWidth(d.start + d.x - event.clientX, d.cap)
    if (width === d.width) return
    d.width = width
    setColWidth(d.pane, d.property, width)
    event.currentTarget.setAttribute('aria-valuenow', String(width))
    event.currentTarget.setAttribute('aria-valuetext', pixels(width))
    setRemoving(width === 0 ? d.property : null)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>, property: RowProperty) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const width = keyed.current?.property === property ? keyed.current.width : fitted[property]
    const step = event.shiftKey ? BIG_STEP : STEP
    let next: number
    let remove = false
    if (event.key === 'ArrowLeft') {
      next = Math.min(dragCap(properties, fitted, property, room), width + step)
    } else if (event.key === 'ArrowRight') {
      // A key never reaches 0: that is Delete's, so a held key cannot remove a column by accident.
      next = Math.min(width, Math.max(1, width - step))
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      next = 0
      remove = true
    } else return
    event.preventDefault()
    // The Tree and the Shell read arrows and Delete too, so the separator keeps its keys.
    event.stopPropagation()
    // Delete acts on a column that is on, even one the window draws at 0.
    if (next === width && !remove) return
    const tree = next === 0 ? treeOf(event.currentTarget) : null
    keyed.current = { property, width: next }
    onResize(property, next)
    tree?.focus()
  }

  return (
    <>
      <div
        role="group"
        ref={header}
        aria-label="Column widths"
        data-column-header
        style={{ ...nameFade, paddingRight: scrollbar + AFTER_STRIP }}
        className="absolute inset-x-0 top-0 hidden h-6 select-none justify-end border-b border-line @tree:flex"
      >
        <span role="status" className="absolute left-3 top-0 text-xs leading-6 text-danger">
          {removing === null ? '' : `Release to remove ${PROPERTY_LABELS[removing]}`}
        </span>
        <span aria-live="polite" className="sr-only">
          {said}
        </span>
        <div className="flex gap-x-2">
          {properties.map((property, index) => (
            <div
              key={property}
              data-col={property}
              style={colWidth(property)}
              className="relative shrink-0"
            >
              <button
                type="button"
                title={PROPERTY_LABELS[property]}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                data-col-name={property}
                data-moving={moving?.property === property ? '' : undefined}
                onPointerDown={(event) => {
                  onNameDown(event, property)
                }}
                onPointerMove={onNameMove}
                onPointerUp={() => {
                  endMove(true)
                }}
                onPointerCancel={() => {
                  endMove(false)
                }}
                onLostPointerCapture={() => {
                  endMove(false)
                }}
                onKeyDown={(event) => {
                  onNameKey(event, property)
                }}
                className="block w-full cursor-grab touch-none truncate text-right text-xs leading-6 text-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              >
                {PROPERTY_LABELS[property]}
              </button>
              {moving !== null && moving.to === index && moving.property !== property && (
                <span
                  aria-hidden
                  data-drop-line={
                    moving.to < properties.indexOf(moving.property) ? 'before' : 'after'
                  }
                  className={`pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-accent ${moving.to < properties.indexOf(moving.property) ? '-left-1' : '-right-1'}`}
                />
              )}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${PROPERTY_LABELS[property]} column`}
                aria-valuemin={0}
                aria-valuemax={dragCap(properties, fitted, property, room)}
                aria-valuenow={fitted[property]}
                aria-valuetext={pixels(fitted[property])}
                aria-keyshortcuts="ArrowLeft ArrowRight Delete"
                // A column the window draws at 0 has nothing to focus.
                tabIndex={fitted[property] === 0 ? -1 : 0}
                data-col-sep={property}
                data-removing={removing === property ? '' : undefined}
                onPointerDown={(event) => {
                  onPointerDown(event, property)
                }}
                onPointerMove={onPointerMove}
                onPointerUp={() => {
                  end(true)
                }}
                onPointerCancel={() => {
                  end(false)
                }}
                onLostPointerCapture={() => {
                  end(false)
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, property)
                }}
                className="group/sep absolute inset-y-0 -left-[10px] z-10 flex w-3 cursor-col-resize touch-none justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              >
                <span
                  aria-hidden
                  className="h-full w-px bg-line group-hover/sep:bg-accent group-data-[removing]/sep:bg-danger"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span aria-hidden data-col-highlight />
    </>
  )
}
