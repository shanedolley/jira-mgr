import { JiraMgrError, type Issue } from '@jira-mgr/core'
import { createKeychain, getCredentials, login, logout, type Keychain } from '@jira-mgr/core/auth'
import type { CustomerOption } from '@jira-mgr/core/hierarchy'
import { createHttpClient, type HttpClient } from '@jira-mgr/core/http'
import { assertTypeChangeAllowed, type IssueDetail } from '@jira-mgr/core/issue'
import { getCurrentUser, getFieldOptions, searchAssignableUsers } from '@jira-mgr/core/lookups'
import { getIssue, searchIssuePages } from '@jira-mgr/core/search'
import { findBoard, listSprints, moveToBacklog, moveToSprint } from '@jira-mgr/core/sprints'
import {
  assertInProject,
  createView,
  deleteView,
  readSettings,
  readViews,
  renameView,
  writeSettings,
  type SavedView,
} from '@jira-mgr/core/state'
import { editIssue, listTransitions, transitionIssue } from '@jira-mgr/core/write'

import type {
  CreateViewArgs,
  CurrentUser,
  DeleteViewArgs,
  EditIssueArgs,
  FieldChoice,
  FieldOptionsArgs,
  IssuePhase,
  IssuesProgress,
  ListIssuesArgs,
  KeyArgs,
  LoginArgs,
  RenameViewArgs,
  SessionState,
  SetSprintArgs,
  SetStatusArgs,
  SetSummaryArgs,
  SprintOption,
  StatusOption,
  Toggles,
  UserOption,
} from '../shared/ipc'

/** What a handler gives the backend to report on the window that asked. */
export interface ProgressSender {
  sendProgress(progress: IssuesProgress): void
}

/** Everything the renderer can ask of Jira, in terms of core. The token never leaves this module. */
export interface Backend {
  getSession(): Promise<SessionState>
  login(args: LoginArgs): Promise<SessionState>
  logout(): Promise<SessionState>
  /** One phase of the project's issues, or `null` when a newer load of the phase or a logout aborted it. */
  listIssues(args: ListIssuesArgs, progress: ProgressSender): Promise<Issue[] | null>
  setSummary(args: SetSummaryArgs): Promise<void>
  /** One issue with its description and subtasks, read afresh. */
  getIssue(args: KeyArgs): Promise<IssueDetail>
  editIssue(args: EditIssueArgs): Promise<void>
  listTransitions(args: KeyArgs): Promise<StatusOption[]>
  setStatus(args: SetStatusArgs): Promise<void>
  setSprint(args: SetSprintArgs): Promise<void>
  listSprints(args: { all: boolean }): Promise<SprintOption[]>
  searchUsers(args: { query: string }): Promise<UserOption[]>
  listFieldOptions(args: FieldOptionsArgs): Promise<FieldChoice[]>
  getMe(): Promise<CurrentUser>
  listCustomers(): Promise<CustomerOption[]>
  getToggles(): Promise<Toggles>
  setToggles(toggles: Toggles): Promise<Toggles>
  /** The saved views, the starters when `views.json` does not exist yet. */
  listViews(): Promise<SavedView[]>
  createView(args: CreateViewArgs): Promise<SavedView>
  renameView(args: RenameViewArgs): Promise<SavedView>
  deleteView(args: DeleteViewArgs): Promise<void>
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

  /** The load running for each phase. A newer load of a phase, and a logout, abort it. */
  const loads = new Map<IssuePhase, AbortController>()
  /** Settings writes in call order, so a second toggle press never reads settings from before the first. */
  let toggleWrites: Promise<unknown> = Promise.resolve()
  /**
   * Views reads and writes in call order. Core reads, changes and rewrites `views.json`, so two
   * overlapping calls would drop an edit. The CLI only reads the file, so this in-process queue is
   * the only writer that needs ordering; a CLI command that writes views must take a lock first.
   */
  let viewCalls: Promise<unknown> = Promise.resolve()
  function inViewOrder<T>(run: () => Promise<T>): Promise<T> {
    const call = viewCalls.then(run)
    viewCalls = call.catch(() => undefined)
    return call
  }

  async function listIssues(
    { phase, loadId }: ListIssuesArgs,
    progress: ProgressSender,
  ): Promise<Issue[] | null> {
    loads.get(phase)?.abort()
    const controller = new AbortController()
    loads.set(phase, controller)
    try {
      const issues: Issue[] = []
      for await (const page of searchIssuePages(http, {
        phases: [phase],
        signal: controller.signal,
      })) {
        issues.push(...page.issues)
        if (!controller.signal.aborted) {
          progress.sendProgress({ phase, loadId, loaded: page.loaded })
        }
      }
      return controller.signal.aborted ? null : issues
    } catch (error) {
      // An aborted load is not a failure: nobody reads its result.
      if (controller.signal.aborted) return null
      throw error
    } finally {
      // Only this load's own entry: a newer load of the phase may have replaced it.
      if (loads.get(phase) === controller) loads.delete(phase)
    }
  }

  return {
    getSession,
    async login(args) {
      await login(args, { keychain })
      return getSession()
    },
    async logout() {
      // No page may be fetched with a token that is going away.
      for (const controller of loads.values()) controller.abort()
      loads.clear()
      await logout({ keychain })
      return getSession()
    },
    listIssues,
    async setSummary({ key, summary }) {
      // The same guard the CLI applies: this app manages the settings project only.
      await assertInProject(key)
      await editIssue(http, key, { summary })
    },
    getIssue: ({ key }) => getIssue(http, key),
    async editIssue({ key, changes }) {
      // The same guards the CLI applies: this app manages the settings project only, a new
      // parent included, and only a Story, Task or Bug can change type.
      await assertInProject(key)
      if (changes.parentKey !== undefined) await assertInProject(changes.parentKey)
      if (changes.type !== undefined) {
        assertTypeChangeAllowed(key, (await getIssue(http, key)).issueType.name)
      }
      await editIssue(http, key, changes)
    },
    async listTransitions({ key }) {
      // Two transitions can reach one status, and a picker lists each status once.
      const reached = new Map<string, StatusOption>()
      for (const { to } of await listTransitions(http, key)) {
        if (!reached.has(to.id))
          reached.set(to.id, { id: to.id, name: to.name, category: to.category })
      }
      return [...reached.values()]
    },
    async setStatus({ key, statusId }) {
      await assertInProject(key)
      await transitionIssue(http, key, statusId)
    },
    async setSprint({ key, sprintId }) {
      await assertInProject(key)
      if (sprintId === null) await moveToBacklog(http, [key])
      else await moveToSprint(http, sprintId, [key])
    },
    async listSprints({ all }) {
      const board = await findBoard(http)
      if (board === null) {
        throw new JiraMgrError('not_found', 'The project has no board that supports sprints.')
      }
      return listSprints(http, board.id, { all })
    },
    searchUsers: ({ query }) => searchAssignableUsers(http, query),
    async listFieldOptions({ field }) {
      return getFieldOptions(http, field)
    },
    getMe: () => getCurrentUser(http),
    async listCustomers() {
      const options = await getFieldOptions(http, 'customer')
      return options.map((option) => ({ id: option.id, value: option.name }))
    },
    async getToggles() {
      return (await readSettings()).toggles
    },
    setToggles(toggles) {
      const write = toggleWrites.then(async () => {
        const settings = await readSettings()
        await writeSettings({ ...settings, toggles })
        return toggles
      })
      toggleWrites = write.catch(() => undefined)
      return write
    },
    listViews: () => inViewOrder(readViews),
    createView: ({ name, filters, toggles }) =>
      inViewOrder(() => createView(name, { filters, toggles })),
    renameView: ({ id, name }) => inViewOrder(() => renameView(id, name)),
    deleteView: ({ id }) => inViewOrder(() => deleteView(id)),
  }
}
