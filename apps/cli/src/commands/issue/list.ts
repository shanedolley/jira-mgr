import type { Issue } from '@jira-mgr/core'

import type { Handler } from '../../context.js'
import { renderTable, statusStyle } from '../../output.js'
import type { SpecOf } from '../../schema.js'
import { loadIssues } from './load.js'

/** `jm issue list`: the filtered issues as a flat table. Settings toggles do not apply. */
export const list: Handler<SpecOf<'issue list'>, Issue[]> = {
  async run(input, ctx) {
    const { issues, wanted } = await loadIssues(ctx, input, { limit: input.limit })
    const found = issues.filter(wanted).slice(0, input.limit)
    if (found.length === 0 && !ctx.json) ctx.io.stderr.write('No issues match.\n')
    return found
  },

  render: (issues, tty) =>
    issues.length === 0
      ? ''
      : renderTable(
          tty,
          [
            { header: 'KEY' },
            { header: 'TYPE' },
            {
              header: 'STATUS',
              paint: (cell, row) => statusStyle(tty, issues[row]?.status.category ?? '', cell),
            },
            { header: 'ASSIGNEE', max: 20 },
            { header: 'CUSTOMER', max: 24 },
            { header: 'SUMMARY' },
          ],
          issues.map((i) => [
            i.key,
            i.issueType.name,
            i.status.name,
            i.assignee?.displayName ?? '-',
            i.customer?.value ?? '-',
            i.summary,
          ]),
        ),
}
