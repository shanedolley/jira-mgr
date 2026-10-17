import { parseEstimate } from '@jira-mgr/core/issue'

/** Shown beside a draft that is not a Jira duration. The issue page's field says the same. */
export const ESTIMATE_HINT = 'Use a duration such as 2h 30m.'

/** What leaving an estimate field with `draft` means. */
export type EstimateCommit =
  /** A new estimate: `text` goes to Jira as it is and `seconds` is what the row shows at once. */
  | { kind: 'save'; text: string; seconds: number }
  /** Nothing to send: the draft is the estimate the issue has. */
  | { kind: 'same' }
  /** Not a duration, or empty on an issue that has an estimate, which Jira cannot clear this way. */
  | { kind: 'invalid' }

/** Reads a draft against the estimate the issue holds, in seconds or `null` for none. */
export function commitDraft(draft: string, current: number | null): EstimateCommit {
  const text = draft.trim()
  if (text === '') return current === null ? { kind: 'same' } : { kind: 'invalid' }
  const seconds = parseEstimate(text)
  if (seconds === null) return { kind: 'invalid' }
  return seconds === current ? { kind: 'same' } : { kind: 'save', text, seconds }
}
