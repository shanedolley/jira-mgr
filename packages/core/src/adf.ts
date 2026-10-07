import { parseMarkdown } from './adf-parse.js'
import { renderBlocksToMarkdown } from './adf-render.js'
import { adfDocSchema, type AdfDoc } from './adf-schema.js'
import { JiraMgrError } from './errors.js'

export {
  adfDocSchema,
  adfNodeSchema,
  type AdfDoc,
  type AdfMark,
  type AdfNode,
} from './adf-schema.js'

/** A document nested past the stack overflows the recursive reader, so it is refused instead. */
function refuseDeepNesting<T>(run: () => T): T {
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
