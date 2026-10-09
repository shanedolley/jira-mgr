import { JiraMgrError, type Issue } from '@jira-mgr/core'
import { imageNode, sameAdf, type AdfNode } from '@jira-mgr/core/adf'
import { createKeychain, getCredentials, login, logout, type Keychain } from '@jira-mgr/core/auth'
import type { CustomerOption } from '@jira-mgr/core/hierarchy'
import { addAttachment, attachmentMediaId } from '@jira-mgr/core/extras'
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
import {
  createIssue,
  deleteIssue,
  editIssue,
  listTransitions,
  transitionIssue,
} from '@jira-mgr/core/write'

import type {
  AddImageArgs,
  CreateIssueArgs,
  CreatedIssue,
  CreateViewArgs,
  CurrentUser,
  DeleteIssueArgs,
  DeletedIssue,
  DeleteViewArgs,
  EditIssueArgs,
  FieldChoice,
  FieldOptionsArgs,
  ImageArgs,
  ImageResult,
  IssuePhase,
  IssuesProgress,
  ListIssuesArgs,
  KeyArgs,
  LoginArgs,
  RenameViewArgs,
  SessionState,
  SetDescriptionArgs,
  SetDescriptionResult,
  SetSprintArgs,
  SetStatusArgs,
  SetSummaryArgs,
  SprintOption,
  StatusOption,
  Toggles,
  UserOption,
} from '../shared/ipc'
import { imageType, uploadFilename } from './images'
import { createMediaIndex } from './media'
import { desktopMessage } from './messages'

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
  /**
   * Writes the description unless Jira's no longer matches the one the edit started from, in
   * which case nothing is written and Jira's is returned. Jira has no conditional write, so an
   * edit that lands between the read and the write still loses.
   */
  setDescription(args: SetDescriptionArgs): Promise<SetDescriptionResult>
  /** Attaches a dropped image and returns the `mediaSingle` that embeds it. */
  addImage(args: AddImageArgs): Promise<{ node: AdfNode }>
  /** The bytes of an image attachment, found by the media id a description embeds. */
  image(args: ImageArgs): Promise<ImageResult>
  listTransitions(args: KeyArgs): Promise<StatusOption[]>
  setStatus(args: SetStatusArgs): Promise<void>
  setSprint(args: SetSprintArgs): Promise<void>
  /**
   * Creates an issue, moves it into the sprint when one is given, and reads it back, so the
   * result shows what Jira holds after any automation rule ran. Once the issue exists a failed
   * later step is a `warning` on the result, never a throw, so the key is not lost.
   */
  createIssue(args: CreateIssueArgs): Promise<CreatedIssue>
  /** Deletes an issue, and its subtasks only when asked and only the ones the caller was shown. */
  deleteIssue(args: DeleteIssueArgs): Promise<DeletedIssue>
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
  /** Tests inject a clock for the media index's 30 second windows. */
  now?: () => number
}

/** The key a `createIssue` that could not read the new issue back carries in its details. */
function createdKey(error: unknown): string | undefined {
  if (!(error instanceof JiraMgrError) || error.code !== 'jira_error') return undefined
  const key = (error.details as { key?: unknown } | undefined)?.key
  return typeof key === 'string' ? key : undefined
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

  const media = createMediaIndex(http, deps.now)

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
      media.clear()
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
    async setDescription({ key, description, base }) {
      await assertInProject(key)
      const current = (await getIssue(http, key)).description
      // Compared by value and blind to key order, so the user's own field edits raise no conflict.
      if (!sameAdf(current, base)) return { saved: false, current }
      await editIssue(http, key, { description })
      return { saved: true }
    },
    async addImage({ key, filename, mimeType, bytes, width, height }) {
      await assertInProject(key)
      if (imageType(bytes) !== mimeType) {
        throw new JiraMgrError('validation_failed', 'The file is not the image type it claims.')
      }
      const name = uploadFilename(filename, mimeType)
      const [attachment] = await addAttachment(http, key, {
        filename: name,
        content: bytes,
        contentType: mimeType,
      })
      if (attachment === undefined) {
        throw new JiraMgrError('jira_error', 'Jira did not say which attachment it stored.')
      }
      const mediaId = await attachmentMediaId(http, attachment.id)
      media.add(key, attachment, mediaId)
      // Jira's filename, not the one sent, since Jira may have renamed a duplicate.
      return { node: imageNode({ mediaId, filename: attachment.filename, width, height }) }
    },
    async image({ key, mediaId }) {
      await assertInProject(key)
      return media.image(key, mediaId)
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
    async createIssue({ sprintId, ...input }) {
      // The same guard the CLI applies: this app manages the settings project only.
      if (input.parentKey !== undefined) await assertInProject(input.parentKey)
      let key: string
      let issue: IssueDetail | null
      let warning: string | null = null
      try {
        issue = await createIssue(http, input)
        key = issue.key
      } catch (error) {
        // A failed read-back after a good create carries the new key. Anything else is a refusal.
        const kept = createdKey(error)
        if (kept === undefined) throw error
        key = kept
        issue = null
        warning = desktopMessage(error instanceof Error ? error.message : String(error))
      }
      const readBackFailed = issue === null
      if (sprintId !== undefined) {
        const reason = (error: unknown) =>
          error instanceof Error ? desktopMessage(error.message) : String(error)
        let moved = false
        try {
          await moveToSprint(http, sprintId, [key])
          moved = true
        } catch (error) {
          // The issue exists and the read-back, if it worked, is accurate: only the sprint is missing.
          warning ??= `Created ${key}, but it is not in the sprint. ${reason(error)}`
        }
        if (moved) {
          try {
            issue = await getIssue(http, key)
            // This read is the read-back the create could not make, so its warning no longer holds.
            if (readBackFailed) warning = null
          } catch (error) {
            issue = null
            warning ??= `Created ${key}, but could not read it back. ${reason(error)}`
          }
        }
      }
      return { key, issue, warning }
    },
    async deleteIssue({ key, deleteSubtasks, subtasks: shown }) {
      await assertInProject(key)
      // Read now, not from what the user saw: a subtask added since must not go unseen.
      const keys = (await getIssue(http, key)).subtasks.map((s) => s.key)
      if (keys.length > 0 && !deleteSubtasks) {
        throw new JiraMgrError(
          'validation_failed',
          `${key} has subtasks ${keys.join(', ')}. Delete them too, or move them first.`,
          { details: { subtasks: keys } },
        )
      }
      const unseen = keys.filter((k) => !shown.includes(k))
      if (deleteSubtasks && unseen.length > 0) {
        throw new JiraMgrError(
          'validation_failed',
          `${key} has new subtasks ${unseen.join(', ')}. Review the list and delete again.`,
          { details: { subtasks: keys } },
        )
      }
      await deleteIssue(http, key, { deleteSubtasks })
      // Any subtask was refused above unless the caller asked to cascade, so `keys` is what goes.
      return { key, deletedSubtasks: keys }
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
