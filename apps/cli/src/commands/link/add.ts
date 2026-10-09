import { JiraMgrError } from '@jira-mgr/core'
import { addLink, listLinks } from '@jira-mgr/core/extras'
import { assertInProject } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import { stripControl } from '../../output.js'
import { resolveLink } from '../../resolve.js'
import type { SpecOf } from '../../schema.js'

interface Added {
  id: string
  type: string
  direction: 'outward' | 'inward'
  key: string
  otherKey: string
}

/** The phrase each result was added with, so the TTY line can read "A blocks B" without widening the JSON. */
const phrases = new WeakMap<Added, string>()

/**
 * `jm link add <key> <phrase> <other-key>`. Jira answers with no body, so the new link's id is the
 * highest matching id `listLinks` shows afterwards, since ids only grow.
 */
export const add: Handler<SpecOf<'link add'>, Added> = {
  async run({ key, phrase, otherKey }, ctx) {
    await assertInProject(key)
    await assertInProject(otherKey)
    const { type, direction } = await resolveLink(ctx, phrase)
    await addLink(ctx.http(), { type: { id: type.id }, key, direction, otherKey })
    // The link now exists, so a failed read must not invite a retry: that would add a second one.
    const links = await listLinks(ctx.http(), key).catch((error: unknown) => {
      if (!(error instanceof JiraMgrError)) throw error
      throw new JiraMgrError(
        error.code,
        `The link was added, but reading the links of ${key} failed. Run \`jm link list ${key}\` to find its id. Do not run link add again.`,
        { details: error.details, cause: error },
      )
    })
    const ids = links
      .filter((l) => l.type.id === type.id && l.direction === direction && l.issue.key === otherKey)
      .map((l) => Number(l.id))
    if (ids.length === 0) {
      throw new JiraMgrError(
        'jira_error',
        `The link was added, but ${key} does not list it. Run \`jm link list ${key}\` to find it. Do not run link add again.`,
      )
    }
    const added: Added = {
      id: String(Math.max(...ids)),
      type: type.name,
      direction,
      key,
      otherKey,
    }
    phrases.set(added, direction === 'outward' ? type.outward : type.inward)
    return added
  },

  render: (added) =>
    `${added.key} ${stripControl(phrases.get(added) ?? added.type)} ${added.otherKey} (link ${added.id})`,
}
