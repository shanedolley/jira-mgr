import { readTimer } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'
import { describeTimer, renderStatus, type TimerStatus } from './shared.js'

/** `jm timer status`: reads `timer.json` and settings only, so it needs no login. */
export const status: Handler<SpecOf<'timer status'>, TimerStatus | null> = {
  async run(_input, ctx) {
    const timer = await readTimer()
    if (timer === null) {
      if (!ctx.json) ctx.io.stderr.write('No timer is running.\n')
      return null
    }
    return describeTimer(timer, ctx.now())
  },

  render: (data, tty) => (data === null ? '' : renderStatus(tty, data)),
}
