import type { Issue } from '@jira-mgr/core'
import { useEffect, useState } from 'react'

import { call } from './ipc'
import { useDebounced } from './useDebounced'

/** The fewest characters worth a request: shorter text matches most of the project. */
export const TEXT_MIN = 3

/** How long the query holds still before it goes to Jira. */
export const TEXT_DEBOUNCE_MS = 300

export type TextSearch =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; issues: Issue[] }
  | { status: 'error'; message: string }

type Settled = { query: string; issues: Issue[] } | { query: string; message: string }

/**
 * Jira's `text ~` search for what the palette field holds, once the field has held still for
 * `TEXT_DEBOUNCE_MS`. Main aborts the request in flight when the next one arrives, so a new query
 * cancels the old one and the old one's answer is never used.
 */
export function useTextSearch(query: string): TextSearch {
  const text = query.trim()
  const settledText = useDebounced(text, TEXT_DEBOUNCE_MS)
  const [settled, setSettled] = useState<Settled>()
  const wanted = settledText.length >= TEXT_MIN ? settledText : null

  useEffect(() => {
    if (wanted === null) return
    let current = true
    void call('issues:searchText', { query: wanted }).then(
      (issues) => {
        // `null` is main saying a newer search replaced this one.
        if (current && issues !== null) setSettled({ query: wanted, issues })
      },
      (error: unknown) => {
        if (current) {
          setSettled({
            query: wanted,
            message: error instanceof Error ? error.message : 'Jira did not answer.',
          })
        }
      },
    )
    return () => {
      current = false
    }
  }, [wanted])

  if (text.length < TEXT_MIN) return { status: 'idle' }
  if (settled?.query !== text) return { status: 'searching' }
  return 'issues' in settled
    ? { status: 'done', issues: settled.issues }
    : { status: 'error', message: settled.message }
}
