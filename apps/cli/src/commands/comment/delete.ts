import { deleteComment } from '@jira-mgr/core/extras'
import { assertInProject } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'

interface Deleted {
  key: string
  commentId: string
}

/** `jm comment delete <key> <comment-id>`: no `--confirm`, per the design's safety rules (Q3 a). */
export const del: Handler<SpecOf<'comment delete'>, Deleted> = {
  async run({ key, commentId }, ctx) {
    await assertInProject(key)
    await deleteComment(ctx.http(), key, commentId)
    return { key, commentId }
  },

  render: ({ key, commentId }) => `Deleted comment ${commentId} from ${key}`,
}
