import { JiraMgrError } from '@jira-mgr/core'
import { parseSiteUrl } from '@jira-mgr/core/auth'
import { readSettings } from '@jira-mgr/core/state'

/** The Atlassian Cloud site in settings. Throws `validation_failed` for any other, so no link points elsewhere. */
export async function siteUrl(): Promise<string> {
  const url = parseSiteUrl((await readSettings()).siteUrl ?? '')
  if (url === null) {
    throw new JiraMgrError(
      'validation_failed',
      'The site URL in settings is not an https://<name>.atlassian.net site. Run `jm auth login` again.',
    )
  }
  return url
}
