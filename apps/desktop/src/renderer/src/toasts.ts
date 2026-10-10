import type { Notice } from './create'
import type { UndoEntry } from './undo'

/** The toasts on screen at once. */
export const MAX_TOASTS = 2

export interface ToastItem {
  id: number
  notice: Notice
  openKey: string | null
  entry?: UndoEntry
  retry?: () => void
}

/**
 * The toasts after `item` arrives: the last two, newest last. A refusal stays until dismissed, so
 * when the stack is full a plain notice goes first, and the oldest only when none is plain.
 */
export function pushToast(held: readonly ToastItem[], item: ToastItem): ToastItem[] {
  const next = [...held, item]
  while (next.length > MAX_TOASTS) {
    const plain = next.slice(0, -1).findIndex((toast) => !toast.notice.warned)
    next.splice(Math.max(plain, 0), 1)
  }
  return next
}

/** What a screen reader hears for a notice: the title, then each note, each a sentence. */
export const spoken = ({ title, notes }: Notice): string =>
  [title, ...notes].map((line) => (/[.!?]$/.test(line) ? line : `${line}.`)).join(' ')
