import { JiraMgrError, type Issue } from '@jira-mgr/core'
import { createKeychain, getCredentials, login, logout, type Keychain } from '@jira-mgr/core/auth'
import { createHttpClient, type HttpClient } from '@jira-mgr/core/http'
import { searchIssues } from '@jira-mgr/core/search'
import { readSettings } from '@jira-mgr/core/state'
import { editIssue } from '@jira-mgr/core/write'

import type { LoginArgs, SessionState, SetSummaryArgs } from '../shared/ipc'

/** Everything the renderer can ask of Jira, in terms of core. The token never leaves this module. */
export interface Backend {
  getSession(): Promise<SessionState>
  login(args: LoginArgs): Promise<SessionState>
  logout(): Promise<SessionState>
  listIssues(): Promise<Issue[]>
  setSummary(args: SetSummaryArgs): Promise<void>
}

export interface BackendDeps {
  /** Tests inject a fake Keychain. Production uses core's `/usr/bin/security` one. */
  keychain?: Keychain
  http?: HttpClient
}

export function createBackend(deps: BackendDeps = {}): Backend {
  const keychain = deps.keychain ?? createKeychain()
  const http = deps.http ?? createHttpClient({ credentials: () => getCredentials({ keychain }) })

  /** Logged in means settings name a site, project and email, and the Keychain holds a token. */
  async function getSession(): Promise<SessionState> {
    const { siteUrl, projectKey, email } = await readSettings()
    if (siteUrl === undefined || projectKey === undefined || email === undefined) {
      return { loggedIn: false, prefill: { siteUrl, projectKey, email } }
    }
    const token = await keychain.get(email)
    if (token === null) return { loggedIn: false, prefill: { siteUrl, projectKey, email } }
    return { loggedIn: true, session: { siteUrl, projectKey, email } }
  }

  return {
    getSession,
    async login(args) {
      await login(args, { keychain })
      return getSession()
    },
    async logout() {
      await logout({ keychain })
      return getSession()
    },
    // D1 shows unresolved issues only; D2 loads Done in the background.
    listIssues: () => searchIssues(http, { phases: ['unresolved'] }),
    async setSummary({ key, summary }) {
      // The same guard the CLI applies: this app manages the settings project only.
      const { projectKey } = await readSettings()
      if (projectKey === undefined) {
        throw new JiraMgrError('permission_denied', 'No project is set. Log in first.')
      }
      if (key.slice(0, key.lastIndexOf('-')) !== projectKey.toUpperCase()) {
        throw new JiraMgrError(
          'validation_failed',
          `${key} is not in ${projectKey}. This app manages the ${projectKey} project only.`,
        )
      }
      await editIssue(http, key, { summary })
    },
  }
}
