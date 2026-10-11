import { JiraMgrError } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { unwrap } from './ipc'
import { loadErrorCopy } from './loadErrorCopy'

const failed = (error: Parameters<typeof unwrap>[0] & { ok: false }): JiraMgrError => {
  try {
    unwrap(error)
  } catch (cause) {
    return cause as JiraMgrError
  }
  throw new Error('unwrap did not throw')
}

describe('loadErrorCopy', () => {
  it('says the thing is gone when Jira answered not found', () => {
    const error = failed({
      ok: false,
      error: { code: 'not_found', message: 'Jira answered 404.', status: 404 },
    })
    expect(loadErrorCopy('this issue', error)).toBe('This issue no longer exists in Jira.')
    expect(loadErrorCopy('the description', error)).toBe(
      'The description no longer exists in Jira.',
    )
    expect(loadErrorCopy('the comments', error)).toBe('The comments no longer exist in Jira.')
  })

  it('blames Jira, not the connection, for a server fault', () => {
    for (const status of [500, 502, 503]) {
      const error = failed({
        ok: false,
        error: { code: 'jira_error', message: `Jira answered ${String(status)}.`, status },
      })
      expect(loadErrorCopy('this issue', error)).toBe('Jira had a problem. Retry in a minute.')
    }
  })

  it('keeps the connection line when Jira never answered', () => {
    const error = failed({
      ok: false,
      error: { code: 'jira_error', message: 'Cannot reach Jira for GET /issue.' },
    })
    expect(loadErrorCopy('the comments', error)).toBe(
      'Could not load the comments. Retry, or check your connection.',
    )
  })

  it('keeps the connection line for a status below 500 that is not a refusal', () => {
    const error = failed({
      ok: false,
      error: { code: 'jira_error', message: 'Jira answered 429.', status: 429 },
    })
    expect(loadErrorCopy('this issue', error)).toBe(
      'Could not load this issue. Retry, or check your connection.',
    )
  })

  it('keeps the log-in line for a refusal', () => {
    const error = failed({
      ok: false,
      error: { code: 'permission_denied', message: 'Jira answered 401.', status: 401 },
    })
    expect(loadErrorCopy('this issue', error)).toBe(
      'Could not load this issue. Retry, or log in again.',
    )
  })
})
