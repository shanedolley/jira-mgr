import { useState, useSyncExternalStore, type ReactNode } from 'react'

import { DiscardDialog } from './DiscardDialog'
import { draftCount, subscribeDrafts } from './drafts'
import { useLogout } from './queries'

export interface LogoutFlow {
  /** Logs out, after the discard prompt when drafts are unsaved. */
  request: () => void
  pending: boolean
  error: string | undefined
  /** The discard prompt, or nothing. */
  dialog: ReactNode
}

/** Log out for the user menu and the palette, which share the prompt and the error. */
export function useLogoutFlow(): LogoutFlow {
  const logout = useLogout()
  const unsaved = useSyncExternalStore(subscribeDrafts, draftCount)
  const [confirming, setConfirming] = useState(false)
  return {
    request: () => {
      if (unsaved > 0) setConfirming(true)
      else logout.mutate()
    },
    pending: logout.isPending,
    error: logout.isError ? logout.error.message : undefined,
    dialog: confirming && (
      <DiscardDialog
        title={`Log out and discard ${String(unsaved)} unsaved ${unsaved === 1 ? 'draft' : 'drafts'}?`}
        keepLabel="Keep editing"
        discardLabel="Discard and log out"
        onKeep={() => {
          setConfirming(false)
        }}
        onDiscard={() => {
          setConfirming(false)
          logout.mutate()
        }}
      />
    ),
  }
}
