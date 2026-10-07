import { adfToMarkdown } from '@jira-mgr/core/adf'
import { listWorklogs, type Worklog } from '@jira-mgr/core/extras'

import type { Handler } from '../../context.js'
import { localDateTime, renderTable } from '../../output.js'
import type { SpecOf } from '../../schema.js'

/** `jm worklog list <key>`: every worklog, with its id for `edit` and `delete`. */
export const list: Handler<SpecOf<'worklog list'>, Worklog[]> = {
  async run({ key }, ctx) {
    const worklogs = await listWorklogs(ctx.http(), key)
    if (worklogs.length === 0 && !ctx.json) ctx.io.stderr.write('No worklogs.\n')
    return worklogs
  },

  render: (worklogs, tty) =>
    worklogs.length === 0
      ? ''
      : renderTable(
          tty,
          [
            { header: 'ID' },
            { header: 'STARTED' },
            { header: 'TIME' },
            { header: 'AUTHOR', max: 20 },
            { header: 'COMMENT' },
          ],
          worklogs.map((w) => [
            w.id,
            localDateTime(w.started),
            w.timeSpent,
            w.author?.displayName ?? '',
            w.comment === null ? '' : adfToMarkdown(w.comment),
          ]),
        ),
}
