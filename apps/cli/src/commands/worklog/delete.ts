import { deleteWorklog } from '@jira-mgr/core/extras'
import { assertInProject } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'

interface Deleted {
  key: string
  worklogId: string
}

/** `jm worklog delete <key> <worklog-id>`: no `--confirm`, per the design's safety rules (Q3 a). */
export const del: Handler<SpecOf<'worklog delete'>, Deleted> = {
  async run({ key, worklogId }, ctx) {
    await assertInProject(key)
    await deleteWorklog(ctx.http(), key, worklogId)
    return { key, worklogId }
  },

  render: ({ key, worklogId }) => `Deleted worklog ${worklogId} from ${key}`,
}
