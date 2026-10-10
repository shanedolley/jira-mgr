import { createContext, useContext } from 'react'

import type { Notice } from './create'
import type { UndoEntry } from './undo'

export interface NoticeOptions {
  /** The issue the toast's Open button goes to. */
  openKey?: string
  /** The edit the toast's Undo button takes back. */
  entry?: UndoEntry
  /** Puts a Retry button on the toast. It sends the failed edit again. */
  retry?: () => void
  /** The issue whose Tree row flashes, so the eye finds the value that came back. */
  flash?: string
}

/** Shows a notice in the corner of the window. */
export type Notify = (notice: Notice, options?: NoticeOptions) => void

export const NotifyContext = createContext<Notify | null>(null)

/** The Shell's way to tell the user something, for a control that sits deep inside it. */
export function useNotify(): Notify {
  const notify = useContext(NotifyContext)
  if (notify === null) throw new Error('useNotify needs a Shell above it.')
  return notify
}
