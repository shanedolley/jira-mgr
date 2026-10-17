import type { Issue } from '@jira-mgr/core'

/** The properties a row's cell can edit in place. Each later story adds its own. */
export type CellProperty = 'status'

/** The cell being edited: the issue, the property, and the element the list anchors to. */
export interface CellTarget<E> {
  issue: Issue
  property: CellProperty
  cell: E
}

/**
 * What the cell editor holds. `pressed` is the cell the pointer went down on while its own list
 * was open: the press closes the list, and the click that follows must not open it again.
 */
export interface CellState<E> {
  target: CellTarget<E> | null
  pressed: E | null
}

export type CellEvent<E> =
  /** The pointer went down on `cell`, or on something that is no cell (`null`). */
  | { type: 'press'; cell: E | null }
  /** A click on a cell (`pointer`) or a key asks for its editor. */
  | { type: 'open'; target: CellTarget<E>; pointer: boolean }
  /** The list closed, by a choice, Esc or a click outside. */
  | { type: 'close' }

export const CLOSED: CellState<never> = { target: null, pressed: null }

export function cellReducer<E>(state: CellState<E>, event: CellEvent<E>): CellState<E> {
  switch (event.type) {
    case 'press':
      return { ...state, pressed: event.cell === state.target?.cell ? event.cell : null }
    case 'open':
      // The press on this cell's own ring closed its list, so the click is the second half of a toggle.
      if (event.pointer && state.pressed === event.target.cell) return { ...state, pressed: null }
      return { target: event.target, pressed: null }
    case 'close':
      return { ...state, target: null }
  }
}

/** Whether focus was lost with the list: it sits on the page's body, or nowhere. */
export const focusLost = (active: Element | null, body: Element): boolean =>
  active === null || active === body
