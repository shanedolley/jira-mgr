import { z } from 'zod'

import { JiraMgrError } from './errors.js'

const attrs = z.record(z.string(), z.unknown())

export const adfMarkSchema = z.looseObject({ type: z.string(), attrs: attrs.optional() })

/** Any ADF node. Loose, so a node type or key core has never seen passes through untouched. */
export const adfNodeSchema = z.looseObject({
  type: z.string(),
  attrs: attrs.optional(),
  get content() {
    return z.array(adfNodeSchema).optional()
  },
  marks: z.array(adfMarkSchema).optional(),
  text: z.string().optional(),
})

/** Node types that sit inside a paragraph. Anything not listed as a block counts as inline. */
const INLINE_TYPES = new Set([
  'text',
  'hardBreak',
  'mention',
  'emoji',
  'date',
  'status',
  'inlineCard',
  'mediaInline',
  'placeholder',
  'inlineExtension',
])

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'codeBlock',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'rule',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'panel',
  'expand',
  'nestedExpand',
  'mediaSingle',
  'mediaGroup',
  'media',
  'caption',
  'layoutSection',
  'layoutColumn',
  'taskList',
  'taskItem',
  'decisionList',
  'decisionItem',
  'blockCard',
  'embedCard',
  'extension',
  'bodiedExtension',
])

/** A node that can sit in a paragraph. A type core has never seen counts, since it could be either. */
export function isInlineNode(node: { type: string }): boolean {
  return !BLOCK_TYPES.has(node.type)
}

/** A node that can sit in a document. A type core has never seen counts. */
export function isBlockNode(node: { type: string }): boolean {
  return !INLINE_TYPES.has(node.type)
}

export const adfDocSchema = z.looseObject({
  version: z.literal(1),
  type: z.literal('doc'),
  content: z.array(adfNodeSchema.refine(isBlockNode, 'A document holds blocks, not inline nodes.')),
})

export type AdfMark = z.infer<typeof adfMarkSchema>
export type AdfNode = z.infer<typeof adfNodeSchema>
export type AdfDoc = z.infer<typeof adfDocSchema>

/** What a note restores that the Markdown form of a node cannot carry. */
export const patchSchema = z.object({
  /** `null` drops the attrs the Markdown form would otherwise give the node. */
  attrs: attrs.nullable().optional(),
  marks: z.array(adfMarkSchema).optional(),
  /** Spaces and tabs Markdown drops from the start and end of a text block. */
  head: z.string().optional(),
  tail: z.string().optional(),
  /** On a table: the first row is a body row, and the Markdown header row is empty filler. */
  headerless: z.literal(true).optional(),
})

export type Patch = z.infer<typeof patchSchema>

/** Markdown that holds no content, put between two lists that would otherwise merge. */
export const SEPARATOR = '<!-- -->'
/** The inline tag that carries one ADF node as JSON, with a readable label inside. */
export const NODE_TAG = 'adf-node'
/** The fence language that carries one ADF block node as JSON. */
export const FENCE = 'adf'

/** JSON safe inside an HTML comment or a single-quoted attribute: `<`, `>` and `'` become `\u` escapes. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>']/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/** `<!--adf paragraph {"attrs":{"localId":"a"}}-->`: a patch for the node of that type. */
export function note(type: string, patch: Patch): string {
  return `<!--adf ${type} ${safeJson(patch)}-->`
}

export const NOTE = /^<!--adf (\w+) (.*?)-->$/

export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item,
  )
}

/** Deep equality of JSON values, blind to key order. */
export function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

/** A document nested past the stack overflows the recursive readers, so it is refused instead. */
export function refuseDeepNesting<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof RangeError) {
      throw new JiraMgrError('validation_failed', 'The document is nested too deeply to convert.', {
        cause: error,
      })
    }
    throw error
  }
}
