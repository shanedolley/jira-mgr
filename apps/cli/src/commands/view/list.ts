import { readViews, type SavedView } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import { renderTable } from '../../output.js'
import type { SpecOf } from '../../schema.js'

/** The filters and toggles a view sets, in one cell: `status=To Do; not.label=etl; due=overdue; mine`. */
function describe(view: SavedView): string {
  const { text, dates = {}, not = {}, ...lists } = view.filters
  const named = (prefix: string, fields: Record<string, string[] | undefined>) =>
    Object.entries(fields).flatMap(([field, values]) =>
      values === undefined ? [] : [`${prefix}${field}=${values.join(',')}`],
    )
  const parts = [
    ...named('', lists),
    ...named('not.', not),
    ...Object.entries(dates).map(([field, preset]) => `${field}=${preset}`),
  ]
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
