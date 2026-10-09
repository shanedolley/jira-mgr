import type { Worklog } from '@jira-mgr/core/extras'
import { getIssue } from '@jira-mgr/core/search'
import { assertInProject } from '@jira-mgr/core/state'
import { switchAndLog } from '@jira-mgr/core/timer'
import { assertTimeable, type WorklogDraft } from '@jira-mgr/core/timer-calc'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'
import { describeTimer, renderStatus, withConfirmationHint, type TimerStatus } from './shared.js'

interface Started {
  timer: TimerStatus
  /** The draft of the timer this start switched away from. */
  stopped: WorklogDraft | null
  logged: Worklog | null
}

/**
 * `jm timer start <key>`: a timer running on another issue is logged first (`switchAndLog`), and
 * refused when its draft needs confirmation unless `--confirm`.
 */
export const start: Handler<SpecOf<'timer start'>, Started> = {
  async run({ key, expect, confirm }, ctx) {
    await assertInProject(key)
    const issue = await getIssue(ctx.http(), key, { signal: ctx.signal })
    assertTimeable(issue)
    const result = await switchAndLog(ctx.http(), issue, {
      now: () => ctx.now(),
      expectRunning: expect,
      confirm,
      signal: ctx.signal,
    }).catch((error: unknown) => {
      throw withConfirmationHint(
        error,
        (draft) =>
          `Pass --confirm to log it before switching to ${key}, run jm timer stop --time <duration> --expect ${draft.issueKey} to log another time, or run jm timer stop --discard to drop it.`,
      )
    })
    return {
      timer: await describeTimer(result.timer, ctx.now()),
      stopped: result.stopped,
      logged: result.logged?.worklog ?? null,
    }
  },

  render: ({ timer, stopped, logged }, tty) =>
    [
      ...(stopped === null || logged === null
        ? []
        : [`Logged ${stopped.timeSpent} on ${stopped.issueKey} (worklog ${logged.id})`]),
      renderStatus(tty, timer),
    ].join('\n'),
}
