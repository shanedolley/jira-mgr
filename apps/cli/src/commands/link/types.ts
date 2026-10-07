import { listLinkTypes, type LinkType } from '@jira-mgr/core/extras'

import type { Handler } from '../../context.js'
import { renderTable } from '../../output.js'
import type { SpecOf } from '../../schema.js'

/** `jm link types`: every link type with its two phrases, the words `jm link add` matches. */
export const types: Handler<SpecOf<'link types'>, LinkType[]> = {
  async run(_input, ctx) {
    const found = await listLinkTypes(ctx.http())
    if (found.length === 0 && !ctx.json) ctx.io.stderr.write('No link types.\n')
    return found
  },

  render: (found, tty) =>
    found.length === 0
      ? ''
      : renderTable(
          tty,
          [{ header: 'ID' }, { header: 'NAME' }, { header: 'OUTWARD' }, { header: 'INWARD' }],
          found.map((t) => [t.id, t.name, t.outward, t.inward]),
        ),
}
