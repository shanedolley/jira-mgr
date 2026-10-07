import { editComment, type IssueComment } from '@jira-mgr/core/extras'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'
import { assertInProject } from '../../site.js'
import { readBody } from './body.js'

/** `jm comment edit <key> <comment-id>`: replaces the body. Jira answers 403, exit 4, for another user's comment. */
export const edit: Handler<SpecOf<'comment edit'>, IssueComment> = {
  async run(input, ctx) {
    await assertInProject(input.key)
    const body = await readBody(ctx, input)
    return editComment(ctx.http(), input.key, input.commentId, body)
  },

  render: ({ id }) => `Edited comment ${id}`,
}
