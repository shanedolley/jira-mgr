import type { AdfDoc, AdfNode, EditorDoc } from '@jira-mgr/core/adf'

import { descriptionOf, fillImages, pastedImages, type FailedFile } from './create'

/** What `embedPasted` needs from outside, so a test needs no Electron and no query client. */
export interface EmbedDeps {
  /** Uploads one staged image to the new issue and resolves with its node, or rejects with why not. */
  upload: (id: string) => Promise<{ node: AdfNode } | { failed: string }>
  /** The file name a staged image was pasted under. */
  name: (id: string) => string
  /** Writes the description. `changed` means Jira's no longer matches `base`, so nothing was written. */
  save: (description: AdfDoc, base: AdfDoc | null) => Promise<'saved' | 'changed'>
}

export interface EmbedResult {
  /** Images that did not upload. They are not in the description. */
  failed: FailedFile[]
  /** How the description patch went: `null` when there was nothing to patch or it saved. */
  patch: { kind: 'changed' } | { kind: 'failed'; reason: string } | null
  /** How many images uploaded, whether or not the description took them. */
  uploaded: number
}

/**
 * Uploads the images pasted into the create dialog's description, one at a time, then writes the
 * description again with each upload in place. `base` is the description Jira holds for the new
 * issue, which the write is checked against. An upload that fails leaves its image out and does
 * not stop the next; a write that fails or finds the description changed leaves the uploads on
 * the issue as attachments. The issue and its text are never touched by a failure.
 */
export async function embedPasted(
  doc: EditorDoc,
  base: AdfDoc | null,
  deps: EmbedDeps,
): Promise<EmbedResult> {
  const nodes = new Map<string, AdfNode>()
  const failed: FailedFile[] = []
  for (const id of pastedImages(doc)) {
    const name = deps.name(id)
    try {
      const result = await deps.upload(id)
      if ('node' in result) nodes.set(id, result.node)
      else failed.push({ name, reason: result.failed })
    } catch (error) {
      failed.push({ name, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  if (nodes.size === 0) return { failed, patch: null, uploaded: 0 }
  const description = descriptionOf(fillImages(doc, nodes))
  const uploaded = nodes.size
  // An uploaded image is content, so the description is never empty here.
  if (description === null) return { failed, patch: null, uploaded }
  try {
    const saved = await deps.save(description, base)
    if (saved === 'changed') return { failed, patch: { kind: 'changed' }, uploaded }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { failed, patch: { kind: 'failed', reason }, uploaded }
  }
  return { failed, patch: null, uploaded }
}

const images = (count: number) => (count === 1 ? 'image' : 'images')

/** The notes for what `embedPasted` could not do, one sentence each, naming the issue. */
export function imageNotes(key: string, result: EmbedResult): string[] {
  const { uploaded } = result
  const notes = result.failed.map(
    ({ name, reason }) =>
      `Could not attach ${name} to ${key}. ${reason} It is not in the description.`,
  )
  if (result.patch?.kind === 'changed') {
    notes.push(
      `The description of ${key} changed in Jira, so the pasted ${images(uploaded)} ${uploaded === 1 ? 'was' : 'were'} attached to it but not placed in the description.`,
    )
  } else if (result.patch?.kind === 'failed') {
    notes.push(
      `Could not put the pasted ${images(uploaded)} into the description of ${key}. ${result.patch.reason} ${uploaded === 1 ? 'It is' : 'They are'} attached to the issue.`,
    )
  }
  return notes
}
