import { removeAttachment } from '@jira-mgr/core/extras'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'

/**
 * `jm attach remove <attachment-id>`: no `--confirm`, per the design's safety rules (Q3 a). The
 * command takes no issue key, so the project check cannot run; Jira's own permissions apply.
 */
export const remove: Handler<SpecOf<'attach remove'>, { attachmentId: string }> = {
  async run({ attachmentId }, ctx) {
    await removeAttachment(ctx.http(), attachmentId)
    return { attachmentId }
  },

  render: ({ attachmentId }) => `Removed attachment ${attachmentId}`,
}
