import { ROW_PROPERTIES, WIDTH_MAX, type RowProperty } from '@jira-mgr/core/display'
import { describe, expect, it } from 'vitest'

import type { Display } from '../../shared/ipc'
import {
  MIN_CELL,
  SLOT_WIDTH,
  cellUsable,
  clampWidth,
  colVars,
  colWidth,
  dragCap,
  extrasWidth,
  fitWidths,
  floorWidths,
  releasedAt,
  sameWidths,
  stripRoom,
  withoutProperty,
} from './propertyFit'

const none = {
  blocked: false,
  blocking: false,
  differs: false,
  timer: false,
  progress: false,
}

const GAP = 8
const total = (properties: readonly RowProperty[], widths: Record<RowProperty, number>) =>
  properties.reduce((sum, p) => sum + widths[p], 0) + GAP * Math.max(0, properties.length - 1)

describe('stripRoom', () => {
  it('leaves less room for a deeper level and for wider extras', () => {
    const wide = extrasWidth({ ...none, differs: true, progress: true })
    expect(stripRoom(1000, 4, 0)).toBeLessThan(stripRoom(1000, 1, 0))
    expect(stripRoom(1000, 1, wide)).toBeLessThan(stripRoom(1000, 1, 0))
    expect(stripRoom(1000, 1, 0)).toBeGreaterThan(stripRoom(900, 1, 0))
  })

  it('reserves nothing for a summary pencil: the row has none', () => {
    // Chrome 266, the 4px level indent and seven 8px gaps leave 94px for the strip at 420.
    expect(stripRoom(420, 1, 0)).toBe(94)
  })
})

describe('fitWidths', () => {
  it('draws every property at its default in a wide Tree, and at the saved width where one is set', () => {
    const room = stripRoom(2000, 4, extrasWidth(none))
    const fitted = fitWidths(ROW_PROPERTIES, {}, room)
    for (const p of ROW_PROPERTIES) expect(fitted[p]).toBe(SLOT_WIDTH[p])
    expect(fitWidths(ROW_PROPERTIES, { labels: 130, due: 1 }, room)).toMatchObject({
      labels: 130,
      due: 1,
      sprint: SLOT_WIDTH.sprint,
    })
  })

  it('takes what a narrow Tree cannot hold from the trailing column first', () => {
    const all = total(ROW_PROPERTIES, SLOT_WIDTH)
    const fitted = fitWidths(ROW_PROPERTIES, {}, all - 30)
    expect(fitted.updated).toBe(SLOT_WIDTH.updated - 30)
    expect(fitted.labels).toBe(SLOT_WIDTH.labels)
    // More than the last column holds spills into the one before it.
    const spill = fitWidths(ROW_PROPERTIES, {}, all - SLOT_WIDTH.updated - 10)
    expect(spill.updated).toBe(0)
    expect(spill.created).toBe(SLOT_WIDTH.created - 10)
  })

  it('never draws a strip wider than its room, down to the gaps, and never a negative width', () => {
    for (let room = -50; room < 900; room += 7) {
      const fitted = fitWidths(ROW_PROPERTIES, { labels: 400 }, room)
      for (const p of ROW_PROPERTIES) expect(fitted[p]).toBeGreaterThanOrEqual(0)
      const gaps = GAP * (ROW_PROPERTIES.length - 1)
      expect(total(ROW_PROPERTIES, fitted)).toBeLessThanOrEqual(Math.max(room, gaps))
    }
  })

  it('draws a short list in full where a long one would not fit', () => {
    const room = stripRoom(420, 1, 0)
    expect(fitWidths(['updated'], {}, room).updated).toBe(SLOT_WIDTH.updated)
    expect(fitWidths(['created', 'updated'], {}, room).updated).toBeLessThan(SLOT_WIDTH.updated)
  })
})

describe('dragCap', () => {
  it('lets a column take what the others and the gaps leave', () => {
    const properties = ['labels', 'due', 'updated'] as const
    const fitted = fitWidths(properties, {}, 1000)
    expect(dragCap(properties, fitted, 'due', 400)).toBe(
      400 - GAP * 2 - SLOT_WIDTH.labels - SLOT_WIDTH.updated,
    )
  })

  it('is never negative, so a cramped Tree holds a column at 0', () => {
    const fitted = fitWidths(['labels', 'due'], {}, 1000)
    expect(dragCap(['labels', 'due'], fitted, 'due', 10)).toBe(0)
  })

  it('never exceeds what a file may hold, so a wide window cannot build a drag the IPC schema refuses', () => {
    const fitted = fitWidths(['labels'], {}, 5000)
    expect(dragCap(['labels'], fitted, 'labels', 5000)).toBe(WIDTH_MAX)
  })

  it('keeps the title at its minimum: the widest drag fills the room exactly', () => {
    const room = stripRoom(900, 2, 0)
    const fitted = fitWidths(ROW_PROPERTIES, {}, room)
    const cap = dragCap(ROW_PROPERTIES, fitted, 'sprint', room)
    const wide = fitWidths(ROW_PROPERTIES, { ...fitted, sprint: cap }, room)
    expect(total(ROW_PROPERTIES, wide)).toBeLessThanOrEqual(room)
    expect(wide.sprint).toBe(cap)
  })
})

describe('clampWidth', () => {
  it('rounds to whole pixels and holds the drag between 0 and the cap', () => {
    expect(clampWidth(40.4, 100)).toBe(40)
    expect(clampWidth(-20, 100)).toBe(0)
    expect(clampWidth(0.4, 100)).toBe(0)
    expect(clampWidth(250, 100)).toBe(100)
  })
})

describe('colWidth and colVars', () => {
  it('reads a column from its custom property and falls back to the default', () => {
    expect(colWidth('estimate')).toEqual({ width: 'var(--col-estimate, 64px)' })
    expect(colVars(['labels', 'due'], { labels: 130 })).toEqual({
      '--col-labels': '130px',
      '--col-due': `${String(SLOT_WIDTH.due)}px`,
    })
  })

  it('names every property, so a new one needs no special case', () => {
    for (const p of ROW_PROPERTIES) {
      expect(colWidth(p).width).toContain(`--col-${p}`)
      expect(SLOT_WIDTH[p]).toBeGreaterThan(0)
    }
  })
})

describe('the 0px rule', () => {
  const display: Display = {
    properties: ['labels', 'due', 'updated'],
    order: 'key',
    direction: 'desc',
    widths: { labels: 130, due: 40 },
  }

  it('saves a width above 0 for the property and leaves the rest', () => {
    const next = releasedAt(display, 'updated', 1)
    expect(next.widths).toEqual({ labels: 130, due: 40, updated: 1 })
    expect(next.properties).toEqual(display.properties)
    expect(releasedAt({ ...display, widths: undefined }, 'due', 50).widths).toEqual({ due: 50 })
  })

  it('removes the property at 0 and forgets its width', () => {
    const next = releasedAt(display, 'due', 0)
    expect(next.properties).toEqual(['labels', 'updated'])
    expect(next.widths).toEqual({ labels: 130 })
    expect(next).toEqual(withoutProperty(display, 'due'))
  })

  it('drops the widths key once no width is left, and keeps the order and direction', () => {
    const next = releasedAt({ ...display, widths: { due: 40 } }, 'due', 0)
    expect(next).not.toHaveProperty('widths')
    expect(next).toMatchObject({
      order: 'key',
      direction: 'desc',
      properties: ['labels', 'updated'],
    })
  })

  it('does not change the display it was given', () => {
    const before = structuredClone(display)
    releasedAt(display, 'due', 0)
    releasedAt(display, 'due', 20)
    expect(display).toEqual(before)
  })
})

describe('sameWidths', () => {
  const base: Display = { properties: ['labels', 'due'], order: 'key', direction: 'desc' }

  it('treats a missing width as the default', () => {
    expect(sameWidths(base, { ...base, widths: { labels: SLOT_WIDTH.labels } })).toBe(true)
    expect(sameWidths(base, { ...base, widths: { labels: 100 } })).toBe(false)
  })
})

describe('extrasWidth', () => {
  it('is nothing for a row with no extras and grows with each', () => {
    expect(extrasWidth(none)).toBe(0)
    expect(extrasWidth({ ...none, blocked: true })).toBeGreaterThan(0)
    expect(extrasWidth({ ...none, blocked: true, blocking: true })).toBeGreaterThan(
      extrasWidth({ ...none, blocked: true }),
    )
  })
})

describe('cellUsable', () => {
  const cell = (visible: boolean, width: number) =>
    ({
      checkVisibility: () => visible,
      getBoundingClientRect: () => ({ width }),
    }) as unknown as HTMLElement

  it('wants a cell that is drawn and wide enough to anchor an editor to', () => {
    expect(cellUsable(cell(true, 64))).toBe(true)
    expect(cellUsable(cell(true, MIN_CELL))).toBe(true)
  })

  it('refuses a missing cell, a hidden one and a column cut to a sliver', () => {
    expect(cellUsable(null)).toBe(false)
    expect(cellUsable(undefined)).toBe(false)
    expect(cellUsable(cell(false, 64))).toBe(false)
    expect(cellUsable(cell(true, 0))).toBe(false)
    expect(cellUsable(cell(true, 1))).toBe(false)
    expect(cellUsable(cell(true, MIN_CELL - 1))).toBe(false)
  })
})

describe('floorWidths', () => {
  it('lifts a narrow column to the least a button can be clicked at and leaves the rest', () => {
    expect(floorWidths(['labels', 'due', 'updated'], { labels: 1, due: 40 })).toEqual({
      labels: MIN_CELL,
      due: 40,
      updated: SLOT_WIDTH.updated,
    })
  })
})
