import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import type { AttachmentItem } from '../../shared/ipc'
import { failureNotice, formatSize, formatWhen } from './activity'
import { useAttachments, useDownloadAttachment } from './activityQueries'
import type { Notice } from './create'
import { DropZone } from './DropZone'
import { attachmentListKey } from './queries'
import { BUTTON, QueryBody, Section } from './Section'
import { useDoneUploads } from './uploads'

interface AttachmentsSectionProps {
  issueKey: string
  /** Attaches the files; the same function every drop on the page uses. */
  attach: (files: File[]) => void
  /** Names of the files still going up. */
  uploading: string[]
  onNotice: (notice: Notice) => void
}

/**
 * The Attachments section: every attachment of any type with a Download button, an Attach file
 * button, and the "Attach file to issue" drop zone that lights up with the description's.
 */
export function AttachmentsSection({
  issueKey,
  attach,
  uploading,
  onNotice,
}: AttachmentsSectionProps) {
  const client = useQueryClient()
  const attachments = useAttachments(issueKey)
  const download = useDownloadAttachment(issueKey)
  const embedded = useDoneUploads(issueKey)
  const picker = useRef<HTMLInputElement>(null)

  // An image embedded in the description or a comment is an attachment too: list it.
  useEffect(() => {
    if (embedded > 0) void client.invalidateQueries({ queryKey: attachmentListKey(issueKey) })
  }, [client, embedded, issueKey])

  function save(attachment: AttachmentItem) {
    download
      .mutateAsync(attachment.id)
      .then((result) => {
        if (result.saved) {
          onNotice({ title: `Saved ${result.filename}`, notes: [], warned: false })
        }
      })
      .catch((error: unknown) => {
        onNotice(
          failureNotice(
            `Could not download ${attachment.filename}`,
            error instanceof Error ? error.message : String(error),
          ),
        )
      })
  }

  return (
    <DropZone
      label="Attach file to issue"
      onFiles={(files) => {
        attach(files)
      }}
    >
      <Section
        title="Attachments"
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                picker.current?.click()
              }}
              className={`${BUTTON} ml-auto`}
            >
              Attach file
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              aria-label="Choose files to attach"
              onChange={(event) => {
                attach(Array.from(event.target.files ?? []))
                // Chosen again, the same file must still raise a change.
                event.target.value = ''
              }}
            />
          </>
        }
      >
        {uploading.map((name, index) => (
          <p key={`${name}-${String(index)}`} role="status" className="text-muted">
            Uploading {name}
          </p>
        ))}
        <QueryBody query={attachments} loading="Loading attachments" what="the attachments">
          {(list) =>
            list.length === 0 ? (
              uploading.length === 0 && <p className="text-muted">No attachments</p>
            ) : (
              <ul className="divide-y divide-line rounded-md border border-line">
                {list.map((attachment) => (
                  <li key={attachment.id} className="flex min-h-8 items-center gap-3 px-3 py-1">
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {attachment.filename}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {formatSize(attachment.size)}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {attachment.author?.displayName ?? 'Unknown user'},{' '}
                      {formatWhen(attachment.created)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Download ${attachment.filename}`}
                      disabled={download.isPending && download.variables === attachment.id}
                      onClick={() => {
                        save(attachment)
                      }}
                      className={BUTTON}
                    >
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryBody>
      </Section>
    </DropZone>
  )
}
