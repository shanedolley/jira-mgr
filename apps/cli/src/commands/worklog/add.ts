import { markdownToAdf } from '@jira-mgr/core/adf'
import { addWorklog, type Worklog } from '@jira-mgr/core/extras'
import { assertInProject } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'

/** `jm worklog add <key>`: core sends `adjustEstimate=auto`, so the remaining estimate falls by the time logged. */
export const add: Handler<SpecOf<'worklog add'>, Worklog> = {
  async run({ key, time, started, comment }, ctx) {
    await assertInProject(key)
    return addWorklog(ctx.http(), key, {
      timeSpent: time,
      started,
      comment: comment === undefined ? undefined : markdownToAdf(comment),
    })
  },

  render: ({ id, timeSpent }) => `Logged ${timeSpent} (worklog ${id})`,
}
