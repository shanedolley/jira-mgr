import { addComment, type IssueComment } from '@jira-mgr/core/extras'
import { assertInProject } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'
import { readBody } from './body.js'

/** `jm comment add <key>`: one comment from Markdown or raw ADF. */
export const add: Handler<SpecOf<'comment add'>, IssueComment> = {
  async run(input, ctx) {
    await assertInProject(input.key)
    const body = await readBody(ctx, input)
    return addComment(ctx.http(), input.key, body)
  },

  render: ({ id }) => `Added comment ${id}`,
}
