import type { Issue } from '@jira-mgr/core'
import { createContext, useContext } from 'react'

/**
 * Opens the Log work modal for an issue. The Shell provides it; outside the Shell the Logged slot
 * is plain text. The slot passes the issue itself: the Sprint page lists issues, such as a Done
 * one, that the Shell's list does not hold.
 */
export const LogWorkContext = createContext<((issue: Issue) => void) | null>(null)

export function useLogWork(): ((issue: Issue) => void) | null {
  return useContext(LogWorkContext)
}

/** The issue the modal shows: the Shell's current copy, else the one the slot passed. */
export function loggedIssue(issues: readonly Issue[], held: Issue | null): Issue | null {
  return held === null ? null : (issues.find((i) => i.key === held.key) ?? held)
}
