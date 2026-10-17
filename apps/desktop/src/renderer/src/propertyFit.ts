import type { PropertyWidths, RowProperty } from '@jira-mgr/core/display'
import type { CSSProperties } from 'react'

import type { Display } from '../../shared/ipc'

/** The pixel width of each property's column until the user resizes it. */
export const SLOT_WIDTH: Record<RowProperty, number> = {
  labels: 96,
  sprint: 104,
  estimate: 64,
  logged: 64,
  remaining: 64,
  remainingPercent: 48,
  start: 96,
  due: 96,
  created: 72,
  updated: 72,
}

const GAP = 8

/** The CSS custom property that holds a column's width, set on the element that holds the rows. */
const colVar = (property: RowProperty) => `--col-${property}`

/** A cell's width: its column's custom property, or the default where nothing sets it. */
export const colWidth = (property: RowProperty): CSSProperties => ({
  width: `var(${colVar(property)}, ${String(SLOT_WIDTH[property])}px)`,
})

/** The custom properties of `properties` at `widths`, for the element that holds the rows and the header. */
export function colVars(properties: readonly RowProperty[], widths: PropertyWidths): CSSProperties {
  return Object.fromEntries(
    properties.map((p) => [colVar(p), `${String(widths[p] ?? SLOT_WIDTH[p])}px`]),
  )
}

/** Sets one column's width on `element` without a React render, as a drag does. */
export function setColWidth(element: HTMLElement, property: RowProperty, width: number): void {
  element.style.setProperty(colVar(property), `${String(width)}px`)
}

/**
 * The widths of what an issue row can hold between its title and its properties, with room to
 * spare for a wide font: a blocked or blocking pill, "Customer differs", the timer and the
 * progress pill.
 */
const EXTRA_WIDTH = { pill: 48, differs: 136, timer: 72, progress: 64 }

/**
 * Everything in a row but the title and the optional extras, in pixels: the chevron, type icon,
 * status dot, key column, priority slot, avatar, the padding, the title's 5rem minimum and the
 * summary pencil (14 icon, 4 padding, less its 4 negative margin).
 */
const CHROME = 8 + 16 + 16 + 18 + 88 + 16 + 24 + 80 + 14

/** The extras one row holds, as the width they take with their gaps. */
export function extrasWidth(extras: {
  blocked: boolean
  blocking: boolean
  differs: boolean
  timer: boolean
  progress: boolean
}): number {
  return (
    (extras.blocked ? EXTRA_WIDTH.pill + GAP : 0) +
    (extras.blocking ? EXTRA_WIDTH.pill + GAP : 0) +
    (extras.differs ? EXTRA_WIDTH.differs + GAP : 0) +
    (extras.timer ? EXTRA_WIDTH.timer + GAP : 0) +
    (extras.progress ? EXTRA_WIDTH.progress + GAP : 0)
  )
}

/**
 * The pixels the property strip may take in every row of a Tree `rowWidth` wide, leaving each
 * title its 5rem: the deepest row (`level`, indented 16px a level) with the widest `extras` sets
 * it, so the same widths hold in every row and the columns line up.
 */
export function stripRoom(rowWidth: number, level: number, extras: number): number {
  // Eight gaps between the nine items of a row: chevron, type, status, key, title, the pencil,
  // priority, the strip and the avatar. Each extra brings its own gap, counted in `extras`.
  return rowWidth - CHROME - (4 + (level - 1) * 16) - extras - GAP * 8
}

/** The pixels `count` columns take beside their gaps. */
const gaps = (count: number) => GAP * Math.max(0, count - 1)

/**
 * The widths the columns take in a strip with `room` pixels: the user's (`saved`, else the
 * default), less what a narrow Tree cannot hold, taken from the trailing column first. A column
 * keeps its saved width; this is only what is drawn.
 */
export function fitWidths(
  properties: readonly RowProperty[],
  saved: PropertyWidths,
  room: number,
): Record<RowProperty, number> {
  const fitted = {} as Record<RowProperty, number>
  let excess =
    properties.reduce((sum, p) => sum + (saved[p] ?? SLOT_WIDTH[p]), 0) +
    gaps(properties.length) -
    room
  for (const property of properties.toReversed()) {
    const width = saved[property] ?? SLOT_WIDTH[property]
    const cut = Math.min(width, Math.max(0, excess))
    fitted[property] = width - cut
    excess -= cut
  }
  return fitted
}

/**
 * The widest `property` can be dragged in a strip with `room` pixels: what the other columns
 * leave, so the title keeps its minimum.
 */
export function dragCap(
  properties: readonly RowProperty[],
  fitted: Record<RowProperty, number>,
  property: RowProperty,
  room: number,
): number {
  const others = properties.reduce((sum, p) => sum + (p === property ? 0 : fitted[p]), 0)
  return Math.max(0, Math.floor(room - gaps(properties.length) - others))
}

/** A drag at `width` pixels, whole and between 0 and `cap`. */
export const clampWidth = (width: number, cap: number) =>
  Math.min(Math.max(Math.round(width), 0), cap)

/** The display with `property` off and its width forgotten, so adding it again starts at the default. */
export function withoutProperty(display: Display, property: RowProperty): Display {
  const { widths, ...rest } = display
  const kept = Object.entries(widths ?? {}).filter(([name]) => name !== property)
  return {
    ...rest,
    properties: display.properties.filter((p) => p !== property),
    ...(kept.length === 0 ? {} : { widths: Object.fromEntries(kept) }),
  }
}

/**
 * The display after a column is released at `width`: 0 removes the property, as turning its chip
 * off does, and any other width is saved for it.
 */
export function releasedAt(display: Display, property: RowProperty, width: number): Display {
  if (width <= 0) return withoutProperty(display, property)
  return { ...display, widths: { ...display.widths, [property]: width } }
}

/** True when two displays draw every listed column at the same width. */
export const sameWidths = (a: Display, b: Display): boolean =>
  a.properties.every((p) => (a.widths?.[p] ?? SLOT_WIDTH[p]) === (b.widths?.[p] ?? SLOT_WIDTH[p]))
