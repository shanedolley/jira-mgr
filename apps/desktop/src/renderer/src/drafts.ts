import type { AdfDoc, EditorDoc } from '@jira-mgr/core/adf'

/** Unsaved text of one issue's description, and the description it was written against. */
export interface Draft {
  doc: EditorDoc
  base: AdfDoc | null
}

const drafts = new Map<string, Draft>()
const listeners = new Set<() => void>()

/** Blocks a quit or reload while a draft exists, so main can ask first. */
function blockUnload(event: BeforeUnloadEvent): false {
  event.preventDefault()
  return false
}

function changed(): void {
  // The renderer has no `window` under the unit tests, which cover the map and not the prompt.
  if (typeof window !== 'undefined') window.onbeforeunload = drafts.size > 0 ? blockUnload : null
  for (const listener of listeners) listener()
}

/** The draft kept for the issue, or `undefined`. Opening the issue's page restores it. */
export const getDraft = (key: string): Draft | undefined => drafts.get(key)

/** Keeps the draft for the issue until it is saved or discarded. The session holds it, never the disk. */
export function putDraft(key: string, draft: Draft): void {
  drafts.set(key, draft)
  changed()
}

/** Forgets the issue's draft, after a save or a discard. */
export function dropDraft(key: string): void {
  if (drafts.delete(key)) changed()
}

/** Forgets every draft, on logout. */
export function clearDrafts(): void {
  if (drafts.size === 0) return
  drafts.clear()
  changed()
}

/** How many issues hold an unsaved description. */
export const draftCount = (): number => drafts.size

export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
