import type { RowProperty } from '@jira-mgr/core/display'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { clampWidth, colWidth, dragCap, setColWidth } from './propertyFit'
import { PROPERTY_LABELS } from './TreeToolbar'

/**
 * What a row leaves right of its property strip, in pixels: the avatar (20), the gap before it (8)
 * and the row's inset and padding (8 and 8). The header ends its strip the same distance from the
 * list's right edge, plus the list's scrollbar.
 */
const AFTER_STRIP = 44

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
 */
export function ColumnHeader({ properties, fitted, room, scrollbar, onResize }: ColumnHeaderProps) {
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)
  const [removing, setRemoving] = useState<RowProperty | null>(null)

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

  const cancel = useEffectEvent(() => {
    end(false)
  })
  // Captured, so Escape ends the drag before the page's own Escape would leave the page.
  useEffect(() => {
    if (!dragging) return
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
  }, [dragging])

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>, property: RowProperty) {
    const pane = event.currentTarget.closest<HTMLElement>('[data-tree-pane]')
    if (event.button !== 0 || drag.current !== null || pane === null) return
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
    const width = fitted[property]
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
    onResize(property, next)
    tree?.focus()
  }

  return (
    <div
      role="group"
      aria-label="Column widths"
      data-column-header
      style={{ paddingRight: scrollbar + AFTER_STRIP }}
      className="absolute inset-x-0 top-0 hidden h-6 select-none justify-end border-b border-line @tree:flex"
    >
      <span role="status" className="absolute left-3 top-0 text-xs leading-6 text-danger">
        {removing === null ? '' : `Release to remove ${PROPERTY_LABELS[removing]}`}
      </span>
      <div className="flex gap-x-2">
        {properties.map((property) => (
          <div
            key={property}
            data-col={property}
            style={colWidth(property)}
            className="relative shrink-0"
          >
            <span
              aria-hidden
              title={PROPERTY_LABELS[property]}
              className="block truncate text-right text-xs leading-6 text-muted"
            >
              {PROPERTY_LABELS[property]}
            </span>
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
  )
}
