import type { Issue } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import {
  CELL_PROPERTIES,
  CLOSED,
  cellReducer,
  focusLost,
  isCellProperty,
  type CellState,
  type CellTarget,
} from './cell'
import { keyOf, letterCommand, PROPERTY_KEYS } from './keymap'

interface Cell {
  name: string
}

const ring: Cell = { name: 'ring of P-1' }
const other: Cell = { name: 'ring of P-2' }

const target = (cell: Cell): CellTarget<Cell> => ({
  issue: { key: 'P-1' } as Issue,
  property: 'status',
  cell,
})

const opened = (cell: Cell): CellState<Cell> =>
  cellReducer<Cell>(CLOSED, { type: 'open', target: target(cell), pointer: true })

describe('cellReducer', () => {
  it('opens the target it is asked for and closes it', () => {
    const open = opened(ring)
    expect(open.target?.cell).toBe(ring)
    expect(cellReducer(open, { type: 'close' }).target).toBeNull()
  })

  it('moves to another cell when asked while one is open', () => {
    expect(
      cellReducer(opened(ring), { type: 'open', target: target(other), pointer: true }).target
        ?.cell,
    ).toBe(other)
  })

  it('does not reopen a cell whose own press has just closed its list', () => {
    // The press closes the list first, then the click arrives.
    const pressed = cellReducer(opened(ring), { type: 'press', cell: ring })
    const closed = cellReducer(pressed, { type: 'close' })
    const clicked = cellReducer(closed, { type: 'open', target: target(ring), pointer: true })
    expect(clicked.target).toBeNull()
    // The next click is a new open.
    expect(
      cellReducer(clicked, { type: 'open', target: target(ring), pointer: true }).target?.cell,
    ).toBe(ring)
  })

  it('still swallows the click when it arrives before the list has closed', () => {
    const pressed = cellReducer(opened(ring), { type: 'press', cell: ring })
    const clicked = cellReducer(pressed, { type: 'open', target: target(ring), pointer: true })
    expect(cellReducer(clicked, { type: 'close' }).target).toBeNull()
  })

  it('opens another cell pressed while this one was open', () => {
    const pressed = cellReducer(opened(ring), { type: 'press', cell: other })
    const closed = cellReducer(pressed, { type: 'close' })
    expect(
      cellReducer(closed, { type: 'open', target: target(other), pointer: true }).target?.cell,
    ).toBe(other)
  })

  it('forgets a press that was on no cell', () => {
    const pressed = cellReducer(opened(ring), { type: 'press', cell: ring })
    const away = cellReducer(pressed, { type: 'press', cell: null })
    expect(away.pressed).toBeNull()
  })

  it('a key always opens, whatever was pressed before', () => {
    const closed = cellReducer(cellReducer(opened(ring), { type: 'press', cell: ring }), {
      type: 'close',
    })
    expect(
      cellReducer(closed, { type: 'open', target: target(ring), pointer: false }).target?.cell,
    ).toBe(ring)
  })
})

describe('focusLost', () => {
  const body = { name: 'body' } as unknown as Element
  const tree = { name: 'tree' } as unknown as Element

  it('is true on the body or nowhere, so the Tree takes focus back', () => {
    expect(focusLost(body, body)).toBe(true)
    expect(focusLost(null, body)).toBe(true)
  })

  it('is false when a click has put focus on a control, which keeps it', () => {
    expect(focusLost(tree, body)).toBe(false)
  })
})

describe('isCellProperty', () => {
  it('accepts each property with a cell editor and nothing else a cell can carry', () => {
    for (const property of CELL_PROPERTIES) expect(isCellProperty(property)).toBe(true)
    expect(isCellProperty('priority')).toBe(true)
    // An unregistered name and a missing attribute are no property.
    expect(isCellProperty('nonsense')).toBe(false)
    expect(isCellProperty(undefined)).toBe(false)
  })

  it('names a keymap command for each property, so its key opens the editor', () => {
    for (const property of CELL_PROPERTIES) expect(property in PROPERTY_KEYS).toBe(true)
    expect(isCellProperty('labels')).toBe(true)
  })
})

describe('assignee cell', () => {
  it('is registered, so a click on the avatar and the A key route to the cell editor', () => {
    expect(CELL_PROPERTIES).toContain('assignee')
    expect(isCellProperty('assignee')).toBe(true)
    // The key's command is the property's name, which `openCell` in the Shell reads.
    expect(letterCommand('a', false)).toBe('assignee')
  })

  it('names a keymap command with a key for every property, so each has a keyboard path', () => {
    for (const property of CELL_PROPERTIES) expect(keyOf(property)).toBeDefined()
  })

  it('opens and closes against the avatar like any other cell', () => {
    const avatar: Cell = { name: 'avatar of P-1' }
    const open = cellReducer<Cell>(CLOSED, {
      type: 'open',
      target: { ...target(avatar), property: 'assignee' },
      pointer: true,
    })
    expect(open.target?.property).toBe('assignee')
    expect(cellReducer(open, { type: 'close' }).target).toBeNull()
  })
})
