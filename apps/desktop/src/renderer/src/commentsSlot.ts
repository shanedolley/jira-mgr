import type { Issue } from '@jira-mgr/core'
import { createContext, useContext } from 'react'

/**
 * Opens the Comments modal for an issue. The Shell provides it; outside the Shell the Comments slot
 * is plain. The slot passes the issue itself, as the Logged slot does: the Sprint page lists
 * issues, such as a Done one, that the Shell's list does not hold.
 */
export const CommentsModalContext = createContext<((issue: Issue) => void) | null>(null)

export function useOpenComments(): ((issue: Issue) => void) | null {
  return useContext(CommentsModalContext)
}

/** A count as the badge prints it: `99+` from 100. */
export const badgeText = (count: number): string => (count >= 100 ? '99+' : String(count))

/** A slot's title and name: `3 comments`, `1 comment`, `No comments`, and `Comments` while the count is not loaded yet. */
export const commentsName = (count: number | undefined): string =>
  count === undefined
    ? 'Comments'
    : count === 0
      ? 'No comments'
      : `${String(count)} comment${count === 1 ? '' : 's'}`
