import { JIRA_SITE, loadFixture, serveRecorded } from '@jira-mgr/core/test/msw'
import { writeSettings } from '@jira-mgr/core/state'
import { describe, expect, it } from 'vitest'

import { COMMANDS } from './schema.js'
import { createContext } from './context.js'
import { EMAIL, fakeSecurity, TOKEN, useEmptyState } from './test-auth.js'
import { fakeIo } from './test-io.js'

useEmptyState()

async function contextWith(security = fakeSecurity()) {
  await security.keychain.set(EMAIL, TOKEN)
  await writeSettings({ siteUrl: JIRA_SITE, projectKey: 'PSAPAC', email: EMAIL })
  return createContext(fakeIo().io, { keychain: security.keychain }, true, COMMANDS, {})
}

describe('Context.me', () => {
  it('asks Jira once however often it is called, signing with the Keychain token', async () => {
    const requests = serveRecorded(() => Response.json(loadFixture('myself')))
    const ctx = await contextWith()
    const [first, second] = await Promise.all([ctx.me(), ctx.me()])
    expect(await ctx.me()).toBe(first)
    expect(second).toBe(first)
    expect(first).toEqual({
      accountId: '712020:16f8dbe7-f120-4043-bcaf-e06ef7156d34',
      displayName: 'Shane Dolley',
    })
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /rest/api/3/myself'])
    expect(requests[0]?.headers.get('authorization')).toBe(
      `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`,
    )
  })

  it('rejects with permission_denied when no one is logged in', async () => {
    const requests = serveRecorded(() => Response.json(loadFixture('myself')))
    const ctx = createContext(
      fakeIo().io,
      { keychain: fakeSecurity().keychain },
      true,
      COMMANDS,
      {},
    )
    await expect(ctx.me()).rejects.toMatchObject({ code: 'permission_denied' })
    expect(requests).toEqual([])
  })
})
