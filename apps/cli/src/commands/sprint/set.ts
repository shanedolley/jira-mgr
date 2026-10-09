import { JiraMgrError } from '@jira-mgr/core'
import { moveToBacklog, moveToSprint } from '@jira-mgr/core/sprints'
import { assertInProject } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import { stripControl } from '../../output.js'
import { resolveSprint } from '../../resolve.js'
import type { SpecOf } from '../../schema.js'

/** Jira moves at most this many issues in one call. */
const MAX_KEYS = 50

interface Moved {
  sprint: { id: number; name: string } | null
  keys: string[]
}

/** `jm sprint set <sprint> <key...>`: an active or future sprint by id, name or `current`, or `backlog`. */
export const set: Handler<SpecOf<'sprint set'>, Moved> = {
  async run({ sprint: given, key: keys }, ctx) {
    if (keys.length > MAX_KEYS) {
      throw new JiraMgrError(
        'validation_failed',
        `Got ${String(keys.length)} issue keys. Jira moves at most ${String(MAX_KEYS)} at a time.`,
      )
    }
    for (const key of keys) await assertInProject(key)
    if (given.trim().toLowerCase() === 'backlog') {
      await moveToBacklog(ctx.http(), keys)
      return { sprint: null, keys }
    }
    const { id, name } = await resolveSprint(ctx, given)
    await moveToSprint(ctx.http(), id, keys)
    return { sprint: { id, name }, keys }
  },

  render: ({ sprint, keys }) =>
    `Moved ${keys.join(', ')} to ${sprint === null ? 'the backlog' : stripControl(sprint.name)}`,
}
