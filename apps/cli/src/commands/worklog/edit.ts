import { markdownToAdf } from '@jira-mgr/core/adf'
import { editWorklog, type Worklog } from '@jira-mgr/core/extras'
import { assertInProject } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'

/** `jm worklog edit <key> <worklog-id>`: core refuses an edit with nothing to change before any request. */
export const edit: Handler<SpecOf<'worklog edit'>, Worklog> = {
  async run({ key, worklogId, time, started, comment }, ctx) {
    await assertInProject(key)
    return editWorklog(ctx.http(), key, worklogId, {
      timeSpent: time,
      started,
      comment: comment === undefined ? undefined : markdownToAdf(comment),
    })
  },

  render: ({ id, timeSpent }) => `Updated worklog ${id} (${timeSpent})`,
}
