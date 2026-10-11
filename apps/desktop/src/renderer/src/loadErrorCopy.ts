import type { JiraMgrError } from '@jira-mgr/core'

import { statusOf } from './ipc'

/**
 * The sentence a failed read shows, by cause: refused, gone, Jira's own fault, or the connection.
 * `what` is what did not load: "this issue", "the description", "the comments".
 */
export function loadErrorCopy(what: string, error: JiraMgrError): string {
  if (error.code === 'permission_denied') return `Could not load ${what}. Retry, or log in again.`
  if (error.code === 'not_found') {
    const gone = what.charAt(0).toUpperCase() + what.slice(1)
    // ponytail: a trailing "s" picks "exist", wrong for a singular such as "this status"; pass the verb if one appears
    return `${gone} no longer ${what.endsWith('s') ? 'exist' : 'exists'} in Jira.`
  }
  const status = statusOf(error)
  if (status !== undefined && status >= 500) return 'Jira had a problem. Retry in a minute.'
  return `Could not load ${what}. Retry, or check your connection.`
}
