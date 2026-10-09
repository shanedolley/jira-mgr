import {
  adfToEditor,
  editorToAdf,
  equivalentAdf,
  type AdfDoc,
  type EditorDoc,
} from '@jira-mgr/core/adf'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import {
  EditorContent,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type EditorStateSnapshot,
} from '@tiptap/react'
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'

import { IMAGE_LIMIT_BYTES } from '../../shared/ipc'
import { ImageView } from './ImageView'
import { ReadOnlyBlock } from './ReadOnlyBlock'
import { ReadOnlyInline } from './ReadOnlyInline'
import { IssueKeyContext } from './editor/context'
import { createExtensions, schemaAccepts, type Behaviour } from './editor/extensions'
import { startUpload } from './uploads'

const EMPTY: AdfDoc = { version: 1, type: 'doc', content: [] }

/** The editor's document for a description, with every block the schema would refuse made read-only. */
const toEditor = (doc: AdfDoc | null): EditorDoc =>
  adfToEditor(doc ?? EMPTY, { accepts: schemaAccepts })

const views = {
  adfBlock: ReactNodeViewRenderer(ReadOnlyBlock),
  adfInline: ReactNodeViewRenderer(ReadOnlyInline),
  adfImage: ReactNodeViewRenderer(ImageView),
}

/** What the host can ask of the editor. */
export interface AdfEditorHandle {
  /** Puts the caret at a document position, or at the end. */
  focus(at: number | 'end'): void
  /** Replaces the content with `doc` and forgets the edit history. */
  reset(doc: AdfDoc | null): void
  /** The document as ADF, or `null` when it holds no text. Throws `validation_failed` for an image still uploading. */
  adf(): AdfDoc | null
}

export interface AdfEditorProps {
  /** The document to show when not editing. A new one replaces the content, unless `frozen`. */
  value: AdfDoc | null
  /** The document an edit is measured against, so unchanged text is not dirty. Defaults to `value`. */
  base?: AdfDoc | null
  /** Content to start with instead of `value`, such as a restored draft. Read once, on mount. */
  initial?: EditorDoc
  /** The issue the images belong to. Comments reuse the editor with their own issue. */
  issueKey: string
  /** The accessible name of the editing region. */
  label: string
  editing: boolean
  /** Keeps the content as it is while a save is in flight, whatever `value` becomes. */
  frozen?: boolean
  /** Where the caret goes when editing starts. */
  focusAt?: number | 'end' | null
  /** Hides the editor, such as for a description that is empty. */
  hidden?: boolean
  onSave: (doc: AdfDoc | null) => void
  onCancel: () => void
  /** After every change to the document, with whether it still differs from `base`. */
  onChange: (doc: EditorDoc, dirty: boolean) => void
  /** A click on plain text while not editing, at a document position. */
  onEditRequest: (pos: number) => void
  /** The editor refused the content, so the host should show it read-only. */
  onUnsupported: () => void
  ref?: Ref<AdfEditorHandle>
}

interface Snapshot {
  dirty: boolean
  /** An image is still uploading or failed, so there is no ADF to save yet. */
  blocked: boolean
}

const baseNodes = new WeakMap<Editor, { json: EditorDoc; node: PMNode }>()

/**
 * The base as a node of this editor's own schema. Node.eq compares node types by identity, so a
 * node built from any other Schema, even an identical one, is never equal.
 */
function baseNodeOf(editor: Editor, json: EditorDoc): PMNode {
  const hit = baseNodes.get(editor)
  if (hit?.json === json) return hit.node
  const node = editor.schema.nodeFromJSON(json)
  baseNodes.set(editor, { json, node })
  return node
}

function snapshotOf(editor: Editor, base: EditorDoc): Snapshot {
  let blocked = false
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'adfImage' && node.attrs.node === null) blocked = true
    return !blocked
  })
  return { dirty: !editor.state.doc.eq(baseNodeOf(editor, base)), blocked }
}

/**
 * The end of the last text, not of the document: a document that ends in an image or a read-only
 * block would otherwise start editing with that block selected, and the first key would replace it.
 */
function endOfText(doc: PMNode): number | null {
  return Selection.findFrom(doc.resolve(doc.content.size), -1, true)?.from ?? null
}

const sameSnapshot = (a: Snapshot, b: Snapshot | null) =>
  b !== null && a.dirty === b.dirty && a.blocked === b.blocked

/**
 * The TipTap editor for an ADF document, in read and edit mode on one instance. It takes a
 * document and an issue key and nothing description-specific, so comments reuse it. Blocks it
 * cannot edit stay as the original ADF, and an image dropped or pasted uploads and embeds inline.
 */
export function AdfEditor(props: AdfEditorProps) {
  const { value, issueKey, editing, frozen = false, hidden = false } = props
  const baseDoc = props.base === undefined ? value : props.base
  const base = useMemo(() => toEditor(baseDoc), [baseDoc])
  const baseRef = useRef(base)
  const [problem, setProblem] = useState<string | null>(null)

  // The newest props, read by the editor's callbacks, which are made once.
  const live = useRef(props)
  useEffect(() => {
    live.current = props
    baseRef.current = base
  })

  const behaviour = useMemo(
    (): (() => Behaviour) => () => ({
      save() {
        if (!live.current.editing) return false
        submit()
        return true
      },
      cancel() {
        if (!live.current.editing) return false
        live.current.onCancel()
        return true
      },
      edit(pos) {
        live.current.onEditRequest(pos)
      },
      images(files, pos) {
        if (!live.current.editing || editorRef.current === null) return false
        embed(editorRef.current, files, pos)
        return true
      },
    }),
    // The editor is made once, so the issue key it embeds images for is fixed: key it by issue.
    // The callbacks only read refs, so the one list of extensions never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const editorRef = useRef<Editor | null>(null)
  const caretRef = useRef<number | null>(null)

  const editor = useEditor(
    {
      extensions: createExtensions(behaviour, views),
      content: props.initial ?? toEditor(props.value),
      editable: editing,
      enableContentCheck: true,
      shouldRerenderOnTransaction: false,
      onContentError: () => {
        live.current.onUnsupported()
      },
      onSelectionUpdate: ({ editor: updated }) => {
        if (live.current.editing) caretRef.current = updated.state.selection.from
      },
      onUpdate: ({ editor: updated }) => {
        const dirty = snapshotOf(updated, baseRef.current).dirty
        live.current.onChange(updated.getJSON() as EditorDoc, dirty)
      },
      editorProps: {
        attributes: (): Record<string, string> =>
          live.current.editing
            ? {
                role: 'textbox',
                'aria-multiline': 'true',
                'aria-label': live.current.label,
                class: 'adf-editor adf-editing',
              }
            : // TipTap makes every editor a textbox unless told otherwise, and a read view is not one.
              { role: 'group', 'aria-label': live.current.label, class: 'adf-editor' },
      },
    },
    [],
  )
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  const state = useEditorState({
    editor,
    selector: ({ editor: current }: EditorStateSnapshot<Editor>) =>
      snapshotOf(current, baseRef.current),
    equalityFn: sameSnapshot,
  })

  // Read and edit mode are one instance, so the read view shows what editing will.
  useEffect(() => {
    editor.setEditable(editing, false)
    if (editing) {
      const { doc } = editor.state
      const caret = caretRef.current
      let target: number | null
      if (typeof props.focusAt === 'number') target = props.focusAt
      else if (props.focusAt === 'end' || caret === null) target = endOfText(doc)
      // No target: the caret goes back to where it was, which is what a failed save wants.
      else target = Math.min(caret, doc.content.size)
      if (target === null) editor.commands.focus('end')
      else {
        editor.commands.setTextSelection(target)
        const focus = () => {
          editor.view.focus()
          editor.commands.scrollIntoView()
        }
        focus()
        // A page restored with a draft mounts the editor in this same pass, and the shell then
        // moves focus to the page, so look again on the next frame.
        requestAnimationFrame(() => {
          if (!editor.view.hasFocus()) focus()
        })
      }
    }
    // Focus only when editing starts, not each time the caret target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editing])

  // A new description from a refetch replaces the content, unless it is what the editor shows already.
  useEffect(() => {
    if (editing || frozen) return
    try {
      if (equivalentAdf(editorToAdf(editor.getJSON() as EditorDoc), value)) return
    } catch {
      // An image is still uploading: that content is not a description yet, so replace it.
    }
    editor.commands.setContent(toEditor(value), { emitUpdate: false })
  }, [editor, value, editing, frozen])

  function submit() {
    const { dirty, blocked } = snapshotOf(editor, baseRef.current)
    if (!dirty || blocked) return
    try {
      const doc = editorToAdf(editor.getJSON() as EditorDoc)
      setProblem(null)
      live.current.onSave(doc)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  /** Starts an upload for each image and puts its placeholder at the drop point. */
  function embed(target: Editor, files: File[], pos: number | null) {
    const image = target.schema.nodes.adfImage
    if (image === undefined) return
    const nodes: PMNode[] = []
    const tooBig: string[] = []
    for (const file of files) {
      if (file.size > IMAGE_LIMIT_BYTES) {
        tooBig.push(file.name)
        continue
      }
      const uploadId = startUpload(issueKey, file)
      nodes.push(image.create({ node: null, uploadId }))
    }
    setProblem(
      tooBig.length === 0
        ? null
        : `${tooBig.join(', ')} is over the ${String(IMAGE_LIMIT_BYTES / 1_000_000)} MB limit, so it was not added.`,
    )
    if (nodes.length === 0) return
    const { state: current } = target
    const $pos = current.doc.resolve(pos ?? current.selection.to)
    // A block cannot go inside a paragraph, so the image takes an empty paragraph's place, or follows the paragraph.
    let from = $pos.pos
    let to = $pos.pos
    if ($pos.parent.isTextblock) {
      const empty = $pos.parent.content.size === 0
      from = empty ? $pos.before() : $pos.after()
      to = $pos.after()
    }
    const end = to >= current.doc.content.size
    const paragraph = target.schema.nodes.paragraph?.create()
    const inserted = end && paragraph !== undefined ? [...nodes, paragraph] : nodes
    try {
      target.view.dispatch(current.tr.replaceWith(from, to, inserted).scrollIntoView())
    } catch {
      target.view.dispatch(current.tr.insert(current.doc.content.size, inserted))
    }
  }

  useImperativeHandle(props.ref, () => ({
    focus: (at) => {
      editor.commands.focus(at)
    },
    reset: (doc) => {
      editor.commands.setContent(toEditor(doc), { emitUpdate: false })
      setProblem(null)
    },
    adf: () => editorToAdf(editor.getJSON() as EditorDoc),
  }))

  return (
    <IssueKeyContext value={issueKey}>
      <div hidden={hidden} className="space-y-2">
        <EditorContent
          editor={editor}
          className={editing ? 'rounded-md border border-line bg-panel p-2' : ''}
        />
        {problem !== null && (
          <p role="alert" className="text-danger">
            {problem}
          </p>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!state.dirty || state.blocked}
              aria-keyshortcuts="Meta+Enter"
              title="Save (Cmd+Enter)"
              className="rounded-md bg-accent px-3 py-1 font-medium text-accent-ink disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                props.onCancel()
              }}
              aria-keyshortcuts="Escape"
              title="Cancel (Esc)"
              className="rounded-md border border-line px-3 py-1 hover:bg-hover"
            >
              Cancel
            </button>
            {state.blocked && (
              <span className="text-xs text-muted">
                An image is uploading or failed. Save is off until it is done or removed.
              </span>
            )}
          </div>
        )}
      </div>
    </IssueKeyContext>
  )
}
