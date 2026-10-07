export const APP_NAME = 'jira-mgr'

/** Title shown by every client, for example `jira-mgr 0.0.0`. */
export function appTitle(version: string): string {
  return `${APP_NAME} ${version}`
}
