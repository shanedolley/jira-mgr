import { JiraMgrError } from '@jira-mgr/core'
import {
  attachmentContent,
  attachmentMediaId,
  listAttachments,
  type Attachment,
} from '@jira-mgr/core/extras'
import type { HttpClient } from '@jira-mgr/core/http'

import { IMAGE_TYPES, PREVIEW_LIMIT_BYTES, type ImageResult } from '../shared/ipc'
import { imageType } from './images'

/** Image attachments resolved to their media ids at once, per lookup. */
const BATCH = 4
/** Image reads in flight at once, so a page of large images does not saturate the connection. */
const MAX_READS = 4
/** How long a media id that no attachment matches stays missing, and the least between list re-reads. */
const MISS_MS = 30_000

interface Entry {
  /** The issue's attachments as last listed, and the ones added by this app since. */
  attachments: Attachment[] | null
  listing: Promise<void> | null
  relisting: Promise<void> | null
  relistedAt: number
  /** Each attachment's media id read, started or finished, so none is read twice. */
  reads: Map<string, Promise<void>>
  byMedia: Map<string, Attachment>
  missing: Map<string, number>
}

const notFound = () =>
  new JiraMgrError('not_found', "That image is not one of this issue's attachments.")

export interface MediaIndex {
  /** The bytes of the image attachment whose media id a description embeds. */
  image(key: string, mediaId: string): Promise<ImageResult>
  /** Records an attachment this app just uploaded, with the media id Jira gave it. */
  add(key: string, attachment: Attachment, mediaId: string): void
  clear(): void
}

/**
 * The media id of a `media` node is not an attachment id, and the attachment responses carry no
 * media id. This finds the attachment behind an id by reading the content redirect of each image
 * attachment of the issue, lazily and once, and keeps the pairs until logout.
 */
export function createMediaIndex(http: HttpClient, now: () => number = Date.now): MediaIndex {
  const entries = new Map<string, Entry>()
  let running = 0
  const waiting: (() => void)[] = []

  async function limited<T>(run: () => Promise<T>): Promise<T> {
    if (running >= MAX_READS) await new Promise<void>((resolve) => waiting.push(resolve))
    running++
    try {
      return await run()
    } finally {
      running--
      waiting.shift()?.()
    }
  }

  function entry(key: string): Entry {
    let found = entries.get(key)
    if (found === undefined) {
      found = {
        attachments: null,
        listing: null,
        relisting: null,
        relistedAt: Number.NEGATIVE_INFINITY,
        reads: new Map(),
        byMedia: new Map(),
        missing: new Map(),
      }
      entries.set(key, found)
    }
    return found
  }

  function list(key: string, e: Entry): Promise<void> {
    e.listing ??= listAttachments(http, key)
      .then((attachments) => {
        e.attachments = attachments
      })
      .finally(() => {
        e.listing = null
      })
    return e.listing
  }

  /** Starts reading the media id of one attachment, unless a read already started. */
  function read(e: Entry, attachment: Attachment): Promise<void> {
    let task = e.reads.get(attachment.id)
    if (task === undefined) {
      task = attachmentMediaId(http, attachment.id).then(
        (mediaId) => {
          e.byMedia.set(mediaId, attachment)
        },
        (error: unknown) => {
          e.reads.delete(attachment.id)
          throw error
        },
      )
      e.reads.set(attachment.id, task)
    }
    return task
  }

  /** Reads image attachments in batches until one holds `mediaId`, or none is left to read. */
  async function resolve(e: Entry, mediaId: string): Promise<Attachment | undefined> {
    for (;;) {
      const found = e.byMedia.get(mediaId)
      if (found !== undefined) return found
      const unread = (e.attachments ?? []).filter(
        (a) => !e.reads.has(a.id) && a.mimeType?.startsWith('image/') === true,
      )
      if (unread.length > 0) {
        await Promise.all(unread.slice(0, BATCH).map((a) => read(e, a)))
        continue
      }
      // Another lookup may still be reading the rest: wait for it, then look once more.
      const outstanding = [...e.reads.values()]
      await Promise.allSettled(outstanding)
      return e.byMedia.get(mediaId)
    }
  }

  async function find(key: string, mediaId: string): Promise<Attachment> {
    const e = entry(key)
    const known = e.byMedia.get(mediaId)
    if (known !== undefined) return known
    const missingUntil = e.missing.get(mediaId)
    if (missingUntil !== undefined && missingUntil > now()) throw notFound()
    if (e.attachments === null) await list(key, e)
    let hit = await resolve(e, mediaId)
    if (hit !== undefined) return hit
    // The image may have been attached in Jira since the list was read.
    if (e.relisting !== null || now() - e.relistedAt >= MISS_MS) {
      if (e.relisting === null) {
        e.relistedAt = now()
        e.relisting = listAttachments(http, key)
          .then((attachments) => {
            e.attachments = attachments
          })
          .finally(() => {
            e.relisting = null
          })
      }
      await e.relisting
      hit = await resolve(e, mediaId)
      if (hit !== undefined) return hit
    }
    e.missing.set(mediaId, now() + MISS_MS)
    throw notFound()
  }

  return {
    image: (key, mediaId) =>
      limited(async () => {
        const attachment = await find(key, mediaId)
        const declared = IMAGE_TYPES.find((type) => type === attachment.mimeType)
        if (declared === undefined || attachment.size > PREVIEW_LIMIT_BYTES) {
          throw new JiraMgrError(
            'validation_failed',
            'This attachment is too large to preview, or is not an image the app shows.',
          )
        }
        const { bytes } = await attachmentContent(http, attachment.id, {
          maxBytes: PREVIEW_LIMIT_BYTES,
        })
        // Jira's header is not trusted: only the bytes decide what the renderer is handed.
        const type = imageType(bytes)
        if (type === null) {
          throw new JiraMgrError(
            'validation_failed',
            'This attachment is not an image the app shows.',
          )
        }
        return { mimeType: type, bytes }
      }),
    add(key, attachment, mediaId) {
      const e = entry(key)
      e.byMedia.set(mediaId, attachment)
      e.reads.set(attachment.id, Promise.resolve())
      e.missing.delete(mediaId)
      if (e.attachments !== null && !e.attachments.some((a) => a.id === attachment.id)) {
        e.attachments = [...e.attachments, attachment]
      }
    },
    clear() {
      entries.clear()
    },
  }
}
