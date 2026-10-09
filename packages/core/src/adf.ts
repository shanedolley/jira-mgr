import { parseMarkdown } from './adf-parse.js'
import { renderBlocksToMarkdown } from './adf-render.js'
import { adfDocSchema, refuseDeepNesting, same, type AdfDoc } from './adf-schema.js'
import { JiraMgrError } from './errors.js'

export {
  adfDocSchema,
  adfNodeSchema,
  type AdfDoc,
  type AdfMark,
  type AdfNode,
} from './adf-schema.js'
export {
  adfToEditor,
  editorToAdf,
  equivalentAdf,
  imageNode,
  type EditorDoc,
  type EditorMark,
  type EditorNode,
} from './adf-editor.js'
/** Deep equality of two ADF values, blind to key order. */
export const sameAdf = same

/**
 * Markdown for an ADF document. Reading it back with `markdownToAdf` returns the same document,
 * node for node: whatever Markdown cannot say is written as `adf` fences and `<adf-node>` tags.
 * Throws `validation_failed` when `adf` is not an ADF document, or is nested too deeply.
 */
export function adfToMarkdown(adf: unknown): string {
  return refuseDeepNesting(() => {
    const parsed = adfDocSchema.safeParse(adf)
    if (!parsed.success) {
      throw new JiraMgrError(
        'validation_failed',
        'Not a valid ADF document (version 1, type doc).',
        {
          details: parsed.error.issues,
        },
      )
    }
    return renderBlocksToMarkdown(parsed.data.content)
  })
}

/** ADF for Markdown (GFM). Any text is valid Markdown. Throws `validation_failed` only when it is nested too deeply. */
export function markdownToAdf(markdown: string): AdfDoc {
  return refuseDeepNesting(() => ({ version: 1, type: 'doc', content: parseMarkdown(markdown) }))
}
