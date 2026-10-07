import { listLinks, type IssueLink } from '@jira-mgr/core/extras'

import type { Handler } from '../../context.js'
import { renderTable } from '../../output.js'
import type { SpecOf } from '../../schema.js'

/** `jm link list <key>`: each link as seen from the issue, with its id for `link remove`. */
export const list: Handler<SpecOf<'link list'>, IssueLink[]> = {
  async run({ key }, ctx) {
    const links = await listLinks(ctx.http(), key)
    if (links.length === 0 && !ctx.json) ctx.io.stderr.write('No links.\n')
    return links
  },

  // The phrase reads from the listed issue: "blocks PSAPAC-13" means it blocks that one.
  render: (links, tty) =>
    links.length === 0
      ? ''
      : renderTable(
          tty,
          [
            { header: 'ID' },
            { header: 'LINK' },
            { header: 'KEY' },
            { header: 'STATUS', max: 24 },
            { header: 'SUMMARY' },
          ],
          links.map((l) => [
            l.id,
            l.direction === 'outward' ? l.type.outward : l.type.inward,
            l.issue.key,
            l.issue.status,
            l.issue.summary,
          ]),
        ),
}
