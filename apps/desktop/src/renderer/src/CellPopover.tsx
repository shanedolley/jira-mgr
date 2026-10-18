import { useEffect, useRef, type ReactNode, type RefObject, type ToggleEvent } from 'react'

import type { CellMode } from './cell'

/**
 * Shows the popover `ref` holds as soon as it mounts, when `on`, then calls `onShown` in the same
 * task, so a key pressed right after the open reaches what `onShown` focuses. The cell editor
 * mounts an editor open, against an element it has already given the anchor. `Picker` and
 * `CellPopover` both use it.
 */
export function useShowOnMount(
  ref: RefObject<HTMLElement | null>,
  on: boolean,
  onShown?: () => void,
): void {
  // The latest `onShown`, without making it a dependency: a changed one must not show the popover again.
  const shown = useRef(onShown)
  useEffect(() => {
    shown.current = onShown
  })
  useEffect(() => {
    const popover = ref.current
    // Strict mode runs this twice; showing an open popover throws.
    if (on && popover?.matches(':popover-open') === false) {
      popover.showPopover()
      shown.current?.()
    }
  }, [ref, on])
}

/** Closes the popover that holds `from`, which then calls the editor's `onClose`. */
export function closePopover(from: Element): void {
  from.closest<HTMLElement>('[popover]')?.hidePopover()
}

interface CellPopoverProps {
  cell: CellMode
  /** Names the popover for a screen reader, such as "Due date". */
  label: string
  /** The editor's controls. One that ends the edit, such as Enter in a field, calls `closePopover` on itself. */
  children: ReactNode
}

/**
 * The shell for an editor that is not a list, such as a date field. It opens on mount against the
 * cell's anchor, below it and flipping at the window's edges, closes on Esc or a click outside
 * like a `Picker`'s list, and calls `cell.onClose` once closed. On opening, focus goes at once to the
 * first element marked `data-autofocus`, else to the popover itself.
 */
export function CellPopover({ cell, label, children }: CellPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  function focusFirst() {
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]')
    ;(first ?? ref.current)?.focus()
  }
  useShowOnMount(ref, true, focusFirst)
  return (
    <div
      ref={ref}
      popover="auto"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onToggle={(event: ToggleEvent<HTMLDivElement>) => {
        if (event.newState === 'closed') {
          cell.onClose()
          return
        }
        focusFirst()
      }}
      style={{ positionAnchor: cell.anchor, positionTryFallbacks: 'flip-block, flip-inline' }}
      className="menu w-52 focus-visible:outline-none"
    >
      {children}
    </div>
  )
}
