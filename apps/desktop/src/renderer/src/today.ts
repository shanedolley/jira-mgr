import { dayKey } from '@jira-mgr/core/view-filter'
import { useSyncExternalStore } from 'react'

/**
 * Calls `onChange` at each local midnight, and returns what stops it. The date filters (Overdue,
 * Today, Last 7 days) mean a different set of issues the next day, so the Tree must rebuild then.
 */
export function watchDay(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    timer = setTimeout(() => {
      onChange()
      arm()
    }, midnight.getTime() - now.getTime())
  }
  arm()
  return () => {
    clearTimeout(timer)
  }
}

/** Today's local date as `YYYY-MM-DD`, which changes at local midnight. */
export function useToday(): string {
  return useSyncExternalStore(watchDay, () => dayKey(new Date()))
}
