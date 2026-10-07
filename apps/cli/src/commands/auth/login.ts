import { JiraMgrError } from '@jira-mgr/core'
import { login as storeLogin } from '@jira-mgr/core/auth'
import { readSettings } from '@jira-mgr/core/state'

import type { Context, Handler } from '../../context.js'
import { renderRecord } from '../../output.js'
import type { SpecOf } from '../../schema.js'

interface LoginData {
  siteUrl: string
  projectKey: string
  email: string
  accountId: string
  displayName: string
}

const QUESTIONS = {
  site: 'Jira site URL (https://<name>.atlassian.net): ',
  project: 'Jira project key: ',
  email: 'Account email: ',
}

/** Asks one question. After Ctrl-C it throws, so no later prompt appears. */
async function ask(ctx: Context, question: string, hidden: boolean): Promise<string> {
  const answer = await ctx.io.prompt(question, hidden)
  ctx.signal.throwIfAborted()
  return answer.trim()
}

/**
 * The API token, from a hidden prompt when stdin is a terminal (cooked mode would echo it, even
 * under `--token-stdin`), else from stdin. It lives in this function and the core call, nowhere else.
 */
async function readToken(tokenStdin: boolean, ctx: Context): Promise<string> {
  let token: string
  if (tokenStdin && !ctx.io.stdinIsTTY) {
    token = (await ctx.io.readStdin()).trim()
  } else if (ctx.io.stdinIsTTY && (tokenStdin || ctx.io.stderrIsTTY)) {
    token = await ask(ctx, 'Jira API token (hidden): ', true)
  } else {
    throw new JiraMgrError(
      'validation_failed',
      'No API token. Pipe it in with --token-stdin, or run jm auth login on a terminal to be prompted.',
    )
  }
  if (token === '') throw new JiraMgrError('validation_failed', 'The API token is empty.')
  return token
}

/** `jm auth login`: verifies the credentials, stores them, and reports who is logged in. */
export const login: Handler<SpecOf<'auth login'>, LoginData> = {
  async run(input, ctx) {
    const settings = await readSettings()
    const canPrompt = ctx.io.stdinIsTTY && ctx.io.stderrIsTTY
    const missing: string[] = []
    async function value(flag: keyof typeof QUESTIONS, given: string | undefined) {
      if (given !== undefined) return given
      const answer = canPrompt ? await ask(ctx, QUESTIONS[flag], false) : ''
      if (answer === '') missing.push(`--${flag}`)
      return answer
    }
    const siteUrl = await value('site', input.site ?? settings.siteUrl)
    const projectKey = await value('project', input.project ?? settings.projectKey)
    const email = await value('email', input.email ?? settings.email)
    if (missing.length > 0) {
      throw new JiraMgrError(
        'validation_failed',
        `Missing ${missing.join(', ')}. Pass ${missing.length > 1 ? 'them' : 'it'}, or run jm auth login on a terminal to be prompted.`,
      )
    }

    const token = await readToken(input.tokenStdin, ctx)
    const user = await storeLogin(
      { siteUrl, projectKey, email, token },
      { keychain: ctx.keychain, now: () => ctx.now() },
    )

    // Core normalises the site URL, so report what it saved.
    const stored = await readSettings()
    return {
      siteUrl: stored.siteUrl ?? siteUrl,
      projectKey: stored.projectKey ?? projectKey,
      email: stored.email ?? email,
      accountId: user.accountId,
      displayName: user.displayName,
    }
  },

  render: (data, tty) =>
    [
      `Logged in as ${tty.style('bold', data.displayName)}.`,
      renderRecord(tty, [
        ['Site', data.siteUrl],
        ['Project', data.projectKey],
        ['Email', data.email],
        ['Account id', data.accountId],
      ]),
      'The token is stored in the Keychain.',
    ].join('\n'),
}
