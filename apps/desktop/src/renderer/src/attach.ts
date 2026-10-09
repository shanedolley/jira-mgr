import { useRef, useState } from 'react'

import { ATTACHMENT_LIMIT_BYTES, type AddAttachmentArgs } from '../../shared/ipc'
import { failureNotice } from './activity'
import { useAttachFile } from './activityQueries'
import type { Notice } from './create'

/** What `attachFiles` needs from outside, so a test needs no Electron and no query client. */
export interface AttachDeps {
  send: (file: Omit<AddAttachmentArgs, 'key'>) => Promise<unknown>
  /** A file is about to be sent. */
  start: (name: string) => void
  /** A file is done, sent or not. */
  finish: (name: string) => void
  fail: (notice: Notice) => void
}

const limitMb = String(ATTACHMENT_LIMIT_BYTES / 1_000_000)

/**
 * Sends the files one at a time, in order. A file that is empty, over the limit or unreadable (a
 * dropped folder) is reported and skipped, and a failed upload never stops the next one.
 */
export async function attachFiles(files: readonly File[], deps: AttachDeps): Promise<void> {
  for (const file of files) {
    const refuse = (reason: string) => {
      deps.fail(failureNotice(`${file.name} was not attached`, reason))
    }
    if (file.size === 0) {
      refuse('The file is empty.')
      continue
    }
    if (file.size > ATTACHMENT_LIMIT_BYTES) {
      refuse(`It is over the ${limitMb} MB limit.`)
      continue
    }
    deps.start(file.name)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await deps.send({ filename: file.name, mimeType: file.type, bytes })
    } catch (error) {
      refuse(error instanceof Error ? error.message : String(error))
    } finally {
      deps.finish(file.name)
    }
  }
}

/**
 * Attaches files to one issue. `uploading` names the files still going up, for the section to
 * show. Drops that arrive while an upload runs queue behind it.
 */
export function useAttach(issueKey: string, onNotice: (notice: Notice) => void) {
  const send = useAttachFile(issueKey)
  const [sending, setSending] = useState<{ key: string; name: string }[]>([])
  const queue = useRef<Promise<void>>(Promise.resolve())

  function attach(files: readonly File[]): void {
    queue.current = queue.current.then(() =>
      attachFiles(files, {
        send: (file) => send.mutateAsync(file),
        start: (name) => {
          setSending((held) => [...held, { key: issueKey, name }])
        },
        finish: (name) => {
          setSending((held) => {
            const at = held.findIndex((item) => item.key === issueKey && item.name === name)
            return held.filter((_, index) => index !== at)
          })
        },
        fail: onNotice,
      }),
    )
  }

  return {
    attach,
    uploading: sending.filter((item) => item.key === issueKey).map((item) => item.name),
  }
}
