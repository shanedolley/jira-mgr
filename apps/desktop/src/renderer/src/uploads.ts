import type { AdfNode } from '@jira-mgr/core/adf'
import { useSyncExternalStore } from 'react'

import { IMAGE_TYPES, type AddImageArgs, type ImageType } from '../../shared/ipc'
import { call } from './ipc'

export type UploadState =
  | { status: 'uploading' }
  | { status: 'done'; node: AdfNode }
  | { status: 'failed'; message: string }

export interface Upload {
  key: string
  filename: string
  /** A local object URL of the file, shown while it uploads. */
  preview: string
  state: UploadState
}

/** What an upload needs from outside, so a test needs no Electron and no image decoder. */
export interface UploadDeps {
  send: (args: AddImageArgs) => Promise<{ node: AdfNode }>
  measure: (file: File) => Promise<{ width: number; height: number } | null>
  createUrl: (file: File) => string
  revokeUrl: (url: string) => void
}

const defaults: UploadDeps = {
  send: (args) => call('attachments:addImage', args),
  async measure(file) {
    // A file the browser cannot decode uploads without its size.
    try {
      const bitmap = await createImageBitmap(file)
      const { width, height } = bitmap
      bitmap.close()
      return { width, height }
    } catch {
      return null
    }
  },
  createUrl: (file) => URL.createObjectURL(file),
  revokeUrl: (url) => {
    URL.revokeObjectURL(url)
  },
}

interface Entry extends Upload {
  file: File
}

/**
 * Uploads by id, for the session. A document holds only the id, so undo never replays an upload,
 * and the store outlives the editor, so an upload finishes even when the page is left.
 */
const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
let deps = defaults

const emit = () => {
  for (const listener of listeners) listener()
}

function setState(id: string, state: UploadState): void {
  const entry = entries.get(id)
  if (entry === undefined) return
  entries.set(id, { ...entry, state })
  emit()
}

async function run(id: string): Promise<void> {
  const entry = entries.get(id)
  if (entry === undefined) return
  try {
    const bytes = new Uint8Array(await entry.file.arrayBuffer())
    const size = await deps.measure(entry.file)
    const mimeType = IMAGE_TYPES.find((type): type is ImageType => type === entry.file.type)
    if (mimeType === undefined)
      throw new Error('Only PNG, JPEG, GIF and WebP images can be embedded.')
    const { node } = await deps.send({
      key: entry.key,
      filename: entry.filename,
      mimeType,
      bytes,
      ...size,
    })
    setState(id, { status: 'done', node })
  } catch (error) {
    setState(id, {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Starts uploading `file` to the issue and returns the id the document holds meanwhile. */
export function startUpload(key: string, file: File, override?: UploadDeps): string {
  if (override !== undefined) deps = override
  const id = crypto.randomUUID()
  entries.set(id, {
    key,
    filename: file.name,
    file,
    preview: deps.createUrl(file),
    state: { status: 'uploading' },
  })
  emit()
  void run(id)
  return id
}

/** Tries a failed upload again. */
export function retryUpload(id: string): void {
  if (entries.get(id)?.state.status !== 'failed') return
  setState(id, { status: 'uploading' })
  void run(id)
}

/** Forgets an upload and revokes its preview. The attachment, if it landed, stays on the issue. */
export function removeUpload(id: string): void {
  const entry = entries.get(id)
  if (entry === undefined) return
  deps.revokeUrl(entry.preview)
  entries.delete(id)
  emit()
}

/**
 * Revokes an upload's preview once the saved image has taken its place, and keeps the upload's
 * result. A redo that brings the placeholder back shows no preview, only the finished image.
 */
export function releasePreview(id: string): void {
  const entry = entries.get(id)
  if (entry === undefined || entry.preview === '') return
  deps.revokeUrl(entry.preview)
  entries.set(id, { ...entry, preview: '' })
  emit()
}

/** Forgets every upload and revokes every preview, on logout. */
export function clearUploads(): void {
  for (const entry of entries.values()) deps.revokeUrl(entry.preview)
  entries.clear()
  emit()
}

export const getUpload = (id: string): Upload | undefined => entries.get(id)

/** Restores the real dependencies after a test replaced them. */
export function resetUploads(): void {
  clearUploads()
  deps = defaults
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The upload with this id, kept current. `undefined` for an id the store does not know. */
export function useUpload(id: string | null): Upload | undefined {
  return useSyncExternalStore(subscribe, () => (id === null ? undefined : entries.get(id)))
}
