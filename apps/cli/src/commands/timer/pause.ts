import { pauseTimer } from '@jira-mgr/core/timer'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'
import { describeTimer, renderStatus, type TimerStatus } from './shared.js'

/** `jm timer pause`: pausing a paused timer changes nothing. */
export const pause: Handler<SpecOf<'timer pause'>, TimerStatus> = {
  async run(_input, ctx) {
    return describeTimer(await pauseTimer({ now: () => ctx.now() }), ctx.now())
  },

  render: (data, tty) => renderStatus(tty, data),
}
