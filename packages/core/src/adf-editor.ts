import {
  canonical,
  isInlineNode,
  refuseDeepNesting,
  same,
  type AdfDoc,
  type AdfMark,
  type AdfNode,
} from './adf-schema.js'
import { JiraMgrError } from './errors.js'

/** A mark in ProseMirror's JSON form, which TipTap loads with `setContent` and returns with `getJSON`. */
export interface EditorMark {
  type: string
  attrs?: Record<string, unknown>
}

/** A node in ProseMirror's JSON form. The names must match `editor/extensions.ts` in the desktop app. */
export interface EditorNode {
  type: string
  attrs?: Record<string, unknown>
  content?: EditorNode[]
  marks?: EditorMark[]
  text?: string
}

export interface EditorDoc {
  type: 'doc'
  content: EditorNode[]
}

/** What the editor does not model of a node: its ADF attrs and block marks, written back as they were. */
interface Extra {
  attrs?: Record<string, unknown>
  marks?: AdfMark[]
}

const SIMPLE_MARKS: Record<string, string> = {
  strong: 'bold',
  em: 'italic',
  strike: 'strike',
  code: 'code',
  underline: 'underline',
}
const SIMPLE_MARKS_BACK = Object.fromEntries(Object.entries(SIMPLE_MARKS).map(([a, e]) => [e, a]))

/** Thrown inside a block the editor has no node for, so the whole top-level block becomes read-only. */
class Unsupported extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function extraOf(node: AdfNode): Extra | null {
  const extra: Extra = {}
  if (node.attrs !== undefined) extra.attrs = node.attrs
  if (node.marks !== undefined) extra.marks = node.marks
  return Object.keys(extra).length === 0 ? null : extra
}

const withExtra = (node: AdfNode, attrs: Record<string, unknown> = {}) => ({
  ...attrs,
  adf: extraOf(node),
})

function toEditorMark(mark: AdfMark): EditorMark {
  const simple = SIMPLE_MARKS[mark.type]
  if (simple !== undefined && mark.attrs === undefined) return { type: simple }
  if (mark.type === 'link' && typeof mark.attrs?.href === 'string') {
    return { type: 'link', attrs: { href: mark.attrs.href, adf: { attrs: mark.attrs } } }
  }
  return { type: 'adfMark', attrs: { mark } }
}

function toAdfMark(mark: EditorMark): AdfMark {
  if (mark.type === 'adfMark') return mark.attrs?.mark as AdfMark
  if (mark.type === 'link') {
    const original = (mark.attrs?.adf as Extra | null | undefined)?.attrs
    return { type: 'link', attrs: { ...original, href: mark.attrs?.href } }
  }
  const type = SIMPLE_MARKS_BACK[mark.type]
  if (type === undefined) throw invalid(`The editor mark "${mark.type}" has no ADF form.`)
  return { type }
}

function invalid(message: string): JiraMgrError {
  return new JiraMgrError('validation_failed', message)
}

/** A text node with a key beyond these is never merged, so what the converter drops stays visible. */
const isPlainText = (node: EditorNode) =>
  node.type === 'text' && Object.keys(node).every((k) => ['type', 'text', 'marks'].includes(k))

function joinText(nodes: EditorNode[]): EditorNode[] {
  const out: EditorNode[] = []
  for (const node of nodes) {
    const last = out.at(-1)
    if (
      last !== undefined &&
      isPlainText(node) &&
      isPlainText(last) &&
      same(last.marks ?? [], node.marks ?? [])
    ) {
      out[out.length - 1] = { ...last, text: (last.text ?? '') + (node.text ?? '') }
    } else out.push(node)
  }
  return out
}

function textBlock(node: AdfNode, type: string, attrs: Record<string, unknown>): EditorNode {
  const children: EditorNode[] = []
  for (const child of node.content ?? []) {
    if (child.type === 'text') {
      if (child.text === undefined || child.text === '') throw new Unsupported()
      children.push({
        type: 'text',
        text: child.text,
        ...(child.marks === undefined || child.marks.length === 0
          ? {}
          : { marks: child.marks.map(toEditorMark) }),
      })
    } else if (child.type === 'hardBreak') {
      children.push({ type: 'hardBreak', attrs: withExtra(child) })
    } else if (isInlineNode(child)) {
      children.push({ type: 'adfInline', attrs: { node: child } })
    } else throw new Unsupported()
  }
  const content = joinText(children)
  return {
    type,
    attrs: withExtra(node, attrs),
    ...(content.length === 0 ? {} : { content }),
  }
}

/** A `mediaSingle` holding one file `media` (and at most a caption) is an image the editor shows. */
function isImage(node: AdfNode): boolean {
  if (node.type !== 'mediaSingle') return false
  const [media, ...rest] = node.content ?? []
  return (
    media?.type === 'media' &&
    media.attrs?.type === 'file' &&
    typeof media.attrs.id === 'string' &&
    rest.every((n) => n.type === 'caption')
  )
}

function toEditorBlock(node: AdfNode): EditorNode {
  const children = () => (node.content ?? []).map(toEditorBlock)
  const container = (type: string, attrs: Record<string, unknown> = {}): EditorNode => {
    const content = children()
    return {
      type,
      attrs: withExtra(node, attrs),
      ...(content.length === 0 ? {} : { content }),
    }
  }
  switch (node.type) {
    case 'paragraph':
      return textBlock(node, 'paragraph', {})
    case 'heading': {
      const level = node.attrs?.level
      if (typeof level !== 'number') throw new Unsupported()
      return textBlock(node, 'heading', { level })
    }
    case 'codeBlock': {
      const language = node.attrs?.language
      const block = textBlock(node, 'codeBlock', {
        language: typeof language === 'string' ? language : null,
      })
      if (block.content?.some((n) => n.type !== 'text' || n.marks !== undefined)) {
        throw new Unsupported()
      }
      return block
    }
    case 'blockquote':
    case 'bulletList':
    case 'listItem':
      return container(node.type)
    case 'orderedList': {
      const order = node.attrs?.order
      return container('orderedList', { start: typeof order === 'number' ? order : 1 })
    }
    case 'rule':
      return { type: 'horizontalRule', attrs: withExtra(node) }
    case 'mediaSingle':
      if (isImage(node)) return { type: 'adfImage', attrs: { node, uploadId: null } }
      throw new Unsupported()
    default:
      throw new Unsupported()
  }
}

function mergeAttrs(
  node: EditorNode,
  modelled: Record<string, unknown>,
): { attrs?: Record<string, unknown>; marks?: AdfMark[] } {
  const extra = node.attrs?.adf as Extra | null | undefined
  const attrs = { ...extra?.attrs, ...modelled }
  return {
    ...(Object.keys(attrs).length === 0 && extra?.attrs === undefined ? {} : { attrs }),
    ...(extra?.marks === undefined ? {} : { marks: extra.marks }),
  }
}

function toAdfInline(node: EditorNode): AdfNode {
  switch (node.type) {
    case 'text':
      return {
        type: 'text',
        text: node.text ?? '',
        ...(node.marks === undefined || node.marks.length === 0
          ? {}
          : { marks: node.marks.map(toAdfMark) }),
      }
    case 'hardBreak':
      return { type: 'hardBreak', ...mergeAttrs(node, {}) }
    case 'adfInline':
      return node.attrs?.node as AdfNode
    default:
      throw invalid(`The editor node "${node.type}" has no ADF form.`)
  }
}

function toAdfBlock(node: EditorNode): AdfNode {
  const inline = () => (node.content ?? []).map(toAdfInline)
  const blocks = () => (node.content ?? []).map(toAdfBlock)
  const withContent = (type: string, modelled: Record<string, unknown>, content: AdfNode[]) => ({
    type,
    ...mergeAttrs(node, modelled),
    ...(content.length === 0 ? {} : { content }),
  })
  switch (node.type) {
    case 'paragraph':
      return withContent('paragraph', {}, inline())
    case 'heading':
      return withContent('heading', { level: node.attrs?.level }, inline())
    case 'codeBlock': {
      const language = node.attrs?.language
      return withContent(
        'codeBlock',
        typeof language === 'string' && language !== '' ? { language } : {},
        inline(),
      )
    }
    case 'blockquote':
    case 'bulletList':
    case 'listItem':
      return withContent(node.type, {}, blocks())
    case 'orderedList': {
      const start = node.attrs?.start
      const extra = node.attrs?.adf as Extra | null | undefined
      const keep = start !== 1 || (extra?.attrs !== undefined && 'order' in extra.attrs)
      return withContent('orderedList', keep ? { order: start } : {}, blocks())
    }
    case 'horizontalRule':
      return { type: 'rule', ...mergeAttrs(node, {}) }
    case 'adfBlock':
      return node.attrs?.node as AdfNode
    case 'adfImage': {
      const raw = node.attrs?.node
      if (raw === null || raw === undefined) {
        throw invalid('An image is still uploading or failed to upload. Wait for it or remove it.')
      }
      return raw as AdfNode
    }
    default:
      throw invalid(`The editor node "${node.type}" has no ADF form.`)
  }
}

function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise)
  if (!isObject(value) || typeof value.type !== 'string') return value
  const out = { ...value }
  if (Array.isArray(value.content)) {
    const content = joinText((value.content as unknown[]).map(normalise) as EditorNode[])
    if (content.length === 0) delete out.content
    else out.content = content
  }
  if (Array.isArray(value.marks)) {
    out.marks = (value.marks as unknown[])
      .map(normalise)
      .sort((a, b) => (canonical(a) < canonical(b) ? -1 : 1))
  }
  return out
}

/**
 * Equality of two ADF values that ignores what carries no meaning: key order, how text is split
 * into runs of the same marks, the order of marks, and `content: []` against no `content`.
 */
export function equivalentAdf(a: unknown, b: unknown): boolean {
  return refuseDeepNesting(() => same(normalise(a), normalise(b)))
}

function readOnlyBlock(node: AdfNode): EditorNode {
  return { type: 'adfBlock', attrs: { node } }
}

/**
 * The editor's document for an ADF one. Each top-level block is converted and converted back; one
 * that does not come back equivalent, or that `accepts` refuses, loads as a read-only block
 * holding the original node. Throws `validation_failed` when the document is nested too deeply.
 */
export function adfToEditor(
  doc: AdfDoc,
  options: { accepts?: (block: EditorNode) => boolean } = {},
): EditorDoc {
  return refuseDeepNesting(() => {
    const content = doc.content.map((block): EditorNode => {
      let converted: EditorNode
      try {
        converted = toEditorBlock(block)
      } catch (error) {
        if (error instanceof Unsupported) return readOnlyBlock(block)
        throw error
      }
      if (!equivalentAdf(toAdfBlock(converted), block)) return readOnlyBlock(block)
      if (options.accepts?.(converted) === false) return readOnlyBlock(block)
      return converted
    })
    return { type: 'doc', content: content.length === 0 ? [{ type: 'paragraph' }] : content }
  })
}

/**
 * The ADF for the editor's document, or `null` when it holds only an empty paragraph: Jira shows
 * an empty description and none alike. Throws `validation_failed` for an image still uploading.
 */
export function editorToAdf(doc: EditorDoc): AdfDoc | null {
  return refuseDeepNesting(() => {
    const blocks = doc.content
    const [only] = blocks
    if (
      blocks.length === 0 ||
      (blocks.length === 1 && only?.type === 'paragraph' && (only.content ?? []).length === 0)
    ) {
      return null
    }
    return { version: 1, type: 'doc', content: blocks.map(toAdfBlock) }
  })
}

/** The `mediaSingle` Jira's own editor writes for an attachment: centred, one file `media`. */
export function imageNode(file: {
  mediaId: string
  filename: string
  width?: number
  height?: number
}): AdfNode {
  return {
    type: 'mediaSingle',
    attrs: { layout: 'center' },
    content: [
      {
        type: 'media',
        attrs: {
          type: 'file',
          id: file.mediaId,
          collection: '',
          alt: file.filename,
          ...(file.width === undefined ? {} : { width: file.width }),
          ...(file.height === undefined ? {} : { height: file.height }),
        },
      },
    ],
  }
}
