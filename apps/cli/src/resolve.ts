import { JiraMgrError } from '@jira-mgr/core'
import { getFieldOptions, searchAssignableUsers } from '@jira-mgr/core/lookups'

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
