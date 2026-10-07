import { resumeTimer } from '@jira-mgr/core/timer'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'
import { describeTimer, renderStatus, type TimerStatus } from './shared.js'

/** `jm timer resume`: resuming a running timer changes nothing. */
export const resume: Handler<SpecOf<'timer resume'>, TimerStatus> = {
  async run(_input, ctx) {
    return describeTimer(await resumeTimer({ now: () => ctx.now() }), ctx.now())
  },

  render: (data, tty) => renderStatus(tty, data),
}
