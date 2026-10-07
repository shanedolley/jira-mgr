import { readSettings, writeSettings } from '@jira-mgr/core/state'
import { JIRA_SITE, serveRecorded } from '@jira-mgr/core/test/msw'
import { describe, expect, it } from 'vitest'

import { run } from '../../run.js'
import { COMMANDS, type CommandSpec } from '../../schema.js'
import { EMAIL, expectNoToken, fakeSecurity, TOKEN, useEmptyState } from '../../test-auth.js'
import { fakeIo } from '../../test-io.js'
import { expectShape } from '../../test-shape.js'

const spec: CommandSpec | undefined = COMMANDS.find((c) => c.path.join(' ') === 'auth logout')

useEmptyState()

async function loggedIn(extra: Record<string, string> = {}) {
  const security = fakeSecurity()
  await security.keychain.set(EMAIL, TOKEN)
  for (const [email, token] of Object.entries(extra)) await security.keychain.set(email, token)
  await writeSettings({ siteUrl: JIRA_SITE, projectKey: 'PSAPAC', email: EMAIL })
  return security
}

describe('jm auth logout', () => {
  it('removes the token and the email and keeps the site and project', async () => {
    const requests = serveRecorded(() => Response.json({}))
    const { items, calls, keychain } = await loggedIn()
    const f = fakeIo()
    expect(await run(['auth', 'logout'], f.io, { keychain })).toBe(0)
    const json = JSON.parse(f.stdout) as { data: unknown }
    expect(json).toEqual({ data: { loggedOut: true } })
    expectShape(json.data, spec?.output.example)
    expect(f.stderr).toBe('')
    expect(items.size).toBe(0)
    expect(calls.at(-1)?.args).toEqual(['delete-generic-password', '-s', 'jira-mgr'])
    const settings = await readSettings()
    expect([settings.siteUrl, settings.projectKey, settings.email]).toEqual([
      JIRA_SITE,
      'PSAPAC',
      undefined,
    ])
    expect(requests).toEqual([])
  })

  it('removes every jira-mgr item, whatever its account', async () => {
    const { items, keychain } = await loggedIn({ 'old@example.com': 'old-token' })
    expect(items.size).toBe(2)
    const f = fakeIo()
    expect(await run(['auth', 'logout'], f.io, { keychain })).toBe(0)
    expect(items.size).toBe(0)
  })

  it('logout exits 0 when logged out', async () => {
    const { keychain } = fakeSecurity()
    for (let i = 0; i < 2; i++) {
      const f = fakeIo()
      expect(await run(['auth', 'logout'], f.io, { keychain })).toBe(0)
      expect(JSON.parse(f.stdout)).toEqual({ data: { loggedOut: true } })
    }
  })

  it('prints a confirmation on a terminal', async () => {
    const { keychain } = await loggedIn()
    const f = fakeIo({ stdoutIsTTY: true, env: { NO_COLOR: '1' } })
    expect(await run(['auth', 'logout'], f.io, { keychain })).toBe(0)
    expect(f.stdout).toBe('Logged out. The token is removed from the Keychain.\n')
    expect(f.stderr).toBe('')
  })

  it('a Keychain failure exits 1, keeps the settings and never prints the token', async () => {
    await loggedIn()
    const f = fakeIo()
    expect(
      await run(['auth', 'logout'], f.io, { keychain: fakeSecurity({ fail: true }).keychain }),
    ).toBe(1)
    expect(JSON.parse(f.stdout)).toEqual({
      error: { code: 'internal', message: 'Keychain delete failed (security exited 1).' },
    })
    expectNoToken(f)
    expect((await readSettings()).email).toBe(EMAIL)
  })

  it('a Keychain failure prints jm: and the message on a terminal', async () => {
    const f = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true, env: { NO_COLOR: '1' } })
    expect(
      await run(['auth', 'logout'], f.io, { keychain: fakeSecurity({ fail: true }).keychain }),
    ).toBe(1)
    expect(f.stdout).toBe('')
    expect(f.stderr).toBe('jm: Keychain delete failed (security exited 1).\n')
  })
})
