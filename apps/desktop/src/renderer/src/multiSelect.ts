/**
 * Multi-select by click and key, kept apart from the components so a test needs no DOM. The Tree
 * checks through `tree.ts`; the Sprint page, whose rows are a plain list of keys, checks through
 * the functions here, which sit on the Tree's `toggleChecked`, `checkMore` and `clearSelection`. Those
 * are the toggle (a checkbox click or Cmd+click) and the clear (Esc).
 */
import { checkMore, type TreeState } from './tree'

/** The checked issue keys and the one a Shift+click range starts from. */
export type Selection = Pick<TreeState, 'checked' | 'anchor'>

export const NO_SELECTION: Selection = { checked: new Set<string>(), anchor: null }

/** The modifiers a click carries. */
export interface ClickKeys {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

/** Whether this runs on macOS, where Ctrl+click is a right-click. Read per call so a test can stub it. */
export const onMac = (): boolean => navigator.userAgent.includes('Mac')

/**
 * Whether a click toggles its issue: Cmd on macOS, Ctrl elsewhere. On macOS Ctrl+click stays the
 * context menu, and off macOS the Windows key is nothing.
 */
export const togglesCheck = (click: ClickKeys, mac: boolean = onMac()): boolean =>
  mac ? click.metaKey : click.ctrlKey

/** The keys of `order` from `from` to `to` inclusive, whichever comes first. */
function between(order: readonly string[], from: string, to: string): string[] {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  return a < 0 || b < 0 ? [] : order.slice(Math.min(a, b), Math.max(a, b) + 1)
}

/**
 * A Shift+click on `key`: adds every key from the anchor to it, in `order`, and unchecks nothing.
 * With no anchor the range starts at `active`, the row the pointer is over, and with neither at
 * `key`.
 */
export function rangeTo(
  order: readonly string[],
  selection: Selection,
  key: string,
  active: string | null,
): Selection {
  const from = selection.anchor ?? active ?? key
  return checkMore(selection, between(order, from, key), from)
}

/** Cmd+A: every key of `order`, added to those checked. */
export const checkAll = (order: readonly string[], selection: Selection): Selection => ({
  checked: new Set([...selection.checked, ...order]),
  anchor: selection.anchor ?? order[0] ?? null,
})

/**
 * Shift+Down or Shift+Up: the row `step` away from `active` (stopping at the ends) and the
 * selection with the rows between checked. `null` when no row is active.
 */
export function extendBy(
  order: readonly string[],
  selection: Selection,
  active: string | null,
  step: 1 | -1,
): { active: string; selection: Selection } | null {
  const at = active === null ? -1 : order.indexOf(active)
  if (active === null || at < 0) return null
  const moved = order[Math.min(order.length - 1, Math.max(0, at + step))] ?? active
  return { active: moved, selection: checkMore(selection, between(order, active, moved), active) }
}

/**
 * The selection limited to the keys of `order`, so an issue that left the page is never checked
 * unseen. The same object when nothing needed dropping, so a caller can tell by identity.
 */
export function prune(order: readonly string[], selection: Selection): Selection {
  if (selection.checked.size === 0 && selection.anchor === null) return selection
  const shown = new Set(order)
  const checked = new Set([...selection.checked].filter((key) => shown.has(key)))
  const anchor = selection.anchor !== null && shown.has(selection.anchor) ? selection.anchor : null
  return checked.size === selection.checked.size && anchor === selection.anchor
    ? selection
    : { checked, anchor }
}
