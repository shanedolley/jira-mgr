import { adfNodeSchema, isBlockNode, isInlineNode, type AdfNode } from '@jira-mgr/core/adf'
import {
  Extension,
  getSchema,
  Mark,
  mergeAttributes,
  Node,
  type Extensions,
  type Node as TipTapNode,
  type NodeViewRenderer,
} from '@tiptap/core'
import { DOMSerializer, Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'

import { externalUrl } from '../../../shared/links'

/** What a list item holds after its paragraph, and what a quote holds: ADF's rules, which Jira enforces. */
const LIST_ITEM_CONTENT = 'paragraph (paragraph | bulletList | orderedList | codeBlock | adfImage)*'
const QUOTE_CONTENT = '(paragraph | bulletList | orderedList | codeBlock | adfImage)+'

/** Nodes whose original ADF `attrs` and block marks the editor carries in the `adf` attribute. */
const ADF_NODES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
]

/**
 * Stamps each copy with a fresh nonce and trusts pasted HTML only if it carries the latest one.
 * A copy from another app, an older copy or a crafted page cannot know it, so cannot carry raw ADF.
 */
export function createClipGuard() {
  let latest: string | null = null
  return {
    /** The nonce for a copy being made now. It replaces the last one. */
    next(): string {
      latest = crypto.randomUUID()
      return latest
    },
    trusts: (html: string) => latest !== null && html.includes(`data-jm-clip="${latest}"`),
  }
}

const clips = createClipGuard()

/** What the editor asks of its host, read when a key or a click needs it, so it is never stale. */
export interface Behaviour {
  /** Cmd+Enter. True when the key was used, so it does not also insert a line break. */
  save(): boolean
  /** Esc. True when the key was used. */
  cancel(): boolean
  /** A click in read mode on plain text, at `pos`. The host may start editing there. */
  edit(pos: number): void
  /** Dropped or pasted image files, `pasted` when they came from the clipboard. True when the editor took the event. */
  images(files: File[], pos: number | null, pasted: boolean): boolean
}

/** The node views, which only the running editor has. The schema test passes none. */
export interface NodeViews {
  adfBlock: NodeViewRenderer
  adfInline: NodeViewRenderer
  adfImage: NodeViewRenderer
}

type Kind = 'block' | 'inline'

/**
 * A raw ADF node read from a pasted `data-adf` attribute, or `null` when it is not valid JSON, is
 * not an ADF node, or is the wrong kind: an inline node cannot stand as a block, nor a block as
 * inline. Nothing about the node is trusted beyond that.
 */
export function readAdfAttr(raw: string | null, kind: Kind): AdfNode | null {
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = adfNodeSchema.safeParse(value)
  if (!parsed.success) return null
  const node = parsed.data
  // Core's rule, so a type neither side knows counts as either kind.
  return kind === 'inline' ? (isInlineNode(node) ? node : null) : isBlockNode(node) ? node : null
}

/** The node a read-only atom stores, as the clipboard carries it. */
const atomHtml = (node: PMNode) => JSON.stringify(node.attrs.node)

function atom(
  name: 'adfBlock' | 'adfImage' | 'adfInline',
  options: { group: 'block' | 'inline'; tag: string; extra?: Record<string, unknown> },
  view: NodeViewRenderer | undefined,
): TipTapNode {
  const kind: Kind = options.group
  return Node.create({
    name,
    group: options.group,
    inline: options.group === 'inline',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        node: { default: null, rendered: false },
        ...options.extra,
      }
    },
    parseHTML() {
      return [
        {
          tag: `${options.tag}[data-${name.toLowerCase()}]`,
          getAttrs: (element) => {
            // An image still uploading has no node yet, only the id of its upload in this session.
            const upload = element.getAttribute('data-adf-upload')
            if (name === 'adfImage' && upload !== null && upload !== '') {
              return { node: null, uploadId: upload }
            }
            const node = readAdfAttr(element.getAttribute('data-adf'), kind)
            // An image holds a file, never inline content or another block.
            if (node === null || (name === 'adfImage') !== (node.type === 'mediaSingle'))
              return false
            return { node }
          },
        },
      ]
    },
    renderHTML({ node, HTMLAttributes }) {
      return [
        options.tag,
        mergeAttributes(HTMLAttributes, {
          [`data-${name.toLowerCase()}`]: '',
          ...(node.attrs.node === null
            ? { 'data-adf-upload': String(node.attrs.uploadId ?? '') }
            : { 'data-adf': atomHtml(node) }),
        }),
      ]
    },
    ...(view === undefined ? {} : { addNodeView: () => view }),
  })
}

/** An ADF mark the editor has no mark for, kept whole. Several can sit on one text. */
const AdfMark = Mark.create({
  name: 'adfMark',
  excludes: '',
  inclusive: false,
  addAttributes() {
    return { mark: { default: null, rendered: false } }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-adfmark]',
        getAttrs: (element) => {
          try {
            const parsed = adfNodeSchema.safeParse(
              JSON.parse(element.getAttribute('data-adf') ?? ''),
            )
            return parsed.success ? { mark: parsed.data } : false
          } catch {
            return false
          }
        },
      },
    ]
  },
  renderHTML({ mark }) {
    return ['span', { 'data-adfmark': '', 'data-adf': JSON.stringify(mark.attrs.mark) }, 0]
  },
})

/**
 * The original ADF `attrs` and block marks of a node or link, which the converter writes back.
 * Never rendered, never copied to the new half of a split, so a split paragraph has one `localId`.
 */
const AdfAttribute = Extension.create({
  name: 'adfAttribute',
  addGlobalAttributes() {
    return [
      {
        types: [...ADF_NODES, 'link'],
        attributes: { adf: { default: null, keepOnSplit: false, rendered: false } },
      },
    ]
  },
})

const Keys = (behaviour: () => Behaviour) =>
  Extension.create({
    name: 'adfKeys',
    // Above HardBreak and CodeBlock, which both claim Mod-Enter.
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        'Mod-Enter': () => behaviour().save(),
        Escape: () => behaviour().cancel(),
      }
    },
  })

/** Removes every `data-adf` attribute, so HTML from outside this editor cannot plant a node. */
export function sanitizePastedHtml(html: string): string {
  if (clips.trusts(html)) return html
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const element of parsed.body.querySelectorAll('*')) {
    for (const name of element.getAttributeNames()) {
      if (name.startsWith('data-adf')) element.removeAttribute(name)
    }
  }
  return parsed.body.innerHTML
}

function stripMark(mark: PMNode['marks'][number]) {
  return 'adf' in mark.attrs ? mark.type.create({ ...mark.attrs, adf: null }) : mark
}

/**
 * A pasted slice without the ADF attributes of its mapped nodes. An upload id stays: it names an
 * upload of this session, and a view whose upload is unknown or belongs to another issue shows
 * as failed, so it can carry nothing in.
 */
function stripPasted(fragment: Fragment): Fragment {
  const nodes: PMNode[] = []
  fragment.forEach((node) => {
    if (node.isText) {
      nodes.push(node.mark(node.marks.map(stripMark)))
      return
    }
    const attrs: Record<string, unknown> = { ...node.attrs }
    if ('adf' in attrs) attrs.adf = null
    nodes.push(node.type.create(attrs, stripPasted(node.content), node.marks.map(stripMark)))
  })
  return Fragment.fromArray(nodes)
}

const Clipboard = (behaviour: () => Behaviour) =>
  Extension.create({
    name: 'adfClipboard',
    addProseMirrorPlugins() {
      const schema = this.editor.schema
      const serializer = new DOMSerializer(
        DOMSerializer.nodesFromSchema(schema),
        DOMSerializer.marksFromSchema(schema),
      )
      const serializeFragment = serializer.serializeFragment.bind(serializer)
      // Stamps what this session copies, so only a copy made here may carry raw ADF back in.
      serializer.serializeFragment = (...args) => {
        const out = serializeFragment(...args)
        // Nested calls pass a target; only the outermost one is a copy.
        if (args[2] !== undefined) return out
        const nonce = clips.next()
        for (const child of out.children) child.setAttribute('data-jm-clip', nonce)
        return out
      }
      return [
        new Plugin({
          key: new PluginKey('adfClipboard'),
          props: {
            clipboardSerializer: serializer,
            transformPastedHTML: (html) => sanitizePastedHtml(html),
            transformPasted: (slice) =>
              new Slice(stripPasted(slice.content), slice.openStart, slice.openEnd),
            handleDrop: (view, event, _slice, moved) => {
              if (moved || event.dataTransfer === null) return false
              const files = imageFiles(event.dataTransfer.files)
              if (files.length === 0) return false
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
              event.preventDefault()
              return behaviour().images(files, at?.pos ?? null, false)
            },
            handlePaste: (_view, event) => {
              const files = imageFiles(event.clipboardData?.files ?? null)
              if (files.length === 0) return false
              event.preventDefault()
              return behaviour().images(files, null, true)
            },
          },
        }),
      ]
    },
  })

const IMAGE_FILE = /^image\/(png|jpeg|gif|webp)$/

/** The dropped or pasted files the editor embeds. Anything else is left for the page. */
function imageFiles(list: FileList | null): File[] {
  return list === null ? [] : Array.from(list).filter((file) => IMAGE_FILE.test(file.type))
}

/** One click handler for links and for starting an edit, so a click never does both. */
const Clicks = (behaviour: () => Behaviour) =>
  Extension.create({
    name: 'adfClicks',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('adfClicks'),
          // A click on a link must never follow it: the editor opens it itself, in the browser. This
          // listens on the editor element, so it also covers the links inside node views.
          view: (view) => {
            const refuse = (event: MouseEvent) => {
              if (event.target instanceof Element && event.target.closest('a[href]') !== null) {
                event.preventDefault()
              }
            }
            view.dom.addEventListener('click', refuse)
            view.dom.addEventListener('auxclick', refuse)
            return {
              destroy() {
                view.dom.removeEventListener('click', refuse)
                view.dom.removeEventListener('auxclick', refuse)
              },
            }
          },
          props: {
            handleClick: (view, pos, event) => {
              const target = event.target instanceof Element ? event.target : null
              const anchor = target?.closest('a[href]') ?? null
              if (anchor !== null) {
                // A link opens on a plain click when reading, and on Cmd or Ctrl+click when editing.
                const url = externalUrl(anchor.getAttribute('href') ?? '')
                const opens = !view.editable || event.metaKey || event.ctrlKey
                if (url !== null && opens) window.open(url, '_blank', 'noopener,noreferrer')
                return true
              }
              if (view.editable || target?.closest('[data-node-view-wrapper]') != null) return false
              // A click that ends a selection must not start an edit, or text could not be copied.
              if (window.getSelection()?.isCollapsed === false) return false
              behaviour().edit(pos)
              return true
            },
          },
        }),
      ]
    },
  })

/** StarterKit with ADF's content rules, and `code` allowed beside `link`. */
const Kit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) => {
      const node = extension as TipTapNode
      if (extension.name === 'listItem') return node.extend({ content: LIST_ITEM_CONTENT })
      if (extension.name === 'blockquote') return node.extend({ content: QUOTE_CONTENT })
      if (extension.name === 'code') {
        return (extension as unknown as Mark).extend({ excludes: 'bold italic strike underline' })
      }
      return extension
    })
  },
})

/**
 * The one extension list the editor, its tests and D5 use. Without `views` it is schema only, so
 * the schema test needs no React and no DOM.
 */
export function createExtensions(
  behaviour: () => Behaviour = () => ({
    save: () => false,
    cancel: () => false,
    edit: () => undefined,
    images: () => false,
  }),
  views?: NodeViews,
): Extensions {
  return [
    Kit.configure({
      // It would append a paragraph after a final table or panel on every load, so each such
      // issue would open dirty.
      trailingNode: false,
      link: {
        openOnClick: false,
        HTMLAttributes: { target: null, rel: 'noopener noreferrer' },
        isAllowedUri: (url) => externalUrl(url) !== null,
      },
    }),
    AdfAttribute,
    AdfMark,
    atom('adfBlock', { group: 'block', tag: 'div' }, views?.adfBlock),
    atom(
      'adfImage',
      { group: 'block', tag: 'div', extra: { uploadId: { default: null, rendered: false } } },
      views?.adfImage,
    ),
    atom('adfInline', { group: 'inline', tag: 'span' }, views?.adfInline),
    Keys(behaviour),
    Clipboard(behaviour),
    Clicks(behaviour),
  ]
}

/** The schema of the editor, for the converter's `accepts` check and the tests. */
export const editorSchema = getSchema(createExtensions())

/** True when ProseMirror accepts a top-level block the converter produced. */
export function schemaAccepts(block: unknown): boolean {
  try {
    editorSchema.nodeFromJSON(block).check()
    return true
  } catch {
    return false
  }
}
