import { adfToMarkdown } from '@jira-mgr/core/adf'
import { listComments, type IssueComment } from '@jira-mgr/core/extras'

import type { Handler } from '../../context.js'
import { localDateTime, stripControl } from '../../output.js'
import type { SpecOf } from '../../schema.js'

type CommentData = IssueComment & { bodyMarkdown: string }

/** `jm comment list <key>`: every comment, oldest first, with its id for `edit` and `delete`. */
export const list: Handler<SpecOf<'comment list'>, CommentData[]> = {
  async run({ key }, ctx) {
    const comments = await listComments(ctx.http(), key)
    if (comments.length === 0 && !ctx.json) ctx.io.stderr.write('No comments.\n')
    return comments.map((c) => ({ ...c, bodyMarkdown: adfToMarkdown(c.body) }))
  },

  // A bold `id  author  time` line over each Markdown body.
  render: (comments, tty) =>
    comments
      .map((c) => {
        const head = `${c.id}  ${c.author?.displayName ?? 'Unknown'}  ${localDateTime(c.created)}`
        return `${tty.style('bold', stripControl(head))}\n${stripControl(c.bodyMarkdown)}`
      })
      .join('\n\n'),
}
