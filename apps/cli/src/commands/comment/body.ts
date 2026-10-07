import { JiraMgrError } from '@jira-mgr/core'
import type { AdfDoc } from '@jira-mgr/core/adf'

import type { Context } from '../../context.js'
import { readRichText } from '../../input.js'

/** The comment body from `--body`, `--body-file` or `--adf`. Commander has refused any two together. */
export async function readBody(
  ctx: Context,
  input: { body?: string; bodyFile?: string; adf?: string },
): Promise<AdfDoc> {
  const doc = await readRichText(ctx, {
    markdown: input.body,
    file: input.bodyFile,
    adf: input.adf,
  })
  if (doc === undefined) {
    throw new JiraMgrError('validation_failed', 'Give one of --body, --body-file or --adf.')
  }
  return doc
}
