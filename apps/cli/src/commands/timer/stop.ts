import { markdownToAdf } from '@jira-mgr/core/adf'
import type { Worklog } from '@jira-mgr/core/extras'
import { stopAndLog, stopTimer } from '@jira-mgr/core/timer'
import type { WorklogDraft } from '@jira-mgr/core/timer-calc'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'
import { withConfirmationHint } from './shared.js'

interface Stopped {
  draft: WorklogDraft
  /** `null` with `--discard`. */
  worklog: Worklog | null
}

/**
 * `jm timer stop`: logs the draft, or with `--discard` drops it. A draft that needs confirmation
 * is refused unless `--confirm` or `--time` (which core requires `--expect` for).
 */
export const stop: Handler<SpecOf<'timer stop'>, Stopped | null> = {
  async run({ comment, time, expect, confirm, discard }, ctx) {
    if (discard) {
      const draft = await stopTimer({ now: () => ctx.now(), expectRunning: expect })
      return draft === null ? null : { draft, worklog: null }
    }
    const logged = await stopAndLog(ctx.http(), {
      now: () => ctx.now(),
      expectRunning: expect,
      timeSpent: time,
      confirm,
      signal: ctx.signal,
      ...(comment !== undefined && { comment: markdownToAdf(comment) }),
    }).catch((error: unknown) => {
      throw withConfirmationHint(
        error,
        (draft) =>
          `Pass --confirm to log it as is, or --time <duration> with --expect ${draft.issueKey} to log another time.`,
      )
    })
    return logged
  },

  render: (data) => {
    if (data === null) return ''
    const { draft, worklog } = data
    return worklog === null
      ? `Discarded the timer on ${draft.issueKey} (${draft.timeSpent} not logged)`
      : `Logged ${worklog.timeSpent} on ${draft.issueKey} (worklog ${worklog.id})`
  },
}
