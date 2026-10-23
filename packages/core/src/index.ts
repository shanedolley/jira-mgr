export const APP_NAME = 'jira-mgr'

/** What macOS calls the desktop app: its window, menu bar, Dock and bundle. The CLI keeps `APP_NAME`. */
export const DESKTOP_NAME = 'Jira Task Manager'

/** Title shown by every client, for example `jira-mgr 1.0.0`. */
export function appTitle(version: string): string {
  return `${APP_NAME} ${version}`
}

export * from './errors.js'
export type { Issue } from './issue.js'
