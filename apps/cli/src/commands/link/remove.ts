import { getLink, removeLink } from '@jira-mgr/core/extras'
import { assertInProject } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import type { SpecOf } from '../../schema.js'

/**
 * `jm link remove <link-id>`: no `--confirm`, per the design's safety rules (Q3 a). A link id
 * names no issue, so the link is read first and both its issues must be in the project.
 */
export const remove: Handler<SpecOf<'link remove'>, { linkId: string }> = {
  async run({ linkId }, ctx) {
    const link = await getLink(ctx.http(), linkId)
    await assertInProject(link.inwardKey)
    await assertInProject(link.outwardKey)
    await removeLink(ctx.http(), linkId)
    return { linkId }
  },

  render: ({ linkId }) => `Removed link ${linkId}`,
}
