import { JiraMgrError } from '@jira-mgr/core'
import { getIssue } from '@jira-mgr/core/search'
import { deleteIssue } from '@jira-mgr/core/write'

import type { Handler } from '../../context.js'
import { stripControl } from '../../output.js'
import type { SpecOf } from '../../schema.js'
import { assertInProject } from '../../site.js'

interface Deleted {
  key: string
  deletedSubtasks: string[]
}

/** `jm issue delete <key>`: needs `--confirm`, and `--with-subtasks` when the issue has subtasks. */
export const del: Handler<SpecOf<'issue delete'>, Deleted> = {
  async run({ key, confirm, withSubtasks }, ctx) {
    // Checked before any request, so a forgotten flag or a foreign key costs nothing.
    await assertInProject(key)
    if (!confirm) {
      throw new JiraMgrError('validation_failed', `Deleting ${key} is permanent. Pass --confirm.`)
    }
    const { subtasks } = await getIssue(ctx.http(), key, { signal: ctx.signal })
    const keys = subtasks.map((s) => s.key)
    if (keys.length > 0 && !withSubtasks) {
      throw new JiraMgrError(
        'validation_failed',
        `${key} has subtasks ${keys.join(', ')}. Pass --with-subtasks to delete them too.`,
        { details: { subtasks: keys } },
      )
    }
    await deleteIssue(ctx.http(), key, { deleteSubtasks: withSubtasks })
    return { key, deletedSubtasks: withSubtasks ? keys : [] }
  },

  render: ({ key, deletedSubtasks }) =>
    deletedSubtasks.length === 0
      ? `Deleted ${stripControl(key)}`
      : `Deleted ${stripControl(key)} and its subtasks ${stripControl(deletedSubtasks.join(', '))}`,
}
