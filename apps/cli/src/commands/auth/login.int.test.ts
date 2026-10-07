import { JIRA_SITE, loadFixture, serveCreatemeta, serveRecorded } from '@jira-mgr/core/test/msw'
import { readFields, readSettings, writeSettings } from '@jira-mgr/core/state'
import { describe, expect, it } from 'vitest'

import { run } from '../../run.js'
import { COMMANDS, type CommandSpec } from '../../schema.js'
import { EMAIL, expectNoToken, fakeSecurity, TOKEN, useEmptyState } from '../../test-auth.js'
import { fakeIo } from '../../test-io.js'
import { expectShape } from '../../test-shape.js'

const spec: CommandSpec | undefined = COMMANDS.find((c) => c.path.join(' ') === 'auth login')

const ACCOUNT_ID = '712020:16f8dbe7-f120-4043-bcaf-e06ef7156d34'
const FLAGS = ['auth', 'login', '--site', JIRA_SITE, '--project', 'PSAPAC', '--email', EMAIL]
const NO_COLOR = { NO_COLOR: '1' }

useEmptyState()

/** Answers /myself and the createmeta calls login makes. Returns the /myself requests. */
function serveJira(status = 200) {
  const requests = serveRecorded(() =>
    status === 200
      ? Response.json(loadFixture('myself'))
      : Response.json({ message: 'no' }, { status }),
  )
  // Registered last, so the createmeta paths win over the catch-all above.
  serveCreatemeta()
  return requests
}

const basic = (token: string) => `Basic ${Buffer.from(`${EMAIL}:${token}`).toString('base64')}`

describe('jm auth login', () => {
  it('reads the token from stdin, stores it and reports the account', async () => {
    const requests = serveJira()
    const { items, calls, keychain } = fakeSecurity()
    const f = fakeIo({ stdin: `${TOKEN}\n` })
    expect(await run([...FLAGS, '--token-stdin'], f.io, { keychain })).toBe(0)

    const json = JSON.parse(f.stdout) as { data: unknown }
    expect(json).toEqual({
      data: {
        siteUrl: JIRA_SITE,
        projectKey: 'PSAPAC',
        email: EMAIL,
        accountId: ACCOUNT_ID,
        displayName: 'Shane Dolley',
      },
    })
    expectShape(json.data, spec?.output.example)
    expect(f.stderr).toBe('')
    expectNoToken(f)

    expect(items).toEqual(new Map([[EMAIL, TOKEN]]))
    const settings = await readSettings()
    expect([settings.siteUrl, settings.projectKey, settings.email]).toEqual([
      JIRA_SITE,
      'PSAPAC',
      EMAIL,
    ])
    expect((await readFields())?.ids.customer).toMatch(/^customfield_/)
    // The login check is the only /myself call: its answer names the account.
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /rest/api/3/myself'])
    expect(requests[0]?.headers.get('authorization')).toBe(basic(TOKEN))
    // The token goes to the Keychain over stdin, never in an argument.
    for (const call of calls) expect(call.args.join(' ')).not.toContain(TOKEN)
  })

  it('prints the stored values on a terminal', async () => {
    serveJira()
    const { keychain } = fakeSecurity()
    const f = fakeIo({ stdin: TOKEN, stdoutIsTTY: true, env: NO_COLOR })
    expect(await run([...FLAGS, '--token-stdin'], f.io, { keychain })).toBe(0)
    expect(f.stdout).toBe(
      [
        'Logged in as Shane Dolley.',
        `Site:       ${JIRA_SITE}`,
        'Project:    PSAPAC',
        `Email:      ${EMAIL}`,
        `Account id: ${ACCOUNT_ID}`,
        'The token is stored in the Keychain.',
        '',
      ].join('\n'),
    )
    expect(f.stderr).toBe('')
    expectNoToken(f)
  })

  it('indents the JSON on a terminal under --json', async () => {
    serveJira()
    const { keychain } = fakeSecurity()
    const f = fakeIo({ stdin: TOKEN, stdoutIsTTY: true })
    expect(await run([...FLAGS, '--token-stdin', '--json'], f.io, { keychain })).toBe(0)
    expect(f.stdout).toContain('\n  "data": {\n    "siteUrl"')
    expectNoToken(f)
  })

  it('login reads the token from stdin with --token-stdin and drops CRLF and spaces around it', async () => {
    serveJira()
    for (const stdin of [`${TOKEN}\r\n`, `  ${TOKEN}\n\n`, TOKEN]) {
      const { items, keychain } = fakeSecurity()
      const f = fakeIo({ stdin })
      expect(await run([...FLAGS, '--token-stdin'], f.io, { keychain })).toBe(0)
      expect(items.get(EMAIL)).toBe(TOKEN)
    }
  })

  it('an empty stdin exits 2 and sends and stores nothing', async () => {
    const requests = serveJira()
    for (const stdin of ['', '\n', '  \r\n']) {
      const { calls, keychain } = fakeSecurity()
      const f = fakeIo({ stdin })
      expect(
        await run([...FLAGS, '--token-stdin'], f.io, { keychain }),
        JSON.stringify(stdin),
      ).toBe(2)
      expect(JSON.parse(f.stdout)).toMatchObject({
        error: { code: 'validation_failed', message: 'The API token is empty.' },
      })
      expect(calls).toEqual([])
    }
    expect(requests).toEqual([])
  })

  it('without a terminal or --token-stdin exits 2 naming the token', async () => {
    const requests = serveJira()
    const { calls, keychain } = fakeSecurity()
    const f = fakeIo()
    expect(await run(FLAGS, f.io, { keychain })).toBe(2)
    const { error } = JSON.parse(f.stdout) as { error: { code: string; message: string } }
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('No API token')
    expect(error.message).toContain('--token-stdin')
    expect(f.asked).toEqual([])
    expect(requests).toEqual([])
    expect(calls).toEqual([])
  })

  it('a terminal failure prints jm: and the message to stderr only', async () => {
    serveJira()
    const f = fakeIo({ stdoutIsTTY: true, stderrIsTTY: true, env: NO_COLOR })
    expect(await run(FLAGS, f.io, { keychain: fakeSecurity().keychain })).toBe(2)
    expect(f.stdout).toBe('')
    expect(f.stderr).toMatch(/^jm: No API token\./)
  })

  it('never takes the token as a flag', async () => {
    const requests = serveJira()
    const f = fakeIo({ stdin: TOKEN })
    expect(
      await run([...FLAGS, '--token', TOKEN], f.io, { keychain: fakeSecurity().keychain }),
    ).toBe(2)
    expect(spec?.options?.map((o) => o.name)).not.toContain('token')
    expectNoToken(f)
    expect(requests).toEqual([])
  })

  it('missing values with no terminal exit 2 naming each flag', async () => {
    const requests = serveJira()
    const f = fakeIo({ stdin: TOKEN })
    const keychain = fakeSecurity().keychain
    expect(await run(['auth', 'login', '--token-stdin'], f.io, { keychain })).toBe(2)
    expect(JSON.parse(f.stdout)).toMatchObject({
      error: {
        code: 'validation_failed',
        message: expect.stringContaining('Missing --site, --project, --email.') as string,
      },
    })
    expect(requests).toEqual([])
  })

  it('takes what the flags leave out from the settings', async () => {
    serveJira()
    await writeSettings({ siteUrl: JIRA_SITE, projectKey: 'PSAPAC', email: EMAIL })
    const { items, keychain } = fakeSecurity()
    const f = fakeIo({ stdin: TOKEN })
    expect(await run(['auth', 'login', '--token-stdin'], f.io, { keychain })).toBe(0)
    expect(items.get(EMAIL)).toBe(TOKEN)
  })

  it('a flag beats the settings', async () => {
    serveJira()
    await writeSettings({ siteUrl: JIRA_SITE, projectKey: 'OTHER', email: 'old@example.com' })
    const f = fakeIo({ stdin: TOKEN })
    expect(
      await run([...FLAGS, '--token-stdin'], f.io, { keychain: fakeSecurity().keychain }),
    ).toBe(0)
    expect((await readSettings()).projectKey).toBe('PSAPAC')
  })

  describe('on a terminal', () => {
    const tty = { stdinIsTTY: true, stderrIsTTY: true, stdoutIsTTY: true, env: NO_COLOR }

    it('prompts for every missing value and hides only the token', async () => {
      serveJira()
      const { items, keychain } = fakeSecurity()
      const f = fakeIo({ ...tty, answers: [JIRA_SITE, 'PSAPAC', `  ${EMAIL} `, TOKEN] })
      expect(await run(['auth', 'login'], f.io, { keychain })).toBe(0)
      expect(f.asked).toEqual([
        { question: 'Jira site URL (https://<name>.atlassian.net): ', hidden: false },
        { question: 'Jira project key: ', hidden: false },
        { question: 'Account email: ', hidden: false },
        { question: 'Jira API token (hidden): ', hidden: true },
      ])
      expect(items).toEqual(new Map([[EMAIL, TOKEN]]))
      expect(f.stdout).toContain('Logged in as Shane Dolley.')
      expectNoToken(f)
    })

    it('prompts only for what the flags and settings leave out', async () => {
      serveJira()
      await writeSettings({ siteUrl: JIRA_SITE, projectKey: 'PSAPAC' })
      const { items, keychain } = fakeSecurity()
      const f = fakeIo({ ...tty, answers: [EMAIL, TOKEN] })
      expect(await run(['auth', 'login'], f.io, { keychain })).toBe(0)
      expect(f.asked.map((a) => a.question)).toEqual([
        'Account email: ',
        'Jira API token (hidden): ',
      ])
      expect(items.get(EMAIL)).toBe(TOKEN)
    })

    it('an empty answer for a value exits 2 naming its flag', async () => {
      const requests = serveJira()
      const f = fakeIo({ ...tty, answers: [JIRA_SITE, '', EMAIL, TOKEN] })
      expect(await run(['auth', 'login'], f.io, { keychain: fakeSecurity().keychain })).toBe(2)
      expect(f.stderr).toMatch(/^jm: Missing --project\./)
      expect(f.asked).toHaveLength(3)
      expect(requests).toEqual([])
    })

    it('an empty token exits 2', async () => {
      const requests = serveJira()
      const { calls, keychain } = fakeSecurity()
      const f = fakeIo({ ...tty, answers: [JIRA_SITE, 'PSAPAC', EMAIL, '  '] })
      expect(await run(['auth', 'login'], f.io, { keychain })).toBe(2)
      expect(f.stderr).toBe('jm: The API token is empty.\n')
      expect(requests).toEqual([])
      expect(calls).toEqual([])
    })

    it('--token-stdin with stdin on a terminal prompts for the token, hidden, and never reads stdin', async () => {
      serveJira()
      for (const partial of [{}, { stderrIsTTY: false }]) {
        const { items, keychain } = fakeSecurity()
        const f = fakeIo({ ...tty, ...partial, stdin: 'WRONG', answers: [`${TOKEN}\n`] })
        expect(await run([...FLAGS, '--token-stdin'], f.io, { keychain })).toBe(0)
        expect(f.asked).toEqual([{ question: 'Jira API token (hidden): ', hidden: true }])
        expect(items).toEqual(new Map([[EMAIL, TOKEN]]))
      }
    })

    it('--token-stdin still prompts for the other missing values on a terminal', async () => {
      serveJira()
      const f = fakeIo({ ...tty, answers: [JIRA_SITE, 'PSAPAC', EMAIL, TOKEN] })
      const keychain = fakeSecurity().keychain
      expect(await run(['auth', 'login', '--token-stdin'], f.io, { keychain })).toBe(0)
      expect(f.asked.map((a) => a.hidden)).toEqual([false, false, false, true])
    })

    it.each([1, 2, 3, 4])(
      'Ctrl-C at prompt %i stops: no later prompt, request or Keychain call',
      async (n) => {
        const requests = serveJira()
        const { calls, keychain } = fakeSecurity()
        const controller = new AbortController()
        const f = fakeIo({
          ...tty,
          signal: controller.signal,
          answers: [JIRA_SITE, 'PSAPAC', EMAIL, TOKEN],
          onPrompt: (count) => {
            if (count === n) controller.abort()
          },
        })
        expect(await run(['auth', 'login'], f.io, { keychain })).toBe(130)
        // The command may still be running when run returns, so give a later prompt time to show.
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(f.asked).toHaveLength(n)
        expect(requests).toEqual([])
        expect(calls).toEqual([])
        expect(f.stdout).toBe('')
      },
    )

    it('prompts for the token only when stdin and stderr are terminals', async () => {
      serveJira()
      for (const partial of [{ stdinIsTTY: false }, { stderrIsTTY: false }]) {
        const f = fakeIo({ ...tty, ...partial, answers: [TOKEN] })
        expect(await run(FLAGS, f.io, { keychain: fakeSecurity().keychain })).toBe(2)
        expect(f.asked).toEqual([])
      }
    })
  })

  it('reports the normalised site when given upper case and a trailing slash', async () => {
    serveJira()
    const f = fakeIo({ stdin: TOKEN })
    const argv = ['auth', 'login', '--site', `${JIRA_SITE.toUpperCase()}/`, '--project', 'PSAPAC']
    const flags = [...argv, '--email', EMAIL, '--token-stdin']
    expect(await run(flags, f.io, { keychain: fakeSecurity().keychain })).toBe(0)
    expect(JSON.parse(f.stdout)).toMatchObject({ data: { siteUrl: JIRA_SITE } })
    expect((await readSettings()).siteUrl).toBe(JIRA_SITE)
  })

  it.each(['--token=SECRET', '--token-stdin=SECRET'])('%s never echoes its value', async (arg) => {
    const requests = serveJira()
    for (const tty of [false, true]) {
      const f = fakeIo({ stdin: TOKEN, stdoutIsTTY: tty, stderrIsTTY: tty })
      expect(await run([...FLAGS, arg], f.io, { keychain: fakeSecurity().keychain })).toBe(2)
      expect(f.stdout + f.stderr).toContain(`${arg.split('=')[0] ?? ''}=<redacted>`)
      expect(f.stdout + f.stderr).not.toContain('SECRET')
    }
    expect(requests).toEqual([])
  })

  it('a stray operand, such as a token typed after login, is never echoed', async () => {
    const requests = serveJira()
    for (const tty of [false, true]) {
      const f = fakeIo({ stdin: TOKEN, stdoutIsTTY: tty, stderrIsTTY: tty })
      expect(await run(['auth', 'login', TOKEN], f.io, { keychain: fakeSecurity().keychain })).toBe(
        2,
      )
      expect(f.stdout + f.stderr).toContain('too many arguments')
      expectNoToken(f)
    }
    expect(requests).toEqual([])
  })

  it('a login with no injected Keychain cannot reach the real one', async () => {
    serveJira()
    const f = fakeIo({ stdin: TOKEN })
    expect(await run([...FLAGS, '--token-stdin'], f.io, {})).toBe(1)
    expect(JSON.parse(f.stdout)).toMatchObject({
      error: { code: 'internal', message: 'Cannot run /usr/bin/security.' },
    })
    expectNoToken(f)
  })

  describe('failures', () => {
    it('a bad site exits 2 before any request or Keychain call', async () => {
      const requests = serveJira()
      for (const site of ['https://example.com', 'http://a.atlassian.net', 'not a url']) {
        const { calls, keychain } = fakeSecurity()
        const f = fakeIo({ stdin: TOKEN })
        const argv = ['auth', 'login', '--site', site, '--project', 'PSAPAC', '--email', EMAIL]
        expect(await run([...argv, '--token-stdin'], f.io, { keychain }), site).toBe(2)
        expect(JSON.parse(f.stdout)).toMatchObject({ error: { code: 'validation_failed' } })
        expect(calls).toEqual([])
        expectNoToken(f)
      }
      expect(requests).toEqual([])
      expect((await readSettings()).email).toBeUndefined()
    })

    it('a bad email exits 2', async () => {
      const requests = serveJira()
      const f = fakeIo({ stdin: TOKEN })
      const argv = ['auth', 'login', '--site', JIRA_SITE, '--project', 'PSAPAC', '--email', 'nope']
      const keychain = fakeSecurity().keychain
      expect(await run([...argv, '--token-stdin'], f.io, { keychain })).toBe(2)
      expect(requests).toEqual([])
    })

    it('a 401 exits 4 and stores nothing', async () => {
      serveJira(401)
      const { calls, items, keychain } = fakeSecurity()
      const f = fakeIo({ stdin: TOKEN })
      expect(await run([...FLAGS, '--token-stdin'], f.io, { keychain })).toBe(4)
      const { error } = JSON.parse(f.stdout) as { error: { code: string; message: string } }
      expect(error.code).toBe('permission_denied')
      expect(error.message).toContain('rejected the email or API token')
      expectNoToken(f)
      expect(calls).toEqual([])
      expect(items.size).toBe(0)
      expect((await readSettings()).email).toBeUndefined()
      expect(await readFields()).toBeNull()
    })

    it('a Jira 500 on the check exits 5', async () => {
      serveJira(500)
      const f = fakeIo({ stdin: TOKEN })
      expect(
        await run([...FLAGS, '--token-stdin'], f.io, { keychain: fakeSecurity().keychain }),
      ).toBe(5)
      expect(JSON.parse(f.stdout)).toMatchObject({ error: { code: 'jira_error' } })
      expectNoToken(f)
    })

    it('a Keychain failure exits 1, leaves no login and never prints the token', async () => {
      serveJira()
      const { keychain } = fakeSecurity({ fail: true })
      const f = fakeIo({ stdin: TOKEN })
      expect(await run([...FLAGS, '--token-stdin'], f.io, { keychain })).toBe(1)
      const { error } = JSON.parse(f.stdout) as { error: { code: string; message: string } }
      expect(error.code).toBe('internal')
      expect(error.message).toContain('Keychain write failed')
      expectNoToken(f)
      expect((await readSettings()).email).toBeUndefined()
    })

    it('a Keychain failure prints a terminal message without the token', async () => {
      serveJira()
      const f = fakeIo({ stdin: TOKEN, stdoutIsTTY: true, stderrIsTTY: true, env: NO_COLOR })
      const keychain = fakeSecurity({ fail: true }).keychain
      expect(await run([...FLAGS, '--token-stdin'], f.io, { keychain })).toBe(1)
      expect(f.stdout).toBe('')
      expect(f.stderr).toMatch(/^jm: Keychain write failed/)
      expectNoToken(f)
    })

    it('a token the Keychain cannot hold exits 2 without echoing it', async () => {
      serveJira()
      const bad = 'has"quote'
      const f = fakeIo({ stdin: bad })
      expect(
        await run([...FLAGS, '--token-stdin'], f.io, { keychain: fakeSecurity().keychain }),
      ).toBe(2)
      expect(f.stdout).not.toContain(bad)
      expect(f.stderr).not.toContain(bad)
    })
  })
})

describe('jm auth login stdin limit', () => {
  it('refuses a token on stdin past 4096 bytes, storing nothing and sending nothing', async () => {
    const requests = serveJira()
    const { items, calls, keychain } = fakeSecurity()
    const f = fakeIo({ stdin: 'x'.repeat(100_000) })
    expect(await run([...FLAGS, '--token-stdin'], f.io, { keychain })).toBe(2)
    expect(JSON.parse(f.stdout)).toMatchObject({
      error: { code: 'validation_failed', message: 'The API token on stdin is too long.' },
    })
    expect(requests).toEqual([])
    expect(calls).toEqual([])
    expect(items.size).toBe(0)
  })

  it('accepts a token of exactly 4096 bytes up to the core limit check', async () => {
    serveJira()
    const { keychain } = fakeSecurity()
    const f = fakeIo({ stdin: 'x'.repeat(4096) })
    // Core refuses a token over 1024 bytes, so this fails there, not on the stdin limit.
    expect(await run([...FLAGS, '--token-stdin'], f.io, { keychain })).toBe(2)
    expect(f.stdout).not.toContain('too long')
  })
})
