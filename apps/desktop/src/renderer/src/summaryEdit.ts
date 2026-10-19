/**
 * The rules of editing a summary from a row, kept apart from the components so a test needs no DOM.
 */

export interface SummaryClick {
  /** The click checks rows (Shift+click or Cmd+click) instead. */
  checking: boolean
  /** The click landed on the summary text. */
  onSummary: boolean
}

/**
 * Whether a click on an issue row asks for the summary editor: a single click on the summary text.
 * A Shift+click checks a range and a Cmd+click toggles the issue, so neither edits.
 */
export const summaryClick = (click: SummaryClick): boolean => click.onSummary && !click.checking

/** What saving a draft does: nothing new (`unchanged`), a refusal (`empty`), or a write of `summary`. */
export type SummaryDraft =
  { kind: 'unchanged' } | { kind: 'empty' } | { kind: 'save'; summary: string }

/** Reads the typed summary against the issue's: trimmed, never empty, and a write only when it differs. */
export function readSummaryDraft(draft: string, current: string): SummaryDraft {
  const summary = draft.trim()
  if (summary === '') return { kind: 'empty' }
  return summary === current ? { kind: 'unchanged' } : { kind: 'save', summary }
}
