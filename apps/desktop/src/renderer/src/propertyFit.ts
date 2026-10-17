import type { RowProperty } from '@jira-mgr/core/display'

/** The pixel width of each property's slot in `TreeRow.tsx`. Change them together. */
const SLOT_WIDTH: Record<RowProperty, number> = {
  labels: 96,
  sprint: 104,
  estimate: 64,
  logged: 64,
  remaining: 64,
  remainingPercent: 48,
  due: 96,
  created: 72,
  updated: 72,
}

const GAP = 8

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
 * How many of `properties`, from the first, fit in every row of a Tree `rowWidth` wide: the
 * deepest row (`level`, indented 16px a level) with the widest `extras` sets how much room is left,
 * so the same slots show in every row and the columns line up. The trailing properties drop first.
 */
export function fittingCount(
  properties: readonly RowProperty[],
  rowWidth: number,
  level: number,
  extras: number,
): number {
  // Eight gaps between the nine items of a row: chevron, type, status, key, title, the pencil,
  // priority, the strip and the avatar. Each extra brings its own gap, counted in `extras`.
  const room = rowWidth - CHROME - (4 + (level - 1) * 16) - extras - GAP * 8
  let used = 0
  let count = 0
  for (const property of properties) {
    used += SLOT_WIDTH[property] + (count > 0 ? GAP : 0)
    if (used > room) break
    count++
  }
  return count
}
