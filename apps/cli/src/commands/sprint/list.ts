import { JiraMgrError } from '@jira-mgr/core'
import { findBoard, listSprints, type Sprint } from '@jira-mgr/core/sprints'

import type { Handler } from '../../context.js'
import { localDateTime, renderTable } from '../../output.js'
import type { SpecOf } from '../../schema.js'

const when = (iso: string | null) => (iso === null ? '-' : localDateTime(iso))

/**
 * `jm sprint list`: the active sprint and the dated future sprints. A future sprint with no dates,
 * such as a template, shows only with `--all`, which also adds closed sprints (Q20). An active
 * sprint always shows, dated or not.
 */
export const list: Handler<SpecOf<'sprint list'>, Sprint[]> = {
  async run({ all }, ctx) {
    const http = ctx.http()
    const board = await findBoard(http)
    if (board === null) {
      throw new JiraMgrError('not_found', 'The project has no board that supports sprints.')
    }
    const sprints = await listSprints(http, board.id, { all })
    const shown = all
      ? sprints
      : sprints.filter((s) => s.state !== 'future' || s.startDate !== null || s.endDate !== null)
    if (shown.length === 0 && !ctx.json) ctx.io.stderr.write('No sprints.\n')
    return shown
  },

  render: (sprints, tty) =>
    sprints.length === 0
      ? ''
      : renderTable(
          tty,
          [
            { header: 'ID' },
            { header: 'STATE' },
            { header: 'START' },
            { header: 'END' },
            { header: 'NAME' },
          ],
          sprints.map((s) => [String(s.id), s.state, when(s.startDate), when(s.endDate), s.name]),
        ),
}
