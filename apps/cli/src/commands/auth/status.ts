import { JiraMgrError } from '@jira-mgr/core'
import { parseSiteUrl } from '@jira-mgr/core/auth'
import { readFields, readSettings } from '@jira-mgr/core/state'

import type { Handler } from '../../context.js'
import { localDateTime, renderRecord } from '../../output.js'
import type { SpecOf } from '../../schema.js'

interface StatusData {
  siteUrl: string
  projectKey: string | null
  email: string
  accountId: string
  displayName: string
  fieldsResolvedAt: string | null
}

/**
 * `jm auth status`. Settings without a site and email mean logged out, whatever client is
 * injected. Otherwise `ctx.me()` signs through `getCredentials`, which fails with
 * `permission_denied` when the Keychain holds no token. The token itself never leaves core.
 */
export const status: Handler<SpecOf<'auth status'>, StatusData> = {
  async run(_input, ctx) {
    const [settings, fields] = await Promise.all([readSettings(), readFields()])
    if (settings.siteUrl === undefined || settings.email === undefined) {
      throw new JiraMgrError('permission_denied', 'Not logged in. Run `jm auth login`.')
    }
    const user = await ctx.me()
    // The same check `getCredentials` makes, so the site reported is the one that was signed for.
    const siteUrl = parseSiteUrl(settings.siteUrl)
    if (siteUrl === null) {
      throw new JiraMgrError(
        'validation_failed',
        'The site URL in settings is not an https://<name>.atlassian.net site. Run `jm auth login` again.',
      )
    }
    return {
      siteUrl,
      projectKey: settings.projectKey ?? null,
      email: settings.email,
      accountId: user.accountId,
      displayName: user.displayName,
      fieldsResolvedAt: fields?.resolvedAt ?? null,
    }
  },

  render: (data, tty) =>
    renderRecord(tty, [
      ['Site', data.siteUrl],
      ['Project', data.projectKey ?? 'not set'],
      ['Email', data.email],
      ['Name', data.displayName],
      ['Account id', data.accountId],
      ['Token', 'stored in the Keychain'],
      [
        'Fields resolved',
        data.fieldsResolvedAt === null ? 'never' : localDateTime(data.fieldsResolvedAt),
      ],
    ]),
}
