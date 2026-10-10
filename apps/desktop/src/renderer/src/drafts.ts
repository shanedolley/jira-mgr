import type { AdfDoc, EditorDoc } from '@jira-mgr/core/adf'

/** Unsaved text of one issue's description or comment, and the document it was written against. */
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

/** The key under which a comment's unsaved edit is kept, beside the issue's description draft. */
export const commentDraftKey = (issueKey: string, commentId: string): string =>
  `${issueKey}#${commentId}`

/** The key of the text in the comment box that no one has posted yet. */
export const newCommentDraftKey = (issueKey: string): string => `${issueKey}#new`

const belongsTo = (key: string, issueKey: string) =>
  key === issueKey || key.startsWith(`${issueKey}#`)

/** True when the issue's description, or any comment of it, holds unsaved text. */
export const hasDraftsOf = (issueKey: string): boolean =>
  [...drafts.keys()].some((key) => belongsTo(key, issueKey))

/** Forgets every draft of the issue, such as when the issue no longer exists. */
export function dropDraftsOf(issueKey: string): void {
  let dropped = false
  for (const key of [...drafts.keys()]) {
    if (belongsTo(key, issueKey)) dropped = drafts.delete(key) || dropped
  }
  if (dropped) changed()
}

/**
 * Forgets the drafts of the issue's comments that are not in `liveIds`, the comments a list read
 * still found. A comment deleted in Jira never mounts again, so its draft would linger.
 */
export function dropOrphanedCommentDrafts(issueKey: string, liveIds: readonly string[]): void {
  const live = new Set([...liveIds, 'new'].map((id) => commentDraftKey(issueKey, id)))
  let dropped = false
  for (const key of [...drafts.keys()]) {
    if (key.startsWith(`${issueKey}#`) && !live.has(key)) dropped = drafts.delete(key) || dropped
  }
  if (dropped) changed()
}

/** How many drafts hold unsaved text: descriptions and comments. */
export const draftCount = (): number => drafts.size

export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
