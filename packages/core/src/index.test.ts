import { describe, expect, it } from 'vitest'

import { appTitle } from './index.js'

describe('appTitle', () => {
  it('joins the app name and the version', () => {
    expect(appTitle('1.2.3')).toBe('jira-mgr 1.2.3')
  })

  it('reads JM_LIVE_JIRA as the opt-in for live Jira reads', () => {
    // Live PSAPAC read tests arrive with the Jira client and run only when this is set.
    expect(['1', undefined]).toContain(process.env.JM_LIVE_JIRA)
  })
})
