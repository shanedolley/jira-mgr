/**
 * The rules of editing a summary from a row, kept apart from the components so a test needs no DOM.
 */

/**
 * How long a second click on the summary waits before it opens the editor. A double-click opens
 * the issue page instead, so the modal waits out the second click rather than opening under it.
 */
export const DOUBLE_CLICK_MS = 300

export interface SummaryClick {
  /** The row was active before this click, so the click did not select it. */
  active: boolean
  /** The Peek shows the row's issue. */
  selected: boolean
  /** `MouseEvent.detail`: 1 for a first click, more inside a double-click. */
  detail: number
  shiftKey: boolean
  /** The click landed on the summary text. */
  onSummary: boolean
  /** The click landed on the pencil. */
  onPencil: boolean
}

/**
 * What a click on an issue row does to its summary: `now` for the pencil, `later` for a second
 * click on the summary of the row that is already active and in the Peek (the first click only
 * selects), and `null` for every other click. A Shift+click checks a range, so it never edits.
 */
export function summaryClick(click: SummaryClick): 'now' | 'later' | null {
  if (click.shiftKey) return null
  if (click.onPencil) return 'now'
  return click.onSummary && click.active && click.selected && click.detail === 1 ? 'later' : null
}

/** What saving a draft does: nothing new (`unchanged`), a refusal (`empty`), or a write of `summary`. */
export type SummaryDraft =
  { kind: 'unchanged' } | { kind: 'empty' } | { kind: 'save'; summary: string }

/** Reads the typed summary against the issue's: trimmed, never empty, and a write only when it differs. */
export function readSummaryDraft(draft: string, current: string): SummaryDraft {
  const summary = draft.trim()
  if (summary === '') return { kind: 'empty' }
  return summary === current ? { kind: 'unchanged' } : { kind: 'save', summary }
}
