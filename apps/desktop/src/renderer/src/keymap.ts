/**
 * The one table of global shortcuts (D7). The Shell listens once and asks `resolveKey` what a
 * keystroke means, so every guard lives in one place and tests need no DOM. The Tree's own keys
 * (`J`, `K`, arrows, `Space`, `Enter`) stay in `tree.ts`: they act on the Tree element, and
 * `resolveKey` never sees them because they are not letters it owns.
 */

/** The shortcuts that open a property of the active issue, and the key each one answers to. */
export const PROPERTY_KEYS = {
  status: 'S',
  assignee: 'A',
  labels: 'L',
  priority: 'P',
  edit: 'E',
} as const

export type PropertyCommand = keyof typeof PROPERTY_KEYS

export type Command =
  PropertyCommand | 'create' | 'timer' | 'filter' | 'palette' | 'undo' | 'escape'

export interface KeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
  repeat: boolean
  isComposing: boolean
}

/** Anything with `closest`, so a test needs no DOM. */
export interface KeyTarget {
  closest(selector: string): unknown
}

/** Controls where a letter is typing or choosing, not a command. */
const OWN_KEYS =
  'input, textarea, select, dialog, [popover], [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="alertdialog"], [role="combobox"], [role="listbox"], [role="menu"]'

/**
 * The places a letter acts on an issue: the Tree, the Peek and the issue page, each marked
 * `data-key-scope`. A letter on a sidebar or toolbar button does nothing.
 */
const LETTER_SCOPES = '[data-key-scope]'

/** Where `Cmd+K` must not open a second layer: over a dialog or an open picker. */
const OVERLAYS = 'dialog, [popover]'

const inside = (target: KeyTarget | null, selector: string) =>
  target !== null && target.closest(selector) !== null

/**
 * Whether the key went to a text field, picker, dialog or editor, which keep their letters.
 * The same test keeps `Esc` and `Cmd+Z` for the control that has focus.
 */
export function keepsLetters(target: KeyTarget | null): boolean {
  return inside(target, OWN_KEYS)
}

const LETTERS = new Map<string, Command>([
  ['c', 'create'],
  ['t', 'timer'],
  ['s', 'status'],
  ['a', 'assignee'],
  ['l', 'labels'],
  ['p', 'priority'],
  ['e', 'edit'],
])

/**
 * What a keystroke asks for, or `null` when it is not ours. A letter is a command only alone: not
 * with Cmd, Ctrl or Alt, not held down, not part of an IME composition, not already handled, not
 * typed into a field, picker, dialog or editor, and only with focus inside the Tree, the Peek or
 * the issue page. `/` obeys the same rules except the last: it focuses the filter from anywhere. `Cmd+Z` and `Esc` obey the same target rule,
 * so a text field keeps its native undo and a picker keeps its own `Esc`. `Cmd+K` opens from a
 * text field, but not over a dialog or an open picker. Ctrl stands in for Cmd off the Mac.
 */
export function resolveKey(event: KeyEvent, target: KeyTarget | null): Command | null {
  if (event.defaultPrevented || event.isComposing || event.altKey) return null
  const key = event.key.toLowerCase()
  if (event.metaKey || event.ctrlKey) {
    if (event.shiftKey || event.repeat) return null
    if (key === 'k') return inside(target, OVERLAYS) ? null : 'palette'
    if (key === 'z') return keepsLetters(target) ? null : 'undo'
    return null
  }
  if (event.repeat || keepsLetters(target)) return null
  if (key === 'escape') return 'escape'
  if (key === '/') return 'filter'
  if (!inside(target, LETTER_SCOPES)) return null
  return LETTERS.get(key) ?? null
}
