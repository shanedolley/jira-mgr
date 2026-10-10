import { describe, expect, it } from 'vitest'

import { plainMessage } from './Failure'

describe('plainMessage', () => {
  it('drops the request Jira answered, keeping its reason', () => {
    expect(
      plainMessage(
        'Jira answered 500 to GET /rest/api/3/issue/PSAPAC-2: The fake failed. Try again.',
      ),
    ).toBe('Jira answered 500: The fake failed. Try again.')
    expect(plainMessage('Jira answered 404 to GET /rest/api/3/attachment/content/10.')).toBe(
      'Jira answered 404.',
    )
  })

  it('names the request generically where the label led or followed another word', () => {
    expect(plainMessage('GET /rest/api/3/search did not finish within 30 seconds.')).toBe(
      'The request did not finish within 30 seconds.',
    )
    expect(plainMessage('Cannot reach Jira for POST /rest/api/3/issue. Check your network.')).toBe(
      'Cannot reach Jira for the request. Check your network.',
    )
  })

  it('leaves a message with no request alone', () => {
    expect(plainMessage('Jira answered 401 to the login check.')).toBe(
      'Jira answered 401 to the login check.',
    )
  })
})
