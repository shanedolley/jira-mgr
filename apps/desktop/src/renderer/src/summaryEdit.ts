/**
 * The rules of editing a summary from a row, kept apart from the components so a test needs no DOM.
 */

export interface SummaryClick {
  shiftKey: boolean
  /** The click landed on the summary text. */
  onSummary: boolean
}

/**
 * Whether a click on an issue row asks for the summary editor: a single click on the summary text.
 * A Shift+click checks a range, so it never edits.
 */
export const summaryClick = (click: SummaryClick): boolean => click.onSummary && !click.shiftKey

/** What saving a draft does: nothing new (`unchanged`), a refusal (`empty`), or a write of `summary`. */
export type SummaryDraft =
  { kind: 'unchanged' } | { kind: 'empty' } | { kind: 'save'; summary: string }

/** Reads the typed summary against the issue's: trimmed, never empty, and a write only when it differs. */
export function readSummaryDraft(draft: string, current: string): SummaryDraft {
  const summary = draft.trim()
  if (summary === '') return { kind: 'empty' }
  return summary === current ? { kind: 'unchanged' } : { kind: 'save', summary }
}
