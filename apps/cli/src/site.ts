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

/**
 * Refuses an issue key outside the project in settings, since `jm` manages that project only.
 * Throws before any request.
 */
export async function assertInProject(key: string): Promise<void> {
  const { projectKey } = await readSettings()
  if (projectKey === undefined) {
    throw new JiraMgrError('permission_denied', 'No project is set. Run `jm auth login`.')
  }
  const project = key.slice(0, key.lastIndexOf('-'))
  if (project !== projectKey.toUpperCase()) {
    throw new JiraMgrError(
      'validation_failed',
      `${key} is not in ${projectKey}. jm manages the ${projectKey} project only.`,
    )
  }
}
