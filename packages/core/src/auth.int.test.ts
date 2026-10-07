import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { server, JIRA_SITE, serveCreatemeta } from '../test/msw.js'
import {
  createKeychain,
  getCredentials,
  login,
  logout,
  parseSiteUrl,
  type SecurityRunner,
} from './auth.js'
import { JiraMgrError } from './errors.js'
import { readFields, readSettings, writeSettings } from './state.js'

const EMAIL = 'shane@koinon.com.au'
const OTHER_EMAIL = 'someone@example.com'
const TOKEN = 'ATATT3xFfGF0-secret_token=ABC123'

interface Call {
  args: string[]
  stdin?: string
}

/** A fake `security` holding items in memory, recording every call. */
function fakeSecurity() {
  const calls: Call[] = []
  const items = new Map<string, string>()
  const run: SecurityRunner = (args, stdin) => {
    calls.push({ args, stdin })
    const account = args.includes('-a') ? args[args.indexOf('-a') + 1] : undefined
    if (args[0] === '-i') {
      const stored = /-a "([^"]*)" -w "([^"]*)"/.exec(stdin ?? '')
      if (stored?.[1] !== undefined && stored[2] !== undefined) items.set(stored[1], stored[2])
      return Promise.resolve({ status: 0, stdout: '' })
    }
    if (args[0] === 'find-generic-password') {
      const token = account === undefined ? undefined : items.get(account)
      return Promise.resolve(
        token === undefined ? { status: 44, stdout: '' } : { status: 0, stdout: `${token}\n` },
      )
    }
    const target = account ?? items.keys().next().value
    const found = target !== undefined && items.delete(target)
    return Promise.resolve({ status: found ? 0 : 44, stdout: '' })
  }
  return { calls, items, run, keychain: createKeychain({ run }) }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jm-auth-'))
  process.env.JM_STATE_DIR = dir
  // login resolves the custom fields after /myself; a test that needs other metadata serves it again.
  serveCreatemeta()
})

afterEach(async () => {
  delete process.env.JM_STATE_DIR
  await rm(dir, { recursive: true, force: true })
})

function serveMyself(status: number) {
  const seen: Request[] = []
  server.use(
    http.get(`${JIRA_SITE}/rest/api/3/myself`, ({ request }) => {
      seen.push(request)
      return status === 200
        ? HttpResponse.json({
            accountId: 'abc',
            displayName: 'Shane',
            emailAddress: EMAIL,
            active: true,
          })
        : HttpResponse.json({ message: 'no' }, { status })
    }),
  )
  return seen
}

const input = { siteUrl: JIRA_SITE, projectKey: 'PSAPAC', email: EMAIL, token: TOKEN }

async function failure(promise: Promise<unknown>): Promise<JiraMgrError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(JiraMgrError)
  return error as JiraMgrError
}

describe('keychain', () => {
  it('reads the item with find-generic-password and trims the newline', async () => {
    const { calls, keychain } = fakeSecurity()
    await keychain.set(EMAIL, TOKEN)
    calls.length = 0
    expect(await keychain.get(EMAIL)).toBe(TOKEN)
    expect(calls).toEqual([
      { args: ['find-generic-password', '-s', 'jira-mgr', '-a', EMAIL, '-w'], stdin: undefined },
    ])
  })

  it('writes over stdin and keeps the token out of every argv', async () => {
    const { calls, keychain } = fakeSecurity()
    await keychain.set(EMAIL, TOKEN)
    expect(calls[0]).toEqual({
      args: ['-i'],
      stdin: `add-generic-password -U -s "jira-mgr" -a "${EMAIL}" -w "${TOKEN}"\n`,
    })
    for (const call of calls) expect(call.args.join(' ')).not.toContain(TOKEN)
  })

  it('deletes by service and account', async () => {
    const { calls, keychain } = fakeSecurity()
    await keychain.set(EMAIL, TOKEN)
    calls.length = 0
    await keychain.delete(EMAIL)
    expect(calls).toEqual([
      { args: ['delete-generic-password', '-s', 'jira-mgr', '-a', EMAIL], stdin: undefined },
    ])
  })

  it('treats a missing item as null on read and as success on delete', async () => {
    const { keychain } = fakeSecurity()
    expect(await keychain.get(EMAIL)).toBeNull()
    await expect(keychain.delete(EMAIL)).resolves.toBeUndefined()
  })

  it('deleteAll repeats the delete without an account until none is left', async () => {
    const { calls, items, keychain } = fakeSecurity()
    await keychain.set(EMAIL, TOKEN)
    await keychain.set(OTHER_EMAIL, 'other')
    calls.length = 0
    await keychain.deleteAll()
    const argv = ['delete-generic-password', '-s', 'jira-mgr']
    expect(calls).toEqual([
      { args: argv, stdin: undefined },
      { args: argv, stdin: undefined },
      { args: argv, stdin: undefined },
    ])
    expect(items.size).toBe(0)
  })

  it('deleteAll stops at its cap when items keep appearing', async () => {
    let count = 0
    const run: SecurityRunner = () => {
      count++
      return Promise.resolve({ status: 0, stdout: '' })
    }
    expect((await failure(createKeychain({ run }).deleteAll())).code).toBe('internal')
    expect(count).toBe(20)
  })

  it.each(['has"quote', "has'quote", 'back\\slash', 'new\nline', 'tab\there', ''])(
    'rejects the unquotable token %j before running security',
    async (token) => {
      const { calls, keychain } = fakeSecurity()
      expect((await failure(keychain.set(EMAIL, token))).code).toBe('validation_failed')
      expect(calls).toEqual([])
    },
  )

  it('rejects a token over 1024 bytes before running security', async () => {
    const { calls, keychain } = fakeSecurity()
    expect((await failure(keychain.set(EMAIL, 'a'.repeat(5000)))).code).toBe('validation_failed')
    expect((await failure(keychain.set(EMAIL, 'a'.repeat(1025)))).code).toBe('validation_failed')
    expect(calls).toEqual([])
  })

  it('rejects an email over 254 bytes before running security', async () => {
    const { calls, keychain } = fakeSecurity()
    const email = `${'a'.repeat(300)}@example.com`
    expect((await failure(keychain.set(email, TOKEN))).code).toBe('validation_failed')
    expect(calls).toEqual([])
  })

  it('counts bytes, not characters', async () => {
    const { calls, keychain } = fakeSecurity()
    expect((await failure(keychain.set(EMAIL, 'é'.repeat(600)))).code).toBe('validation_failed')
    expect(calls).toEqual([])
  })

  it('refuses a command that reaches the 4095-byte stdin chunk', async () => {
    const { calls, run } = fakeSecurity()
    const keychain = createKeychain({ run, service: 's'.repeat(3500) })
    expect((await failure(keychain.set(EMAIL, 'a'.repeat(1000)))).code).toBe('validation_failed')
    expect(calls).toEqual([])
  })

  it('fails when security exits 0 but stored nothing, and removes any leftover item', async () => {
    const calls: Call[] = []
    const run: SecurityRunner = (args) => {
      calls.push({ args })
      return Promise.resolve({ status: args[0] === 'find-generic-password' ? 44 : 0, stdout: '' })
    }
    const error = await failure(createKeychain({ run }).set(EMAIL, TOKEN))
    expect(error.code).toBe('internal')
    expect(error.message).not.toContain(TOKEN)
    expect(calls.at(-1)?.args).toEqual(['delete-generic-password', '-s', 'jira-mgr', '-a', EMAIL])
  })

  it('wraps a failure to start security', async () => {
    const run: SecurityRunner = () => Promise.reject(new Error('spawn ENOENT'))
    expect((await failure(createKeychain({ run }).get(EMAIL))).code).toBe('internal')
  })
})

describe('parseSiteUrl', () => {
  it('returns the origin of a bare Atlassian cloud site', () => {
    expect(parseSiteUrl('https://Example.atlassian.net/')).toBe('https://example.atlassian.net')
  })

  it.each(['http://example.atlassian.net', 'https://example.com', 'https://a.b.atlassian.net', ''])(
    'returns null for %j',
    (value) => {
      expect(parseSiteUrl(value)).toBeNull()
    },
  )
})

describe('login', () => {
  it('verifies with Basic auth, stores the token and writes settings', async () => {
    const seen = serveMyself(200)
    const { keychain, calls } = fakeSecurity()
    await login(input, { keychain })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.headers.get('authorization')).toBe(
      `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`,
    )
    expect(calls[0]?.stdin).toContain(`-w "${TOKEN}"`)
    const settings = await readSettings()
    expect(settings).toMatchObject({ siteUrl: JIRA_SITE, projectKey: 'PSAPAC', email: EMAIL })
    expect(JSON.stringify(settings)).not.toContain(TOKEN)
  })

  it('returns the account from the check, with no second request', async () => {
    const seen = serveMyself(200)
    expect(await login(input, { keychain: fakeSecurity().keychain })).toEqual({
      accountId: 'abc',
      displayName: 'Shane',
    })
    expect(seen).toHaveLength(1)
  })

  it.each([
    ['no display name', { accountId: 'abc' }],
    ['a body that is not an object', 'oops'],
  ])('maps %s in the check to jira_error and stores nothing', async (_name, body) => {
    server.use(http.get(`${JIRA_SITE}/rest/api/3/myself`, () => HttpResponse.json(body)))
    const { keychain, calls } = fakeSecurity()
    expect((await failure(login(input, { keychain }))).code).toBe('jira_error')
    expect(calls).toEqual([])
    expect((await readSettings()).email).toBeUndefined()
  })

  it('maps a body that is not JSON to jira_error', async () => {
    server.use(http.get(`${JIRA_SITE}/rest/api/3/myself`, () => new HttpResponse('<html>')))
    expect((await failure(login(input, { keychain: fakeSecurity().keychain }))).code).toBe(
      'jira_error',
    )
  })

  it.each([401, 403])('maps %i to permission_denied and stores nothing', async (status) => {
    serveMyself(status)
    const { keychain, calls } = fakeSecurity()
    const error = await failure(login(input, { keychain }))
    expect(error.code).toBe('permission_denied')
    expect(error.message).not.toContain(TOKEN)
    expect(calls).toEqual([])
    expect((await readSettings()).email).toBeUndefined()
  })

  it('maps another failure to jira_error and stores nothing', async () => {
    serveMyself(500)
    const { keychain, calls } = fakeSecurity()
    expect((await failure(login(input, { keychain }))).code).toBe('jira_error')
    expect(calls).toEqual([])
  })

  it('resolves the custom fields and writes fields.json', async () => {
    serveMyself(200)
    await login(input, {
      keychain: fakeSecurity().keychain,
      now: () => new Date('2026-10-07T01:02:03.000Z'),
    })
    expect(await readFields()).toEqual({
      site: JIRA_SITE,
      project: 'PSAPAC',
      resolvedAt: '2026-10-07T01:02:03.000Z',
      ids: {
        customer: 'customfield_14849',
        engagement: 'customfield_14850',
        sprint: 'customfield_10600',
        startDate: 'customfield_13808',
        timeRemaining: 'customfield_21785',
      },
    })
  })

  it('fails on a missing field and stores nothing', async () => {
    serveMyself(200)
    serveCreatemeta({ edit: (_type, fields) => fields.filter((f) => f.name !== 'Sprint') })
    const { keychain, calls } = fakeSecurity()
    const error = await failure(login(input, { keychain }))
    expect(error.code).toBe('validation_failed')
    expect(error.message).toContain('Sprint (missing)')
    expect(calls).toEqual([])
    expect((await readSettings()).email).toBeUndefined()
    expect(await readFields()).toBeNull()
  })

  it('fails on an ambiguous field and stores nothing', async () => {
    serveMyself(200)
    serveCreatemeta({
      edit: (type, fields) =>
        type === 'epic' ? [...fields, { key: 'customfield_99999', name: 'Customer' }] : fields,
    })
    const { keychain, calls } = fakeSecurity()
    const error = await failure(login(input, { keychain }))
    expect(error.message).toContain('Customer (ambiguous: customfield_14849, customfield_99999)')
    expect(calls).toEqual([])
    expect(await readFields()).toBeNull()
  })

  it('fails when createmeta for one issue type answers 500 and stores nothing', async () => {
    serveMyself(200)
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/issue/createmeta/PSAPAC/issuetypes/11502`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    )
    const { keychain, calls } = fakeSecurity()
    expect((await failure(login(input, { keychain }))).code).toBe('jira_error')
    expect(calls).toEqual([])
    expect((await readSettings()).email).toBeUndefined()
    expect(await readFields()).toBeNull()
  })

  it('applies fieldOverrides from settings', async () => {
    serveMyself(200)
    serveCreatemeta({
      edit: (type, fields) =>
        type === 'epic' ? [...fields, { key: 'customfield_99999', name: 'Customer' }] : fields,
    })
    await writeSettings({ fieldOverrides: { customer: 'customfield_99999' } })
    await login(input, { keychain: fakeSecurity().keychain })
    expect((await readFields())?.ids.customer).toBe('customfield_99999')
  })

  it('refuses a redirect and never contacts the target', async () => {
    const target = 'https://evil.example/rest/api/3/myself'
    const reached: Request[] = []
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, () => HttpResponse.redirect(target, 302)),
      http.get(target, ({ request }) => {
        reached.push(request)
        return HttpResponse.json({})
      }),
    )
    const { keychain, calls } = fakeSecurity()
    expect((await failure(login(input, { keychain }))).code).toBe('jira_error')
    expect(reached).toEqual([])
    expect(calls).toEqual([])
  })

  it('maps a timeout to jira_error and stores nothing', async () => {
    server.use(
      http.get(`${JIRA_SITE}/rest/api/3/myself`, async () => {
        await delay('infinite')
        return HttpResponse.json({})
      }),
    )
    const { keychain, calls } = fakeSecurity()
    const error = await failure(login(input, { keychain, timeoutMs: 50 }))
    expect(error.code).toBe('jira_error')
    expect(error.message).toContain('did not answer')
    expect(calls).toEqual([])
  })

  it.each([
    ['http scheme', 'http://engineering-collibra.atlassian.net'],
    ['another host', 'https://example.com'],
    ['a lookalike host', 'https://engineering-collibra.atlassian.net.evil.example'],
    ['a host in the userinfo', 'https://engineering-collibra.atlassian.net@evil.example'],
    ['a path', 'https://engineering-collibra.atlassian.net/wiki'],
    ['a port', 'https://engineering-collibra.atlassian.net:8443'],
    ['a query', 'https://engineering-collibra.atlassian.net/?a=b'],
    ['no url', 'engineering-collibra'],
  ])('rejects %s before sending any credential', async (_name, siteUrl) => {
    // MSW fails any unhandled request, so a request would surface as jira_error instead.
    const { keychain, calls } = fakeSecurity()
    const error = await failure(login({ ...input, siteUrl }, { keychain }))
    expect(error.code).toBe('validation_failed')
    expect(calls).toEqual([])
  })

  it.each([
    ['a token with a quote', { token: 'ab"cd' }],
    ['a token over 1024 bytes', { token: 'a'.repeat(5000) }],
    ['an email with a quote', { email: "o'brien@example.com" }],
    ['an email over 254 bytes', { email: `${'a'.repeat(300)}@example.com` }],
  ])('rejects %s before calling Jira', async (_name, override) => {
    // MSW fails any unhandled request, so a request would surface as jira_error instead.
    const { keychain, calls } = fakeSecurity()
    const error = await failure(login({ ...input, ...override }, { keychain }))
    expect(error.code).toBe('validation_failed')
    expect(calls).toEqual([])
  })

  it('accepts a trailing slash and stores the origin', async () => {
    serveMyself(200)
    await login({ ...input, siteUrl: `${JIRA_SITE}/` }, { keychain: fakeSecurity().keychain })
    expect((await readSettings()).siteUrl).toBe(JIRA_SITE)
  })

  it('deletes the previous account item when the email changes', async () => {
    serveMyself(200)
    const { items, keychain } = fakeSecurity()
    await login({ ...input, email: OTHER_EMAIL, token: 'first' }, { keychain })
    await login(input, { keychain })
    expect([...items.keys()]).toEqual([EMAIL])
    expect((await readSettings()).email).toBe(EMAIL)
  })

  it('keeps the item when the same email logs in again', async () => {
    serveMyself(200)
    const { calls, keychain } = fakeSecurity()
    await login(input, { keychain })
    await login({ ...input, token: 'rotated' }, { keychain })
    expect(calls.filter((c) => c.args[0] === 'delete-generic-password')).toEqual([])
    expect(await keychain.get(EMAIL)).toBe('rotated')
  })

  it('treats an email that differs only in case as the same account', async () => {
    serveMyself(200)
    const { calls, keychain } = fakeSecurity()
    await login(input, { keychain })
    const recased = EMAIL.replace('shane', 'Shane')
    await login({ ...input, email: recased, token: 'rotated' }, { keychain })
    expect(calls.filter((c) => c.args[0] === 'delete-generic-password')).toEqual([])
    expect(await keychain.get(recased)).toBe('rotated')
  })

  it('succeeds when deleting the previous account item fails', async () => {
    serveMyself(200)
    const fake = fakeSecurity()
    await login({ ...input, email: OTHER_EMAIL, token: 'first' }, { keychain: fake.keychain })
    const keychain = { ...fake.keychain, delete: () => Promise.reject(new Error('locked')) }
    await expect(login(input, { keychain })).resolves.toMatchObject({ accountId: 'abc' })
    expect(await fake.keychain.get(EMAIL)).toBe(TOKEN)
    expect((await readSettings()).email).toBe(EMAIL)
  })
})

describe('getCredentials', () => {
  it('returns the site, email and stored token after login', async () => {
    serveMyself(200)
    const { keychain } = fakeSecurity()
    await login(input, { keychain })
    expect(await getCredentials({ keychain })).toEqual({
      siteUrl: JIRA_SITE,
      email: EMAIL,
      token: TOKEN,
    })
  })

  it('throws permission_denied when settings hold no email', async () => {
    expect((await failure(getCredentials({ keychain: fakeSecurity().keychain }))).code).toBe(
      'permission_denied',
    )
  })

  it('throws permission_denied when the Keychain item is gone', async () => {
    await writeSettings({ siteUrl: JIRA_SITE, email: EMAIL })
    expect((await failure(getCredentials({ keychain: fakeSecurity().keychain }))).code).toBe(
      'permission_denied',
    )
  })

  it.each(['http://example.atlassian.net', 'https://evil.example'])(
    'refuses a tampered settings site %s without reading the token',
    async (siteUrl) => {
      const { calls, keychain } = fakeSecurity()
      await keychain.set(EMAIL, TOKEN)
      calls.length = 0
      await writeSettings({ siteUrl, email: EMAIL })
      expect((await failure(getCredentials({ keychain }))).code).toBe('validation_failed')
      expect(calls).toEqual([])
    },
  )
})

describe('logout', () => {
  it('deletes the item and clears the email but keeps the site and project', async () => {
    serveMyself(200)
    const { keychain } = fakeSecurity()
    await login(input, { keychain })
    await logout({ keychain })
    expect(await keychain.get(EMAIL)).toBeNull()
    const settings = await readSettings()
    expect(settings.email).toBeUndefined()
    expect(settings).toMatchObject({ siteUrl: JIRA_SITE, projectKey: 'PSAPAC' })
  })

  it('deletes every item, whatever settings say', async () => {
    const { items, keychain } = fakeSecurity()
    await keychain.set(EMAIL, TOKEN)
    await keychain.set(OTHER_EMAIL, 'stale')
    await writeSettings({ siteUrl: JIRA_SITE, email: EMAIL })
    await logout({ keychain })
    expect(items.size).toBe(0)
    expect((await readSettings()).email).toBeUndefined()
  })

  it('still deletes the items when settings.json is corrupt', async () => {
    const { items, keychain } = fakeSecurity()
    await keychain.set(EMAIL, TOKEN)
    await writeFile(join(dir, 'settings.json'), '{not json')
    await logout({ keychain })
    expect(items.size).toBe(0)
  })

  it('succeeds when the item is already gone', async () => {
    await writeSettings({ siteUrl: JIRA_SITE, email: EMAIL })
    await logout({ keychain: fakeSecurity().keychain })
    expect((await readSettings()).email).toBeUndefined()
  })

  it('succeeds when never logged in', async () => {
    const { keychain } = fakeSecurity()
    await expect(logout({ keychain })).resolves.toBeUndefined()
  })
})
