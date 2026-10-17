import { createContext, useContext } from 'react'

/**
 * Opens the Log work modal for an issue key. The Shell provides it; outside the Shell the Logged
 * slot is plain text.
 */
export const LogWorkContext = createContext<((key: string) => void) | null>(null)

export function useLogWork(): ((key: string) => void) | null {
  return useContext(LogWorkContext)
}
