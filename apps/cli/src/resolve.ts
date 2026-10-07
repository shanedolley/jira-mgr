import { JiraMgrError } from '@jira-mgr/core'
import { listLinkTypes, type LinkType } from '@jira-mgr/core/extras'
import { getFieldOptions, searchAssignableUsers } from '@jira-mgr/core/lookups'
import { findBoard, listSprints, type Sprint } from '@jira-mgr/core/sprints'

import type { Context } from './context.js'

const LABELS = { customer: 'Customer', engagement: 'Engagement', priority: 'priority' } as const

/**
 * The option id for a Customer, Engagement or priority given as an id or as a name in any case.
 * An id wins over a name. An unknown or ambiguous value throws `validation_failed` listing the choices.
 */
export async function resolveOption(
  ctx: Context,
  field: keyof typeof LABELS,
  value: string,
): Promise<string> {
  const options = await getFieldOptions(ctx.http(), field)
  const trimmed = value.trim()
  const byId = options.find((o) => o.id === trimmed)
  if (byId) return byId.id
  const wanted = trimmed.toLowerCase()
  const matches = options.filter((o) => o.name.toLowerCase() === wanted)
  const [only] = matches
  if (matches.length === 1 && only) return only.id
  const choices = (matches.length > 1 ? matches : options).map((o) => `${o.name} (${o.id})`)
  throw new JiraMgrError(
    'validation_failed',
    `${matches.length > 1 ? 'More than one' : 'No'} ${LABELS[field]} matches "${value}". Choose one of: ${choices.join(', ')}.`,
    {
      details: {
        choices: (matches.length > 1 ? matches : options).map(({ id, name }) => ({ id, name })),
      },
    },
  )
}

/** Atlassian account ids: 24 hex digits, or a number, a colon and a UUID. */
const ACCOUNT_ID =
  /^(?:[0-9a-f]{24}|\d+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/**
 * The account id for `me`, an account id, or a name that matches exactly one assignable user.
 * An account id goes through as given, since Jira checks it on the write.
 */
export async function resolveAssignee(ctx: Context, value: string): Promise<string> {
  if (value.toLowerCase() === 'me') return (await ctx.me()).accountId
  if (ACCOUNT_ID.test(value)) return value
  const users = await searchAssignableUsers(ctx.http(), value)
  const [only] = users
  if (users.length === 1 && only) return only.accountId
  const list = users.map((u) => `${u.displayName} (${u.accountId})`)
  throw new JiraMgrError(
    'validation_failed',
    users.length === 0
      ? `No assignable user matches "${value}".`
      : `More than one user matches "${value}": ${list.join(', ')}. Use an account id.`,
    { details: { users: users.map(({ accountId, displayName }) => ({ accountId, displayName })) } },
  )
}

/** A link type and the side of it a phrase names: `outward` reads "A <outward> B", `inward` "A <inward> B". */
export interface LinkChoice {
  type: LinkType
  direction: 'outward' | 'inward'
}

/**
 * The link type and direction a phrase names. A type's name, in any case, wins first and reads
 * outward: names are unique, while a phrase can belong to two types ("is caused by"). Otherwise the
 * phrase matches a type's outward text (outward) or its inward text (inward). A phrase that
 * matches no type, or more than one, throws `validation_failed`.
 */
export async function resolveLink(ctx: Context, phrase: string): Promise<LinkChoice> {
  const types = await listLinkTypes(ctx.http())
  const wanted = phrase.trim().toLowerCase()
  const is = (text: string) => text.toLowerCase() === wanted
  const named = types.find((type) => is(type.name))
  if (named) return { type: named, direction: 'outward' }
  const matches = types.flatMap((type): LinkChoice[] => {
    if (is(type.outward)) return [{ type, direction: 'outward' }]
    return is(type.inward) ? [{ type, direction: 'inward' }] : []
  })
  const [only] = matches
  if (matches.length === 1 && only) return only
  if (matches.length === 0) {
    throw new JiraMgrError(
      'validation_failed',
      `No link type matches "${phrase}". Run \`jm link types\` to see the names and phrases.`,
    )
  }
  const names = matches.map(({ type }) => type.name)
  throw new JiraMgrError(
    'validation_failed',
    `More than one link type matches "${phrase}": ${names.join(', ')}. Give a type name instead, such as "${names[0] ?? ''}": it reads outward, so swap the two issues for the inward side.`,
    { details: { types: matches.map(({ type }) => ({ id: type.id, name: type.name })) } },
  )
}

const MAX_LISTED = 10

/**
 * The active or future sprint named by an id, a name in any case or `current`. Closed sprints are
 * out of reach, since Jira refuses to move issues into them. An unknown or ambiguous value, or
 * `current` with no active sprint or several, throws `validation_failed` listing the choices.
 */
export async function resolveSprint(ctx: Context, value: string): Promise<Sprint> {
  const http = ctx.http()
  const board = await findBoard(http)
  if (board === null) {
    throw new JiraMgrError('not_found', 'The project has no board that supports sprints.')
  }
  const sprints = await listSprints(http, board.id)
  const wanted = value.trim().toLowerCase()
  const byId = sprints.filter((s) => String(s.id) === wanted)
  const byName = sprints.filter((s) => s.name.toLowerCase() === wanted)
  const matches =
    wanted === 'current'
      ? sprints.filter((s) => s.state === 'active')
      : byId.length > 0
        ? byId
        : byName
  const [only] = matches
  if (matches.length === 1 && only) return only
  const shown = matches.length > 0 ? matches : sprints
  const list = shown.slice(0, MAX_LISTED).map((s) => `${s.name} (${String(s.id)})`)
  const more = shown.length > MAX_LISTED ? ` and ${String(shown.length - MAX_LISTED)} more` : ''
  const problem =
    wanted === 'current'
      ? matches.length === 0
        ? 'No sprint is active.'
        : 'More than one sprint is active.'
      : `${matches.length > 1 ? 'More than one' : 'No active or future'} sprint matches "${value}".`
  throw new JiraMgrError(
    'validation_failed',
    `${problem} Choose one of: ${list.join(', ')}${more}.`,
    {
      details: { choices: shown.map(({ id, name, state }) => ({ id, name, state })) },
    },
  )
}
