import type { AdfDoc, EditorDoc } from '@jira-mgr/core/adf'
import { useIsMutating } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { IMAGE_TYPES } from '../../shared/ipc'
import { safeMarkdown } from './activity'
import { AdfEditor, type AdfEditorHandle } from './AdfEditor'
import type { Notice } from './create'
import { DropZone } from './DropZone'
import { DiscardDialog } from './DiscardDialog'
import { dropDraft, getDraft, putDraft } from './drafts'
import { conflictOf, useSetDescription, type DescriptionConflict } from './queries'

interface DescriptionEditorProps {
  issueKey: string
  /** The description Jira holds, from the page's own read. */
  value: AdfDoc | null
  /** The edit ended, so the editor's controls are gone: the caller puts focus somewhere that still works. */
  onLeave: () => void
  /** Reports something to the user in the corner of the window. */
  onNotice: (notice: Notice) => void
  /** Attaches files that are not images, which the description cannot hold. */
  onAttach: (files: File[]) => void
}

/** `read` shows the description, `edit` changes it, `saving` waits on Jira with the draft still in the editor. */
type Phase = 'read' | 'edit' | 'saving'

const cannotEdit = 'This description cannot be edited here. It is unchanged in Jira.'

/**
 * The Description section: the description in the editor, an Edit button, and the Save, Cancel,
 * conflict and draft handling around it. A save shows at once and rolls back if Jira refuses; the
 * text being edited is kept as a draft for the session until it is saved or discarded.
 */
export function DescriptionEditor({
  issueKey,
  value,
  onLeave,
  onNotice,
  onAttach,
}: DescriptionEditorProps) {
  // A draft kept when the page was left comes back as an edit in progress.
  const [restoredDraft] = useState(() => getDraft(issueKey))
  const [phase, setPhase] = useState<Phase>(restoredDraft === undefined ? 'read' : 'edit')
  const [restored, setRestored] = useState(restoredDraft !== undefined)
  const [base, setBase] = useState<AdfDoc | null>(restoredDraft?.base ?? value)
  const [focusAt, setFocusAt] = useState<number | 'end' | null>(
    restoredDraft === undefined ? null : 'end',
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [conflict, setConflict] = useState<DescriptionConflict | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const dirty = useRef(restoredDraft !== undefined)
  const editor = useRef<AdfEditorHandle>(null)
  const mounted = useRef(true)
  const queued = useRef<File[]>([])
  const save = useSetDescription(issueKey)
  // Still counted while the re-read after a save is pending, so the next edit starts from Jira's form.
  const pending = useIsMutating({ mutationKey: ['issues', issueKey, 'description'] }) > 0

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const editing = phase === 'edit'

  useEffect(() => {
    if (phase !== 'edit' || queued.current.length === 0) return
    const files = queued.current
    queued.current = []
    editor.current?.addImages(files)
  }, [phase])

  function startEdit(at: number | 'end') {
    setBase(value)
    setFocusAt(at)
    setConflict(null)
    setProblem(null)
    setPhase('edit')
  }

  function leave() {
    setPhase('read')
    setRestored(false)
    setProblem(null)
    setConflict(null)
    onLeave()
  }

  function onChange(doc: EditorDoc, isDirty: boolean) {
    dirty.current = isDirty
    if (isDirty) putDraft(issueKey, { doc, base })
    else dropDraft(issueKey)
  }

  async function submit(description: AdfDoc | null, against: AdfDoc | null) {
    setPhase('saving')
    setProblem(null)
    setConflict(null)
    try {
      await save.mutateAsync({ key: issueKey, description, base: against })
    } catch (error) {
      // The draft stays in the map and in the editor, whether or not the page is still open.
      if (!mounted.current) return
      const clash = conflictOf(error)
      if (clash !== null) setConflict(clash)
      else {
        const reason = error instanceof Error ? error.message : String(error)
        setProblem(`Could not save the description, so Jira still holds the old one. ${reason}`)
      }
      setFocusAt(null)
      setPhase('edit')
      return
    }
    dropDraft(issueKey)
    dirty.current = false
    if (!mounted.current) return
    setBase(description)
    leave()
  }

  function cancel() {
    if (dirty.current) setDiscarding(true)
    else {
      dropDraft(issueKey)
      leave()
    }
  }

  function discard() {
    setDiscarding(false)
    editor.current?.reset(base)
    dirty.current = false
    dropDraft(issueKey)
    leave()
  }

  function keepEditing() {
    setDiscarding(false)
    editor.current?.focus('end')
  }

  /** Sends the draft over Jira's current description, which the user chose to overwrite. */
  function saveMine(current: AdfDoc | null) {
    try {
      const mine = editor.current?.adf() ?? null
      setBase(current)
      void submit(mine, current)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  /** Shows Jira's description and drops the draft. */
  function discardMine(current: AdfDoc | null) {
    editor.current?.reset(current)
    setBase(current)
    dirty.current = false
    dropDraft(issueKey)
    leave()
  }

  const empty = value === null && phase === 'read'

  /** Files dropped on the section: images start an edit and embed, anything else attaches to the issue. */
  function takeFiles(files: File[], handled: boolean) {
    const images = files.filter((file) => (IMAGE_TYPES as readonly string[]).includes(file.type))
    const others = files.filter((file) => !images.includes(file))
    if (others.length > 0) onAttach(others)
    // Images dropped on the editor are already embedded; only the rest was left over.
    if (handled || images.length === 0) return
    if (unsupported || phase === 'saving' || pending) {
      onNotice({
        title: 'The description cannot take images now',
        notes: [unsupported ? cannotEdit : 'It is still saving. Drop the image again in a moment.'],
        warned: false,
      })
      return
    }
    if (phase === 'edit') {
      editor.current?.addImages(images)
      return
    }
    // Added once the edit has started, so the draft is kept against the base it began on.
    queued.current = images
    startEdit('end')
  }

  return (
    <DropZone label="Add images into description" onFiles={takeFiles} className="space-y-2">
      {unsupported && (
        <>
          <p className="text-muted">{cannotEdit}</p>
          <p className="whitespace-pre-wrap break-words">
            {value === null ? '' : safeMarkdown(value)}
          </p>
        </>
      )}
      {empty && !unsupported && <p className="text-muted">No description</p>}
      {restored && editing && <p className="text-muted">Unsaved draft restored.</p>}
      <div hidden={unsupported}>
        <AdfEditor
          ref={editor}
          value={value}
          base={phase === 'read' ? value : base}
          initial={restoredDraft?.doc}
          issueKey={issueKey}
          label="Description"
          editing={editing}
          frozen={phase === 'saving'}
          focusAt={focusAt}
          hidden={empty}
          onSave={(doc) => {
            void submit(doc, base)
          }}
          onCancel={cancel}
          onChange={onChange}
          onEditRequest={(pos) => {
            if (!pending) startEdit(pos)
          }}
          onUnsupported={() => {
            setUnsupported(true)
          }}
        />
      </div>
      {conflict !== null && (
        <div role="alert" className="space-y-2 rounded-md border border-danger p-3">
          <p>{issueKey}&apos;s description changed in Jira while you edited.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                saveMine(conflict.current)
              }}
              className="btn btn-primary"
            >
              Save mine anyway
            </button>
            <button
              type="button"
              onClick={() => {
                discardMine(conflict.current)
              }}
              className="btn"
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
      {phase !== 'edit' && !unsupported && (
        <button
          type="button"
          disabled={phase === 'saving' || pending}
          onClick={() => {
            startEdit('end')
          }}
          className="btn btn-sm btn-ghost"
        >
          {phase === 'saving' || pending
            ? 'Saving'
            : value === null
              ? 'Add description'
              : 'Edit description'}
        </button>
      )}
      {discarding && (
        <DiscardDialog
          title="Discard your changes to the description?"
          keepLabel="Keep editing"
          discardLabel="Discard"
          onKeep={keepEditing}
          onDiscard={discard}
        />
      )}
    </DropZone>
  )
}
