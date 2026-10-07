import { readViews, type SavedView } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import { renderTable } from '../../output.js'
import type { SpecOf } from '../../schema.js'

/** The filters and toggles a view sets, in one cell: `status=To Do; label=etl; mine`. */
function describe(view: SavedView): string {
  const { text, ...lists } = view.filters
  const parts = Object.entries(lists).map(([field, values]) => `${field}=${values.join(',')}`)
  if (text !== undefined) parts.push(`text=${text}`)
  if (view.toggles.assigneeMe) parts.push('mine')
  if (!view.toggles.hideDone) parts.push('show done')
  if (!view.toggles.hideEmptyCustomers) parts.push('empty customers')
  return parts.join('; ')
}

/** `jm view list`: the saved views, whose ids and names `--view` takes. Reads the views file only. */
export const list: Handler<SpecOf<'view list'>, SavedView[]> = {
  async run(_input, ctx) {
    const views = await readViews()
    if (views.length === 0 && !ctx.json) ctx.io.stderr.write('No saved views.\n')
    return views
  },

  render: (views, tty) =>
    views.length === 0
      ? ''
      : renderTable(
          tty,
          [{ header: 'ID' }, { header: 'NAME' }, { header: 'FILTERS' }],
          views.map((v) => [v.id, v.name, describe(v)]),
        ),
}
