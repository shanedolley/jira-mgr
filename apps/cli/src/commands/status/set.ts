import { getIssue } from '@jira-mgr/core/search'
import { assertInProject } from '@jira-mgr/core/state'
import { transitionIssue } from '@jira-mgr/core/write'

import type { Handler } from '../../context.js'
import { stripControl } from '../../output.js'
import type { SpecOf } from '../../schema.js'

interface Moved {
  key: string
  status: string
  changed: boolean
}

/** `jm status set <key> <status>`: moves to a status by name or id, or does nothing when already there. */
export const set: Handler<SpecOf<'status set'>, Moved> = {
  async run({ key, status: given }, ctx) {
    await assertInProject(key)
    const status = given.trim()
    const { status: current } = await getIssue(ctx.http(), key, { signal: ctx.signal })
    if (current.id === status || current.name.toLowerCase() === status.toLowerCase()) {
      return { key, status: current.name, changed: false }
    }
    return { key, status: await transitionIssue(ctx.http(), key, status), changed: true }
  },

  render: ({ key, status, changed }) =>
    `${key} ${changed ? 'is now' : 'is already'} ${stripControl(status)}`,
}
