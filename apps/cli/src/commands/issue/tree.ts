import { buildHierarchy, type CustomerGroup } from '@jira-mgr/core/hierarchy'
import { getFieldOptions } from '@jira-mgr/core/lookups'

import type { Handler } from '../../context.js'
import { renderTree } from '../../output.js'
import type { SpecOf } from '../../schema.js'
import { loadIssues } from './load.js'

/** `jm issue tree`: the same issues as `issue list`, grouped by Customer and Epic. */
export const tree: Handler<SpecOf<'issue tree'>, CustomerGroup[]> = {
  async run(input, ctx) {
    const { issues, match, toggles, accountId } = await loadIssues(ctx, input, {
      showEmptyCustomers: input.showEmptyCustomers,
    })
    const customers = toggles.hideEmptyCustomers
      ? undefined
      : (await getFieldOptions(ctx.http(), 'customer')).map((c) => ({ id: c.id, value: c.name }))
    const groups = buildHierarchy(issues, { ...toggles, accountId, customers, match })
    if (groups.length === 0 && !ctx.json) ctx.io.stderr.write('No issues match.\n')
    return groups
  },

  render: (groups, tty) => renderTree(tty, groups),
}
