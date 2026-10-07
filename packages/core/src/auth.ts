import { spawn } from 'node:child_process'

import { z } from 'zod'

import { JiraMgrError } from './errors.js'
import { readSettings, writeSettings } from './state.js'

const SECURITY = '/usr/bin/security'
const KEYCHAIN_SERVICE = 'jira-mgr'
/** `security` exits 44 when the item is not in the Keychain. */
const ITEM_NOT_FOUND = 44
/** `security -i` reads stdin in 4095-byte chunks and runs the overflow as a new command. */
const MAX_COMMAND_BYTES = 4095
const MAX_TOKEN_BYTES = 1024
/** The longest valid email address. */
const MAX_EMAIL_BYTES = 254
/** `deleteAll` gives up after this many items, so a stuck delete cannot loop forever. */
const MAX_ITEMS = 20
const VERIFY_TIMEOUT_MS = 15_000

/** Runs `/usr/bin/security` with `args`, writing `stdin` to it when given. */
export type SecurityRunner = (
  args: string[],
  stdin?: string,
) => Promise<{ status: number; stdout: string }>

const runSecurity: SecurityRunner = (args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(SECURITY, args, { stdio: ['pipe', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    // A dead child makes the write fail with EPIPE; the exit status reports it.
    child.stdin.on('error', () => undefined)
    child.on('error', reject)
    child.on('close', (status) => {
      resolve({ status: status ?? -1, stdout })
    })
    child.stdin.end(stdin)
  })

export interface Keychain {
  /** The stored token, or `null` when no item exists for `email`. */
  get(email: string): Promise<string | null>
  set(email: string, token: string): Promise<void>
  /** A missing item is not an error. */
  delete(email: string): Promise<void>
  /** Deletes every item of the service, whatever its account. */
  deleteAll(): Promise<void>
}

/**
 * `security -i` parses double-quoted words. Anything that could end the quote or the
 * command line has no safe encoding, and an oversized value overflows the stdin chunk.
 */
function assertStorable(email: string, token: string): void {
  for (const [name, value, max] of [
    ['token', token, MAX_TOKEN_BYTES],
    ['email', email, MAX_EMAIL_BYTES],
  ] as const) {
    if (value === '' || /["'\\\p{Cc}]/u.test(value)) {
      throw new JiraMgrError(
        'validation_failed',
        `The ${name} is empty or holds a quote, backslash or control character, which cannot be stored safely.`,
      )
    }
    if (Buffer.byteLength(value) > max) {
      throw new JiraMgrError(
        'validation_failed',
        `The ${name} is longer than ${String(max)} bytes.`,
      )
    }
  }
}

/** The Keychain item of ADR-0003. `service` and `run` are overridable for tests. */
export function createKeychain(options: { run?: SecurityRunner; service?: string } = {}): Keychain {
  const run = options.run ?? runSecurity
  const service = options.service ?? KEYCHAIN_SERVICE

  async function call(args: string[], stdin?: string) {
    try {
      return await run(args, stdin)
    } catch (cause) {
      throw new JiraMgrError('internal', 'Cannot run /usr/bin/security.', { cause })
    }
  }

  // Message text carries no stderr and no argument: `security` may echo the command.
  function fail(action: string, status: number): JiraMgrError {
    return new JiraMgrError(
      'internal',
      `Keychain ${action} failed (security exited ${String(status)}).`,
    )
  }

  async function get(email: string): Promise<string | null> {
    const { status, stdout } = await call([
      'find-generic-password',
      '-s',
      service,
      '-a',
      email,
      '-w',
    ])
    if (status === ITEM_NOT_FOUND) return null
    if (status !== 0) throw fail('read', status)
    return stdout.replace(/\n$/, '')
  }

  async function remove(email: string): Promise<void> {
    const { status } = await call(['delete-generic-password', '-s', service, '-a', email])
    if (status !== 0 && status !== ITEM_NOT_FOUND) throw fail('delete', status)
  }

  return {
    get,
    async set(email, token) {
      assertStorable(email, token)
      const command = `add-generic-password -U -s "${service}" -a "${email}" -w "${token}"\n`
      if (Buffer.byteLength(command) >= MAX_COMMAND_BYTES) {
        throw new JiraMgrError('validation_failed', 'The Keychain command is too long to send.')
      }
      const { status } = await call(['-i'], command)
      if (status !== 0) throw fail('write', status)
      // `security -i` exits 0 even when its command fails, so read the item back.
      if ((await get(email)) !== token) {
        // A partial write may have left an item behind. Remove it; the write error is the one to report.
        await remove(email).catch(() => undefined)
        throw fail('write', status)
      }
    },
    delete: remove,
    async deleteAll() {
      for (let i = 0; i < MAX_ITEMS; i++) {
        const { status } = await call(['delete-generic-password', '-s', service])
        if (status === ITEM_NOT_FOUND) return
        if (status !== 0) throw fail('delete', status)
      }
      throw new JiraMgrError(
        'internal',
        `More than ${String(MAX_ITEMS)} Keychain items found for ${service}.`,
      )
    },
  }
}

/** The origin of an `https://<name>.atlassian.net` site URL, or `null` for anything else. */
export function parseSiteUrl(value: string): string | null {
  if (!URL.canParse(value)) return null
  const url = new URL(value)
  const ok =
    url.protocol === 'https:' &&
    /^[a-z0-9-]+\.atlassian\.net$/i.test(url.hostname) &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  return ok ? url.origin : null
}

const loginSchema = z.object({
  siteUrl: z.string().transform((value, ctx) => {
    const origin = parseSiteUrl(value)
    if (origin === null) {
      ctx.addIssue({ code: 'custom', message: 'must be https://<name>.atlassian.net with no path' })
      return z.NEVER
    }
    return origin
  }),
  projectKey: z.string().min(1),
  email: z.email(),
  token: z.string().min(1),
})

export type LoginInput = z.input<typeof loginSchema>

/** Asks Jira who the token belongs to, so nothing is stored for a bad token. */
async function verify(
  siteUrl: string,
  email: string,
  token: string,
  timeoutMs: number,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${siteUrl}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError'
    throw new JiraMgrError(
      'jira_error',
      timedOut
        ? `${siteUrl} did not answer within ${String(timeoutMs / 1000)} seconds.`
        : `Cannot reach ${siteUrl}. Check the site URL and your network.`,
      { cause },
    )
  }
  if (response.status === 401 || response.status === 403) {
    throw new JiraMgrError(
      'permission_denied',
      'Jira rejected the email or API token. Check both and log in again.',
    )
  }
  if (!response.ok) {
    throw new JiraMgrError(
      'jira_error',
      `Jira answered ${String(response.status)} to the login check.`,
    )
  }
}

/** Verifies the credentials against Jira, then stores the token in the Keychain and the rest in settings. */
export async function login(
  input: LoginInput,
  deps: { keychain?: Keychain; timeoutMs?: number } = {},
): Promise<void> {
  const parsed = loginSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new JiraMgrError('validation_failed', `Login input is invalid (${issues}).`)
  }
  const { siteUrl, projectKey, email, token } = parsed.data
  assertStorable(email, token)
  const settings = await readSettings()
  await verify(siteUrl, email, token, deps.timeoutMs ?? VERIFY_TIMEOUT_MS)
  const keychain = deps.keychain ?? createKeychain()
  await keychain.set(email, token)
  await writeSettings({ ...settings, siteUrl, projectKey, email })
  // Logging in as someone else must not leave the previous account's token behind. Emails
  // differing only in case are one account, and deleting it would remove the token just stored.
  if (settings.email !== undefined && settings.email.toLowerCase() !== email.toLowerCase()) {
    // The new login is complete, so a failed cleanup must not fail it. `logout` removes stragglers.
    await keychain.delete(settings.email).catch(() => undefined)
  }
}

/** Removes every jira-mgr Keychain item and the email from settings. Safe to run when logged out. */
export async function logout(deps: { keychain?: Keychain } = {}): Promise<void> {
  // A corrupt settings file must not keep the token in the Keychain.
  const settings = await readSettings().catch(() => undefined)
  await (deps.keychain ?? createKeychain()).deleteAll()
  if (settings?.email === undefined) return
  await writeSettings({ ...settings, email: undefined })
}

/** The credentials a Jira client needs. Throws `permission_denied` when not logged in. */
export async function getCredentials(
  deps: { keychain?: Keychain } = {},
): Promise<{ siteUrl: string; email: string; token: string }> {
  const { siteUrl, email } = await readSettings()
  const notLoggedIn = new JiraMgrError('permission_denied', 'Not logged in. Run `jm auth login`.')
  if (siteUrl === undefined || email === undefined) throw notLoggedIn
  // Anything the user runs can edit settings.json, so never pair the token with an unchecked site.
  const origin = parseSiteUrl(siteUrl)
  if (origin === null) {
    throw new JiraMgrError(
      'validation_failed',
      'The site URL in settings is not an https://<name>.atlassian.net site. Run `jm auth login` again.',
    )
  }
  const token = await (deps.keychain ?? createKeychain()).get(email)
  if (token === null) throw notLoggedIn
  return { siteUrl: origin, email, token }
}
