import { createHttpClient } from '@jira-mgr/core/http'
import { JIRA_SITE, loadFixture, serveRecorded } from '@jira-mgr/core/test/msw'
import { writeFields, writeSettings } from '@jira-mgr/core/state'
import { describe, expect, it } from 'vitest'

import { run } from '../../run.js'
import { COMMANDS, type CommandSpec } from '../../schema.js'
import { EMAIL, expectNoToken, fakeSecurity, TOKEN, useEmptyState } from '../../test-auth.js'
import { fakeIo } from '../../test-io.js'
import { expectShape } from '../../test-shape.js'

const spec: CommandSpec | undefined = COMMANDS.find((c) => c.path.join(' ') === 'auth status')

const ACCOUNT_ID = '712020:16f8dbe7-f120-4043-bcaf-e06ef7156d34'
const NO_COLOR = { NO_COLOR: '1' }
const RESOLVED_AT = '2026-10-07T00:00:00.000Z'
const IDS = {
  customer: 'customfield_14849',
  engagement: 'customfield_14850',
  sprint: 'customfield_10600',
  startDate: 'customfield_13808',
  timeRemaining: 'customfield_21785',
}

useEmptyState()

function serveMyself(respond?: () => Response) {
  return serveRecorded(respond ?? (() => Response.json(loadFixture('myself'))))
}

/** A logged-in state: settings, resolved fields, and the token in the fake Keychain. */
async function loggedIn(options: { projectKey?: string; resolvedAt?: string | null } = {}) {
  const security = fakeSecurity()
  await security.keychain.set(EMAIL, TOKEN)
  await writeSettings({
    siteUrl: JIRA_SITE,
    projectKey: options.projectKey ?? 'PSAPAC',
    email: EMAIL,
  })
  if (options.resolvedAt !== null) {
    await writeFields({
      site: JIRA_SITE,
      project: 'PSAPAC',
      resolvedAt: options.resolvedAt ?? RESOLVED_AT,
      ids: IDS,
    })
  }
  return security
}

describe('jm auth status', () => {
  it('reports the account the token authenticates as', async () => {
    const requests = serveMyself()
    const { keychain } = await loggedIn()
    const f = fakeIo()
    expect(await run(['auth', 'status'], f.io, { keychain })).toBe(0)
    const json = JSON.parse(f.stdout) as { data: unknown }
    expect(json).toEqual({
      data: {
        siteUrl: JIRA_SITE,
        projectKey: 'PSAPAC',
        email: EMAIL,
        accountId: ACCOUNT_ID,
        displayName: 'Shane Dolley',
        fieldsResolvedAt: RESOLVED_AT,
      },
    })
    expectShape(json.data, spec?.output.example)
    expect(f.stderr).toBe('')
    expectNoToken(f)
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /rest/api/3/myself'])
    expect(requests[0]?.headers.get('authorization')).toBe(
      `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`,
    )
  })

  it('prints the account on a terminal, with the resolve time in local time', async () => {
    serveMyself()
    const { keychain } = await loggedIn({ resolvedAt: new Date(2026, 9, 7, 13, 5).toISOString() })
    const f = fakeIo({ stdoutIsTTY: true, env: NO_COLOR })
    expect(await run(['auth', 'status'], f.io, { keychain })).toBe(0)
    expect(f.stdout).toBe(
      [
        `Site:            ${JIRA_SITE}`,
        'Project:         PSAPAC',
        `Email:           ${EMAIL}`,
        'Name:            Shane Dolley',
        `Account id:      ${ACCOUNT_ID}`,
        'Token:           stored in the Keychain',
        'Fields resolved: 2026-10-07 13:05',
        '',
      ].join('\n'),
    )
    expect(f.stderr).toBe('')
    expectNoToken(f)
  })

  it('strips control characters from the name Jira sends', async () => {
    serveMyself(() =>
      Response.json({ accountId: 'abc', displayName: 'Eve\u001b]0;pwned\u0007 Evans' }),
    )
    const { keychain } = await loggedIn()
    const f = fakeIo({ stdoutIsTTY: true, env: NO_COLOR })
    expect(await run(['auth', 'status'], f.io, { keychain })).toBe(0)
    expect(f.stdout).not.toMatch(/\p{Cc}(?<!\n)/u)
    expect(f.stdout).toContain('Name:            Eve]0;pwned Evans')
  })

  it('reports fields never resolved and no project as null, and as words on a terminal', async () => {
    serveMyself()
    const { keychain } = await loggedIn({ resolvedAt: null })
    await writeSettings({ siteUrl: JIRA_SITE, email: EMAIL })
    const json = fakeIo()
    expect(await run(['auth', 'status'], json.io, { keychain })).toBe(0)
    expect(JSON.parse(json.stdout)).toMatchObject({
      data: { projectKey: null, fieldsResolvedAt: null },
    })
    const tty = fakeIo({ stdoutIsTTY: true, env: NO_COLOR })
    expect(await run(['auth', 'status'], tty.io, { keychain })).toBe(0)
    expect(tty.stdout).toContain('Project:         not set')
    expect(tty.stdout).toContain('Fields resolved: never')
  })

  it('reports the normalised site when the settings hold it in upper case with a slash', async () => {
    serveMyself()
    const { keychain } = await loggedIn()
    await writeSettings({
      siteUrl: `${JIRA_SITE.toUpperCase()}/`,
      projectKey: 'PSAPAC',
      email: EMAIL,
    })
    const f = fakeIo()
    expect(await run(['auth', 'status'], f.io, { keychain })).toBe(0)
    expect(JSON.parse(f.stdout)).toMatchObject({ data: { siteUrl: JIRA_SITE } })
  })

  describe('with an injected client', () => {
    const http = createHttpClient({
      credentials: () => Promise.resolve({ siteUrl: JIRA_SITE, email: EMAIL, token: TOKEN }),
      sleep: () => Promise.resolve(),
    })

    it('settings with no site or email are logged out, and nothing is sent', async () => {
      const requests = serveMyself()
      for (const settings of [{}, { siteUrl: JIRA_SITE }, { email: EMAIL }]) {
        await writeSettings(settings)
        const f = fakeIo()
        expect(await run(['auth', 'status'], f.io, { http })).toBe(4)
        expect(JSON.parse(f.stdout)).toEqual({
          error: { code: 'permission_denied', message: 'Not logged in. Run `jm auth login`.' },
        })
      }
      expect(requests).toEqual([])
    })

    it('a site that is not a Jira site exits 2 instead of printing it', async () => {
      serveMyself()
      await writeSettings({ siteUrl: 'https://evil.example.com', email: EMAIL })
      const f = fakeIo()
      expect(await run(['auth', 'status'], f.io, { http })).toBe(2)
      expect(f.stdout).not.toContain('evil.example.com')
    })
  })

  describe('when logged out', () => {
    it('status exits 4 when logged out', async () => {
      const requests = serveMyself()
      const f = fakeIo()
      expect(await run(['auth', 'status'], f.io, { keychain: fakeSecurity().keychain })).toBe(4)
      expect(JSON.parse(f.stdout)).toEqual({
        error: { code: 'permission_denied', message: 'Not logged in. Run `jm auth login`.' },
      })
      expect(requests).toEqual([])
    })

    it('prints jm: Not logged in on a terminal, to stderr only', async () => {
      serveMyself()
      const f = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true, env: NO_COLOR })
      expect(await run(['auth', 'status'], f.io, { keychain: fakeSecurity().keychain })).toBe(4)
      expect(f.stdout).toBe('')
      expect(f.stderr).toBe('jm: Not logged in. Run `jm auth login`.\n')
    })

    it('exits 4 when the settings name an account but the Keychain holds no token', async () => {
      const requests = serveMyself()
      await loggedIn()
      const f = fakeIo()
      expect(await run(['auth', 'status'], f.io, { keychain: fakeSecurity().keychain })).toBe(4)
      expect(requests).toEqual([])
    })
  })

  describe('failures', () => {
    it('a token Jira now rejects exits 4', async () => {
      serveMyself(() => Response.json({ message: 'no' }, { status: 401 }))
      const { keychain } = await loggedIn()
      const f = fakeIo()
      expect(await run(['auth', 'status'], f.io, { keychain })).toBe(4)
      expect(JSON.parse(f.stdout)).toMatchObject({ error: { code: 'permission_denied' } })
      expectNoToken(f)
    })

    it('a Jira 500 exits 5', async () => {
      serveMyself(() => Response.json({}, { status: 500 }))
      const { keychain } = await loggedIn()
      const f = fakeIo()
      expect(await run(['auth', 'status'], f.io, { keychain })).toBe(5)
      expectNoToken(f)
    })

    it('a Keychain failure exits 1 without the token', async () => {
      const requests = serveMyself()
      await loggedIn()
      const f = fakeIo()
      expect(
        await run(['auth', 'status'], f.io, { keychain: fakeSecurity({ fail: true }).keychain }),
      ).toBe(1)
      expect(JSON.parse(f.stdout)).toMatchObject({
        error: { code: 'internal', message: 'Keychain read failed (security exited 1).' },
      })
      expect(requests).toEqual([])
      expectNoToken(f)
    })

    it('a site edited out of the settings exits 2 before the token is sent', async () => {
      const requests = serveMyself()
      const { keychain } = await loggedIn()
      await writeSettings({
        siteUrl: 'https://evil.example.com',
        projectKey: 'PSAPAC',
        email: EMAIL,
      })
      const f = fakeIo()
      expect(await run(['auth', 'status'], f.io, { keychain })).toBe(2)
      expect(requests).toEqual([])
      expectNoToken(f)
    })
  })
})
