import type { AdfNode } from '@jira-mgr/core/adf'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useContext, useEffect } from 'react'

import { IssueKeyContext } from './editor/context'
import { useAttachmentImage } from './queries'
import { releasePreview, removeUpload, retryUpload, useUpload } from './uploads'

/** The sizes an image's ADF gives: a width the author chose in pixels, else the file's own. */
function sizeOf(single: AdfNode | undefined, media: AdfNode | undefined) {
  const chosen = single?.attrs?.widthType === 'pixel' ? single.attrs.width : undefined
  const own = media?.attrs?.width
  const width = typeof chosen === 'number' ? chosen : typeof own === 'number' ? own : undefined
  const height = media?.attrs?.height
  return {
    width,
    ratio:
      typeof own === 'number' && typeof height === 'number' && own > 0 ? own / height : undefined,
  }
}

const REASONS: Record<string, string> = {
  not_found: "Image not in this issue's attachments. Open the issue in Jira to see it.",
  validation_failed: 'Too large to preview, or not an image. Open it in Jira.',
  permission_denied: 'Jira refused access to this image.',
}

function LoadedImage({ single }: { single: AdfNode }) {
  const issueKey = useContext(IssueKeyContext)
  const media = single.content?.[0]
  const mediaId = typeof media?.attrs?.id === 'string' ? media.attrs.id : ''
  const image = useAttachmentImage(issueKey, mediaId)
  const { width, ratio } = sizeOf(single, media)
  const alt = typeof media?.attrs?.alt === 'string' ? media.attrs.alt : ''
  if (image.isError) {
    return (
      <p role="alert" className="rounded-md border border-line p-2 text-muted">
        {REASONS[image.error.code] ?? 'Could not load this image.'}{' '}
        {REASONS[image.error.code] === undefined && (
          <button
            type="button"
            onClick={() => void image.refetch()}
            className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
          >
            Retry
          </button>
        )}
      </p>
    )
  }
  if (image.data === undefined) {
    return (
      <div
        role="img"
        aria-label={alt === '' ? 'Image loading' : `${alt}, loading`}
        style={{ width, maxWidth: '100%', aspectRatio: ratio }}
        className="grid min-h-12 place-items-center rounded-md bg-hover text-xs text-muted"
      >
        {alt}
      </div>
    )
  }
  return <img src={image.data} alt={alt} style={{ width, maxWidth: '100%' }} />
}

function UploadingImage({
  uploadId,
  onDone,
  onRemove,
}: {
  uploadId: string
  onDone: (node: AdfNode) => void
  onRemove: () => void
}) {
  const issueKey = useContext(IssueKeyContext)
  // An upload of another issue, pasted in from its editor, is not this editor's to embed.
  const found = useUpload(uploadId)
  const upload = found?.key === issueKey ? found : undefined
  const done = upload?.state.status === 'done' ? upload.state.node : null
  useEffect(() => {
    if (done !== null) onDone(done)
  }, [done, onDone])

  if (upload === undefined || upload.state.status === 'failed') {
    const name = upload?.filename ?? 'the image'
    const message =
      upload?.state.status === 'failed' ? upload.state.message : 'The upload was lost.'
    return (
      <div role="alert" className="space-y-1 rounded-md border border-danger p-2">
        <p className="text-danger">
          Could not upload {name}. {message}
        </p>
        <div className="flex gap-2">
          {upload !== undefined && (
            <button
              type="button"
              onClick={() => {
                retryUpload(uploadId)
              }}
              className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
          >
            Remove
          </button>
        </div>
      </div>
    )
  }
  return (
    <figure className="space-y-1">
      {upload.preview !== '' && (
        <img src={upload.preview} alt="" className="max-w-full opacity-50" />
      )}
      <figcaption role="status" className="text-xs text-muted">
        Uploading {upload.filename}
      </figcaption>
    </figure>
  )
}

/**
 * An image in the document. A saved one is fetched through main and shown as an object URL; one
 * being dropped shows its upload, and when the upload is done it writes the finished `mediaSingle`
 * into its own node, outside the undo history.
 */
export function ImageView({ node, editor, getPos, deleteNode, selected }: ReactNodeViewProps) {
  const single = node.attrs.node as AdfNode | null
  const uploadId = node.attrs.uploadId as string | null

  function apply(finished: AdfNode) {
    const pos = getPos()
    if (pos === undefined) return
    editor.view.dispatch(
      editor.state.tr
        .setNodeMarkup(pos, undefined, { ...node.attrs, node: finished, uploadId: null })
        .setMeta('addToHistory', false),
    )
    if (uploadId !== null) releasePreview(uploadId)
  }

  return (
    <NodeViewWrapper
      contentEditable={false}
      className={`my-2 ${selected ? 'outline-2 outline-accent' : ''}`}
    >
      {single !== null ? (
        <LoadedImage single={single} />
      ) : (
        <UploadingImage
          uploadId={uploadId ?? ''}
          onDone={apply}
          onRemove={() => {
            if (uploadId !== null) removeUpload(uploadId)
            deleteNode()
          }}
        />
      )}
    </NodeViewWrapper>
  )
}
