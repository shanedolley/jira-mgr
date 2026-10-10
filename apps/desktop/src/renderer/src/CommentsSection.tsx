import type { AdfDoc } from '@jira-mgr/core/adf'
import { useRef, useState, type KeyboardEvent } from 'react'

import type { CommentItem, CurrentUser } from '../../shared/ipc'
import { failureNotice, formatWhen, safeMarkdown } from './activity'
import { useAddComment, useComments, useDeleteComment, useEditComment } from './activityQueries'
import { AdfEditor, type AdfEditorHandle } from './AdfEditor'
import type { Notice } from './create'
import { DiscardDialog } from './DiscardDialog'
import { commentDraftKey, dropDraft, getDraft, newCommentDraftKey, putDraft } from './drafts'
import { conflictOf } from './queries'
import { BUTTON, DANGER_BUTTON, QueryBody, Section } from './Section'

interface CommentsSectionProps {
  issueKey: string
  me: CurrentUser | undefined
  /** Puts focus back on the page once an editor's controls are gone. */
  onLeave: () => void
  onNotice: (notice: Notice) => void
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** `read` shows the comment, `edit` changes it, `saving` waits on Jira with the text still in the editor. */
type Phase = 'read' | 'edit' | 'saving'

interface CommentRowProps extends Omit<CommentsSectionProps, 'me'> {
  comment: CommentItem
  /** Only the author edits or deletes a comment (Q34). */
  mine: boolean
}

function CommentRow({ issueKey, comment, mine, onLeave, onNotice }: CommentRowProps) {
  // An edit left unsaved when the page was left comes back open, as the description's does.
  const draftKey = commentDraftKey(issueKey, comment.id)
  const [restored] = useState(() => getDraft(draftKey))
  const [phase, setPhase] = useState<Phase>(restored === undefined ? 'read' : 'edit')
  // The comment as the edit began, which Jira's must still match when the edit is saved.
  const [base, setBase] = useState<AdfDoc>(restored?.base ?? comment.body)
  // Jira's comment, when it changed since the edit began.
  const [conflict, setConflict] = useState<AdfDoc | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const dirty = useRef(restored !== undefined)
  const editor = useRef<AdfEditorHandle>(null)
  const edit = useEditComment(issueKey)
  const remove = useDeleteComment(issueKey)
  const who = comment.author?.displayName ?? 'Unknown user'

  function leave() {
    dropDraft(draftKey)
    setPhase('read')
    setProblem(null)
    setConflict(null)
    onLeave()
  }

  async function save(doc: AdfDoc | null, against: AdfDoc = base) {
    if (doc === null) {
      setProblem('A comment cannot be empty.')
      return
    }
    setPhase('saving')
    setProblem(null)
    setConflict(null)
    try {
      await edit.mutateAsync({ commentId: comment.id, body: doc, base: against })
    } catch (error) {
      // The text stays in the editor, so nothing typed is lost.
      const clash = conflictOf(error)
      if (clash?.current != null) setConflict(clash.current)
      else {
        setProblem(
          `Could not save the comment, so Jira still holds the old one. ${reasonOf(error)}`,
        )
      }
      setPhase('edit')
      return
    }
    dirty.current = false
    leave()
  }

  function cancel() {
    if (dirty.current) setDiscarding(true)
    else leave()
  }

  function discard() {
    setDiscarding(false)
    editor.current?.reset(comment.body)
    dirty.current = false
    leave()
  }

  /** Sends the draft over Jira's current comment, which the user chose to overwrite. */
  function saveMine(current: AdfDoc) {
    try {
      const mine = editor.current?.adf() ?? null
      setBase(current)
      void save(mine, current)
    } catch (error) {
      setProblem(reasonOf(error))
    }
  }

  /** Shows Jira's comment and drops the draft. */
  function discardMine(current: AdfDoc) {
    editor.current?.reset(current)
    dirty.current = false
    leave()
  }

  function deleteComment() {
    setConfirming(false)
    dropDraft(draftKey)
    remove.mutateAsync(comment.id).catch((error: unknown) => {
      onNotice(failureNotice('Could not delete the comment', reasonOf(error)))
    })
  }

  function onConfirmKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    setConfirming(false)
  }

  return (
    <li className="space-y-1">
      <div className="flex items-baseline gap-1.5 text-xs text-muted">
        <span className="font-medium text-ink">{who}</span>
        <span aria-hidden>&middot;</span>
        <time dateTime={comment.created}>{formatWhen(comment.created)}</time>
        {comment.updated !== comment.created && <span>(edited)</span>}
      </div>
      {unsupported && (
        <p className="whitespace-pre-wrap break-words">{safeMarkdown(comment.body)}</p>
      )}
      <div hidden={unsupported}>
        <AdfEditor
          ref={editor}
          value={comment.body}
          initial={restored?.doc}
          issueKey={issueKey}
          label={`Comment by ${who}`}
          editing={phase === 'edit'}
          frozen={phase === 'saving'}
          onSave={(doc) => {
            void save(doc)
          }}
          onCancel={cancel}
          onChange={(doc, isDirty) => {
            dirty.current = isDirty
            if (isDirty) putDraft(draftKey, { doc, base })
            else dropDraft(draftKey)
          }}
          onEditRequest={() => undefined}
          onUnsupported={() => {
            setUnsupported(true)
          }}
        />
      </div>
      {phase === 'saving' && (
        <p role="status" className="text-muted">
          Saving
        </p>
      )}
      {conflict !== null && (
        <div role="alert" className="space-y-2 rounded-md border border-danger p-3">
          <p>This comment changed in Jira while you edited.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                saveMine(conflict)
              }}
              className="rounded-md bg-accent px-3 py-1 font-medium text-accent-ink"
            >
              Save mine anyway
            </button>
            <button
              type="button"
              onClick={() => {
                discardMine(conflict)
              }}
              className={BUTTON}
            >
              Discard mine
            </button>
          </div>
        </div>
      )}
      {problem !== null && (
        <p role="alert" className="text-danger">
          {problem}
        </p>
      )}
      {mine && phase === 'read' && !confirming && (
        <div className="flex gap-2">
          {!unsupported && (
            <button
              type="button"
              onClick={() => {
                setProblem(null)
                setBase(comment.body)
                setPhase('edit')
              }}
              className={BUTTON}
            >
              Edit comment
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setConfirming(true)
            }}
            className={BUTTON}
          >
            Delete comment
          </button>
        </div>
      )}
      {confirming && (
        <div
          role="group"
          aria-label="Delete comment"
          onKeyDown={onConfirmKey}
          className="flex items-center gap-2 text-xs"
        >
          <span>Delete this comment?</span>
          <button type="button" onClick={deleteComment} className={DANGER_BUTTON}>
            Delete
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              setConfirming(false)
            }}
            className={BUTTON}
          >
            Keep
          </button>
        </div>
      )}
      {discarding && (
        <DiscardDialog
          title="Discard your changes to the comment?"
          keepLabel="Keep editing"
          discardLabel="Discard"
          onKeep={() => {
            setDiscarding(false)
            editor.current?.focus('end')
          }}
          onDiscard={discard}
        />
      )}
    </li>
  )
}

/** The box that adds a comment: the description's editor, always open, empty and not focused. */
function CommentBox({ issueKey, onLeave }: Pick<CommentsSectionProps, 'issueKey' | 'onLeave'>) {
  const draftKey = newCommentDraftKey(issueKey)
  const [restored] = useState(() => getDraft(draftKey))
  const [posting, setPosting] = useState(false)
  const [typed, setTyped] = useState(restored !== undefined)
  const [problem, setProblem] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const editor = useRef<AdfEditorHandle>(null)
  const busy = useRef(false)
  const add = useAddComment(issueKey)

  async function post(doc: AdfDoc | null) {
    if (doc === null) {
      setProblem('A comment cannot be empty.')
      return
    }
    // A second Cmd+Enter while the first post is in flight must not post twice.
    if (busy.current) return
    busy.current = true
    setPosting(true)
    setProblem(null)
    try {
      await add.mutateAsync(doc)
      editor.current?.reset(null)
      dropDraft(draftKey)
      setTyped(false)
    } catch (error) {
      setProblem(`Could not post the comment. ${reasonOf(error)}`)
    } finally {
      busy.current = false
      setPosting(false)
    }
  }

  function clear() {
    setDiscarding(false)
    editor.current?.reset(null)
    dropDraft(draftKey)
    setTyped(false)
    setProblem(null)
    onLeave()
  }

  return (
    <div className="relative">
      <AdfEditor
        ref={editor}
        value={null}
        initial={restored?.doc}
        issueKey={issueKey}
        label="New comment"
        saveLabel="Comment"
        cancelLabel="Clear"
        autoFocus={false}
        editing={!posting}
        frozen={posting}
        onSave={(doc) => {
          void post(doc)
        }}
        onCancel={() => {
          if (typed) setDiscarding(true)
          else onLeave()
        }}
        onChange={(doc, isDirty) => {
          setTyped(isDirty)
          if (isDirty) putDraft(draftKey, { doc, base: null })
          else dropDraft(draftKey)
        }}
        onEditRequest={() => undefined}
        onUnsupported={() => undefined}
      />
      {!typed && (
        <span aria-hidden className="pointer-events-none absolute left-3 top-3 text-muted">
          Leave a comment
        </span>
      )}
      {posting && (
        <p role="status" className="text-muted">
          Posting
        </p>
      )}
      {problem !== null && (
        <p role="alert" className="text-danger">
          {problem}
        </p>
      )}
      {discarding && (
        <DiscardDialog
          title="Discard your comment?"
          keepLabel="Keep writing"
          discardLabel="Discard"
          onKeep={() => {
            setDiscarding(false)
            editor.current?.focus('end')
          }}
          onDiscard={clear}
        />
      )}
    </div>
  )
}

/** The Activity section: the issue's comments, oldest first, and the box that adds one. */
export function CommentsSection({ issueKey, me, onLeave, onNotice }: CommentsSectionProps) {
  const comments = useComments(issueKey)
  return (
    <Section title="Activity">
      <QueryBody query={comments} loading="Loading comments">
        {(list) =>
          list.length === 0 ? (
            <p className="text-muted">No comments</p>
          ) : (
            <ul className="space-y-3">
              {list.map((comment) => (
                <CommentRow
                  key={comment.id}
                  issueKey={issueKey}
                  comment={comment}
                  mine={me !== undefined && comment.author?.accountId === me.accountId}
                  onLeave={onLeave}
                  onNotice={onNotice}
                />
              ))}
            </ul>
          )
        }
      </QueryBody>
      <CommentBox issueKey={issueKey} onLeave={onLeave} />
    </Section>
  )
}
