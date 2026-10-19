import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { JiraMgrError, type Issue } from '@jira-mgr/core'
import { imageNode, sameAdf, type AdfNode } from '@jira-mgr/core/adf'
import { createKeychain, getCredentials, login, logout, type Keychain } from '@jira-mgr/core/auth'
import { runBatch, type BatchOptions } from '@jira-mgr/core/bulk'
import type { CustomerOption } from '@jira-mgr/core/hierarchy'
import {
  addAttachment,
  addComment,
  addLink,
  addWorklog,
  attachmentContent,
  attachmentMediaId,
  deleteComment,
  deleteWorklog,
  editComment,
  editWorklog,
  getLink,
  getTimeTracking,
  listAttachments,
  listComments,
  listLinks,
  listLinkTypes,
  listWorklogs,
  removeLink,
  type Attachment,
} from '@jira-mgr/core/extras'
import { createHttpClient, type HttpClient } from '@jira-mgr/core/http'
import {
  createInboxCache,
  listInbox,
  markAllRead,
  markRead,
  readInbox,
  type InboxEntry,
} from '@jira-mgr/core/inbox'
import { assertTypeChangeAllowed, type IssueDetail } from '@jira-mgr/core/issue'
import { getFieldOptions, getProfile, searchAssignableUsers } from '@jira-mgr/core/lookups'
import { getIssue, searchIssuePages, searchText } from '@jira-mgr/core/search'
import {
  findBoard,
  listSprints,
  moveToBacklog,
  moveToSprint,
  readSprint,
  type SprintReport,
} from '@jira-mgr/core/sprints'
import {
  assertInProject,
  createView,
  deleteView,
  duplicateView,
  moveView,
  readSettings,
  readTimer,
  readViews,
  renameView,
  updateView,
  writeSettings,
  type SavedView,
  type Settings,
} from '@jira-mgr/core/state'
import type { TimeTrackingSettings } from '@jira-mgr/core/time-tracking'
import {
  startTimer as startCoreTimer,
  stopAndLog,
  stopTimer as stopCoreTimer,
  switchAndLog,
  type TimerOptions,
} from '@jira-mgr/core/timer'
import { assertTimeable } from '@jira-mgr/core/timer-calc'
import {
  createIssue,
  deleteIssue,
  editIssue,
  listTransitions,
  transitionIssue,
} from '@jira-mgr/core/write'

import type {
  AddAttachmentArgs,
  AddCommentArgs,
  AddImageArgs,
  AddLinkArgs,
  AddWorklogArgs,
  AttachmentItem,
  CommentIdArgs,
  CommentItem,
  CreateIssueArgs,
  CreatedIssue,
  CreateViewArgs,
  CurrentUser,
  DeleteIssueArgs,
  DeletedIssue,
  Display,
  DeleteViewArgs,
  DownloadAttachmentArgs,
  DownloadResult,
  DuplicateViewArgs,
  EditCommentArgs,
  EditIssueArgs,
  AvatarArgs,
  AvatarImage,
  BatchArgs,
  BatchOutcome,
  BatchProgress,
  EditWorklogArgs,
  FieldChoice,
  FieldOptionsArgs,
  ImageArgs,
  ImageResult,
  IssuePhase,
  IssuesProgress,
  LateRead,
  ListIssuesArgs,
  KeyArgs,
  LinksResult,
  LoginArgs,
  MarkInboxAllReadArgs,
  MarkInboxReadArgs,
  MoveViewArgs,
  RemoveLinkArgs,
  RenameViewArgs,
  SearchTextArgs,
  SessionState,
  SetDescriptionArgs,
  SetDescriptionResult,
  SetSprintArgs,
  SetStatusArgs,
  SetSummaryArgs,
  SprintOption,
  StartTimerArgs,
  StatusOption,
  StopTimerArgs,
  SwitchTimerArgs,
  TimerOutcome,
  TimerSnapshot,
  Toggles,
  TreeLevel,
  UpdateViewArgs,
  UserOption,
  WorklogIdArgs,
  WorklogItem,
} from '../shared/ipc'
import { ATTACHMENT_LIMIT_BYTES } from '../shared/ipc'
import { createAvatarFetcher } from './avatars'
import { imageType, safeFilename, savedFilename, uploadFilename } from './images'
import { createMediaIndex } from './media'
import { desktopMessage } from './messages'

/** What a handler gives the backend to report on the window that asked. */
export interface ProgressSender {
  sendProgress(progress: IssuesProgress): void
  sendBatchProgress(progress: BatchProgress): void
  /** False once the window is gone. */
  isOpen(): boolean
  sendLateRead(read: LateRead): void
}

/**
 * How long after a create the issue is read again. PSAPAC's automation sets the estimates within
 * about 1 s and the label, Customer, parent and sprint within about 10 s (handover Traps).
 */
export const LATE_READ_MS = 10_000

/** Everything the renderer can ask of Jira, in terms of core. The token never leaves this module. */
export interface Backend {
  getSession(): Promise<SessionState>
  login(args: LoginArgs): Promise<SessionState>
  logout(): Promise<SessionState>
  /** One phase of the project's issues, or `null` when a newer load of the phase or a logout aborted it. */
  listIssues(args: ListIssuesArgs, progress: ProgressSender): Promise<Issue[] | null>
  /**
   * Issues whose summary, description or comments hold the text, from Jira's `text ~`. A newer
   * search aborts the one in flight, which returns `null`, as does a logout.
   */
  searchText(args: SearchTextArgs): Promise<Issue[] | null>
  setSummary(args: SetSummaryArgs): Promise<void>
  /** One issue with its description and subtasks, read afresh. */
  getIssue(args: KeyArgs): Promise<IssueDetail>
  editIssue(args: EditIssueArgs): Promise<void>
  /**
   * Applies each item's change through core's `runBatch`: one bulk call per distinct change where
   * Jira has one, else one call per issue. Every key and new parent must be in the project, or
   * nothing is sent. Jira's refusals come back in the outcome, not as a throw. A logout aborts it.
   */
  batch(args: BatchArgs, progress: ProgressSender): Promise<BatchOutcome>
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
  listComments(args: KeyArgs): Promise<CommentItem[]>
  addComment(args: AddCommentArgs): Promise<CommentItem>
  editComment(args: EditCommentArgs): Promise<CommentItem>
  deleteComment(args: CommentIdArgs): Promise<void>
  listWorklogs(args: KeyArgs): Promise<WorklogItem[]>
  /** The site's working day and week. `null` when time tracking is off or unconfigured. */
  getTimeTracking(): Promise<TimeTrackingSettings | null>
  /** Logs work with `adjustEstimate=auto`, so the remaining estimate falls by the time logged. */
  addWorklog(args: AddWorklogArgs): Promise<WorklogItem>
  editWorklog(args: EditWorklogArgs): Promise<WorklogItem>
  deleteWorklog(args: WorklogIdArgs): Promise<void>
  /** The issue's links and every link type the site has. */
  listLinks(args: KeyArgs): Promise<LinksResult>
  /** Both issues must be in the project. `direction` is core's: `outward` makes `key` the blocker of a Blocks link. */
  addLink(args: AddLinkArgs): Promise<void>
  /** The link must touch `key`, and both its issues must be in the project. */
  removeLink(args: RemoveLinkArgs): Promise<void>
  listAttachments(args: KeyArgs): Promise<AttachmentItem[]>
  /** Attaches a file of any type. */
  addAttachmentFile(args: AddAttachmentArgs): Promise<AttachmentItem>
  /** Saves an attachment to the path a native save dialog returns; nothing is written when the user cancels. */
  downloadAttachment(args: DownloadAttachmentArgs): Promise<DownloadResult>
  listTransitions(args: KeyArgs): Promise<StatusOption[]>
  setStatus(args: SetStatusArgs): Promise<void>
  setSprint(args: SetSprintArgs): Promise<void>
  /**
   * Creates an issue, moves it into the sprint when one is given, and reads it back, so the
   * result shows what Jira holds after any automation rule ran. Once the issue exists a failed
   * later step is a `warning` on the result, never a throw, so the key is not lost. With
   * `progress`, it also reads the issue once more after `LATE_READ_MS` and sends that to the window.
   */
  createIssue(args: CreateIssueArgs, progress?: ProgressSender): Promise<CreatedIssue>
  /** Deletes an issue, and its subtasks only when asked and only the ones the caller was shown. */
  deleteIssue(args: DeleteIssueArgs): Promise<DeletedIssue>
  listSprints(args: { all: boolean }): Promise<SprintOption[]>
  /** A sprint with its issues and their counts. It reads only, so it needs no project guard. */
  getSprint(args: { id: number }): Promise<SprintReport>
  searchUsers(args: { query: string }): Promise<UserOption[]>
  listFieldOptions(args: FieldOptionsArgs): Promise<FieldChoice[]>
  getMe(): Promise<CurrentUser>
  getAvatar(args: AvatarArgs): Promise<AvatarImage>
  listCustomers(): Promise<CustomerOption[]>
  getToggles(): Promise<Toggles>
  setToggles(toggles: Toggles): Promise<Toggles>
  getDisplay(): Promise<Display>
  setDisplay(display: Display): Promise<Display>
  getTreeLevel(): Promise<TreeLevel>
  setTreeLevel(level: TreeLevel): Promise<TreeLevel>
  /** The saved views, the starters when `views.json` does not exist yet. */
  listViews(): Promise<SavedView[]>
  createView(args: CreateViewArgs): Promise<SavedView>
  renameView(args: RenameViewArgs): Promise<SavedView>
  deleteView(args: DeleteViewArgs): Promise<void>
  /**
   * The Inbox: the issues the user is assigned to, reported or watches that changed in 14 days,
   * each read or unread by `inbox.json`. A call made while another runs shares its answer. A
   * logout aborts the load, which answers with no entries.
   */
  listInbox(): Promise<InboxEntry[]>
  /** Marks one issue read, in call order with every other Inbox write. */
  markInboxRead(args: MarkInboxReadArgs): Promise<void>
  /** Marks everything up to `through` read, in call order with every other Inbox write. */
  markInboxAllRead(args: MarkInboxAllReadArgs): Promise<void>
  updateView(args: UpdateViewArgs): Promise<SavedView>
  duplicateView(args: DuplicateViewArgs): Promise<SavedView>
  /** Moves a view to a place in the saved order and answers with the whole list. */
  moveView(args: MoveViewArgs): Promise<SavedView[]>
  /** The shared timer file and the timer settings, as `jm timer status` reads them. */
  getTimer(): Promise<TimerSnapshot>
  /** Starts a timer on a timeable issue, or resumes the one already running on it. Another running timer is refused. */
  startTimer(args: StartTimerArgs): Promise<TimerOutcome>
  /** Core's `stopAndLog`, or `stopTimer` with `discard`. A long or midnight-crossing timer needs `confirm` or `timeSpent`. */
  stopTimer(args: StopTimerArgs): Promise<TimerOutcome>
  /** Core's `switchAndLog`, or with `discard` a start that drops the running timer's time. */
  switchTimer(args: SwitchTimerArgs): Promise<TimerOutcome>
  /** Cancels the pending second reads. The app calls it on quit. */
  dispose(): void
  /** Resolves once the settings and views writes queued so far have landed. The app waits on it before it quits. */
  flush(): Promise<void>
}

export interface BackendDeps {
  /** Tests inject a fake Keychain. Production uses core's `/usr/bin/security` one. */
  keychain?: Keychain
  http?: HttpClient
  /** Tests inject a clock for the media index's 30 second windows and the timer's start and stop times. */
  now?: () => number
  /** Tests and the e2e entry shorten the wait between polls of a bulk task. */
  batchPoll?: Pick<BatchOptions, 'pollMs' | 'sleep'>
  /** Tests and the e2e entry shorten the wait before a created issue is read again. */
  lateReadMs?: number
  /** Asks the user where to save a file, offering `defaultName`. `null` means they cancelled. */
  chooseSavePath?: (defaultName: string) => Promise<string | null>
  /** Tests inject a recorder. Production writes the file. */
  writeFile?: (path: string, bytes: Uint8Array) => Promise<void>
}

/** A content type the multipart part may declare, as core accepts it. */
const CONTENT_TYPE = /^[a-z]+\/[a-z0-9][a-z0-9.+-]*$/

/** The attachment as the page lists it: Jira's content URL stays in main. */
const attachmentItem = (a: Attachment): AttachmentItem => ({
  id: a.id,
  filename: a.filename,
  size: a.size,
  mimeType: a.mimeType,
  created: a.created,
  author: a.author,
})

/** The key a `createIssue` that could not read the new issue back carries in its details. */
function createdKey(error: unknown): string | undefined {
  if (!(error instanceof JiraMgrError) || error.code !== 'jira_error') return undefined
  const key = (error.details as { key?: unknown } | undefined)?.key
  return typeof key === 'string' ? key : undefined
}

export function createBackend(deps: BackendDeps = {}): Backend {
  const keychain = deps.keychain ?? createKeychain()
  const http = deps.http ?? createHttpClient({ credentials: () => getCredentials({ keychain }) })
  const avatars = createAvatarFetcher({ credentials: () => getCredentials({ keychain }) })

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

  const timerOptions: TimerOptions = { now: () => new Date(deps.now?.() ?? Date.now()) }
  async function timerSnapshot(): Promise<TimerSnapshot> {
    const [timer, settings] = await Promise.all([readTimer(), readSettings()])
    return { timer, settings: settings.timer }
  }
  /** The issue to time, read from Jira for its type. The app manages the settings project only. */
  async function timeableIssue(key: string) {
    await assertInProject(key)
    const issue = await getIssue(http, key)
    assertTimeable(issue)
    return issue
  }

  /** The second reads waiting to fire, one per created issue. Logout and quit clear them. */
  const lateReads = new Set<NodeJS.Timeout>()
  function clearLateReads() {
    for (const timer of lateReads) clearTimeout(timer)
    lateReads.clear()
  }
  function scheduleLateRead(key: string, to: ProgressSender) {
    const timer = setTimeout(() => {
      lateReads.delete(timer)
      if (!to.isOpen()) return
      getIssue(http, key).then(
        (issue) => {
          if (to.isOpen()) to.sendLateRead({ key, issue })
        },
        () => {
          // Deleted since, or Jira is unreachable: the first read stands and there is nothing to add.
        },
      )
    }, deps.lateReadMs ?? LATE_READ_MS)
    lateReads.add(timer)
  }

  /** The load running for each phase. A newer load of a phase, and a logout, abort it. */
  const loads = new Map<IssuePhase, AbortController>()
  /** The batches running. A logout aborts them, so no write goes out with a token that is going away. */
  const batches = new Set<AbortController>()
  /** The text search in flight. The palette types one query at a time, so a new search aborts it. */
  let textSearch: AbortController | undefined
  /** Settings writes in call order, so a second toggle, display or level change never reads settings from before the first. */
  let settingsWrites: Promise<unknown> = Promise.resolve()
  /** Changes one part of `settings.json`, keeping the rest, and returns that part. */
  function inSettingsOrder<K extends 'toggles' | 'display' | 'treeLevel'>(
    key: K,
    value: Settings[K],
  ): Promise<Settings[K]> {
    const write = settingsWrites.then(async () => {
      await writeSettings({ ...(await readSettings()), [key]: value })
      return value
    })
    settingsWrites = write.catch(() => undefined)
    return write
  }
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

  /**
   * Inbox reads and writes in call order. Core reads, changes and rewrites `inbox.json`, so two
   * overlapping marks would drop one. The CLI does not touch the file yet; a command that writes
   * it must take a lock first.
   */
  let inboxCalls: Promise<unknown> = Promise.resolve()
  function inInboxOrder<T>(run: () => Promise<T>): Promise<T> {
    const call = inboxCalls.then(run)
    inboxCalls = call.catch(() => undefined)
    return call
  }
  /** What the Inbox read for the signed-in account, so a poll of an unchanged issue asks Jira nothing. */
  let inboxCache = createInboxCache()
  /** Inbox writes called so far. A load that began before the latest one holds a stale file. */
  let inboxWrites = 0
  /**
   * The Inbox load running, which a second call shares instead of starting another, unless an
   * Inbox write came after it read `inbox.json`: that load would answer with the old marks.
   */
  let inboxLoad:
    { promise: Promise<InboxEntry[]>; controller: AbortController; writes: number } | undefined
  function loadInbox(): Promise<InboxEntry[]> {
    if (inboxLoad?.writes === inboxWrites) return inboxLoad.promise
    const controller = new AbortController()
    const promise = (async () => {
      const inbox = await inInboxOrder(readInbox)
      try {
        return await listInbox(http, {
          inbox,
          cache: inboxCache,
          signal: controller.signal,
          now: new Date(deps.now?.() ?? Date.now()),
        })
      } catch (error) {
        // A logout aborted it, and nobody reads the answer.
        if (controller.signal.aborted) return []
        throw error
      }
    })().finally(() => {
      if (inboxLoad?.controller === controller) inboxLoad = undefined
    })
    inboxLoad = { promise, controller, writes: inboxWrites }
    return promise
  }
  function dropInbox() {
    inboxLoad?.controller.abort()
    inboxLoad = undefined
    inboxCache = createInboxCache()
  }

  /**
   * Whether the Comments property is on. Jira sends every comment body to give the count, so the
   * Tree and the Sprint page ask for the field only while the saved display shows it.
   */
  async function wantsComments(): Promise<boolean> {
    return (await readSettings()).display.properties.includes('comments')
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
        comments: await wantsComments(),
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

  async function searchTextAborting({ query }: SearchTextArgs): Promise<Issue[] | null> {
    textSearch?.abort()
    const controller = new AbortController()
    textSearch = controller
    try {
      const issues = await searchText(http, query, { signal: controller.signal })
      return controller.signal.aborted ? null : issues
    } catch (error) {
      // An aborted search is not a failure: nobody reads its result.
      if (controller.signal.aborted) return null
      throw error
    } finally {
      if (textSearch === controller) textSearch = undefined
    }
  }

  return {
    getSession,
    async login(args) {
      await login(args, { keychain })
      dropInbox()
      avatars.clear()
      return getSession()
    },
    async logout() {
      // No page may be fetched with a token that is going away.
      for (const controller of loads.values()) controller.abort()
      loads.clear()
      textSearch?.abort()
      for (const controller of batches) controller.abort()
      media.clear()
      clearLateReads()
      dropInbox()
      await logout({ keychain })
      avatars.clear()
      return getSession()
    },
    listIssues,
    searchText: searchTextAborting,
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
    async batch({ batchId, items }, progress) {
      // The same guards the CLI applies, checked for every issue before the first request.
      for (const { key, change } of items) {
        await assertInProject(key)
        if (change.kind === 'edit' && change.changes.parentKey !== undefined) {
          await assertInProject(change.changes.parentKey)
        }
        if (change.kind === 'edit' && change.changes.type !== undefined) {
          assertTypeChangeAllowed(key, (await getIssue(http, key)).issueType.name)
        }
      }
      const controller = new AbortController()
      batches.add(controller)
      try {
        const outcome = await runBatch(http, items, {
          ...deps.batchPoll,
          signal: controller.signal,
          onProgress: ({ done, total }) => {
            if (progress.isOpen()) progress.sendBatchProgress({ batchId, done, total })
          },
        })
        // A reason crosses IPC inside a result, not as an error, so it loses the request here.
        return {
          ...outcome,
          refused: outcome.refused.map(({ key, reason }) => ({
            key,
            reason: desktopMessage(reason),
          })),
        }
      } finally {
        batches.delete(controller)
      }
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
    listComments: ({ key }) => listComments(http, key),
    async addComment({ key, body }) {
      await assertInProject(key)
      return addComment(http, key, body)
    },
    async editComment({ key, commentId, body }) {
      await assertInProject(key)
      return editComment(http, key, commentId, body)
    },
    async deleteComment({ key, commentId }) {
      await assertInProject(key)
      await deleteComment(http, key, commentId)
    },
    listWorklogs: ({ key }) => listWorklogs(http, key),
    getTimeTracking: () => getTimeTracking(http),
    async addWorklog({ key, timeSpent, started, comment }) {
      await assertInProject(key)
      return addWorklog(http, key, {
        timeSpent,
        ...(started !== undefined && { started: new Date(started) }),
        ...(comment !== undefined && { comment }),
      })
    },
    async editWorklog({ key, worklogId, timeSpent, started, comment }) {
      await assertInProject(key)
      return editWorklog(http, key, worklogId, {
        ...(timeSpent !== undefined && { timeSpent }),
        ...(started !== undefined && { started: new Date(started) }),
        ...(comment !== undefined && { comment }),
      })
    },
    async deleteWorklog({ key, worklogId }) {
      await assertInProject(key)
      await deleteWorklog(http, key, worklogId)
    },
    async listLinks({ key }) {
      const [links, types] = await Promise.all([listLinks(http, key), listLinkTypes(http)])
      return { links, types }
    },
    async addLink({ key, typeId, direction, otherKey }) {
      // The same guard as `jm link add`: a link never reaches an issue outside the project.
      await assertInProject(key)
      await assertInProject(otherKey)
      if (key === otherKey) {
        throw new JiraMgrError('validation_failed', `${key} cannot link to itself.`)
      }
      await addLink(http, { type: { id: typeId }, key, direction, otherKey })
    },
    async removeLink({ key, linkId }) {
      const link = await getLink(http, linkId)
      // A link id names no issue, so one that is not this page's is refused as if it did not exist.
      if (link.inwardKey !== key && link.outwardKey !== key) {
        throw new JiraMgrError('not_found', `Link ${linkId} is not a link of ${key}.`)
      }
      await assertInProject(link.inwardKey)
      await assertInProject(link.outwardKey)
      await removeLink(http, linkId)
    },
    async listAttachments({ key }) {
      return (await listAttachments(http, key)).map(attachmentItem)
    },
    async addAttachmentFile({ key, filename, mimeType, bytes }) {
      await assertInProject(key)
      const [attachment] = await addAttachment(http, key, {
        filename: safeFilename(filename),
        content: bytes,
        ...(CONTENT_TYPE.test(mimeType) && { contentType: mimeType }),
      })
      if (attachment === undefined) {
        throw new JiraMgrError('jira_error', 'Jira did not say which attachment it stored.')
      }
      return attachmentItem(attachment)
    },
    async downloadAttachment({ key, attachmentId }) {
      await assertInProject(key)
      const found = (await listAttachments(http, key)).find((a) => a.id === attachmentId)
      if (found === undefined) {
        throw new JiraMgrError('not_found', `${key} has no attachment ${attachmentId}.`)
      }
      if (found.size > ATTACHMENT_LIMIT_BYTES) {
        throw new JiraMgrError(
          'validation_failed',
          `${found.filename} is over the ${String(ATTACHMENT_LIMIT_BYTES / 1_000_000)} MB this app downloads. Open ${key} in Jira to get it.`,
        )
      }
      if (deps.chooseSavePath === undefined) {
        throw new JiraMgrError('internal', 'This app cannot save files.')
      }
      // Only a path the user chose in the native dialog is ever written.
      const path = await deps.chooseSavePath(savedFilename(found.filename))
      if (path === null) return { saved: false }
      // ponytail: the file sits in memory while it downloads; stream it to disk if the limit rises.
      const { bytes } = await attachmentContent(http, attachmentId, {
        maxBytes: ATTACHMENT_LIMIT_BYTES,
      })
      try {
        await (deps.writeFile ?? writeFile)(path, bytes)
      } catch (error) {
        throw new JiraMgrError(
          'internal',
          'Could not write the file. Choose another folder and try again.',
          { cause: error },
        )
      }
      return { saved: true, filename: basename(path) }
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
    async createIssue({ sprintId, ...input }, progress) {
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
      if (progress !== undefined) scheduleLateRead(key, progress)
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
    getSprint: async ({ id }) => readSprint(http, id, { comments: await wantsComments() }),
    searchUsers: ({ query }) => searchAssignableUsers(http, query),
    async listFieldOptions({ field }) {
      return getFieldOptions(http, field)
    },
    getMe: () => getProfile(http),
    getAvatar: ({ url }) => avatars.get(url),
    async listCustomers() {
      const options = await getFieldOptions(http, 'customer')
      return options.map((option) => ({ id: option.id, value: option.name }))
    },
    async getToggles() {
      return (await readSettings()).toggles
    },
    setToggles: (toggles) => inSettingsOrder('toggles', toggles),
    async getDisplay() {
      return (await readSettings()).display
    },
    setDisplay: (display) => inSettingsOrder('display', display),
    async getTreeLevel() {
      return (await readSettings()).treeLevel
    },
    setTreeLevel: (level) => inSettingsOrder('treeLevel', level),
    listViews: () => inViewOrder(readViews),
    createView: ({ name, filters, toggles, display }) =>
      inViewOrder(() => createView(name, { filters, toggles, display })),
    renameView: ({ id, name }) => inViewOrder(() => renameView(id, name)),
    deleteView: ({ id }) => inViewOrder(() => deleteView(id)),
    listInbox: loadInbox,
    markInboxRead({ key, updated }) {
      inboxWrites++
      return inInboxOrder(() => markRead(key, updated, new Date(deps.now?.() ?? Date.now())))
    },
    markInboxAllRead({ through }) {
      inboxWrites++
      return inInboxOrder(() => markAllRead(through, new Date(deps.now?.() ?? Date.now())))
    },
    updateView: ({ id, filters, toggles, display }) =>
      inViewOrder(() => updateView(id, { filters, toggles, display })),
    duplicateView: ({ id }) => inViewOrder(() => duplicateView(id)),
    moveView: ({ id, toIndex }) => inViewOrder(() => moveView(id, toIndex)),
    getTimer: timerSnapshot,
    async startTimer({ key }) {
      await startCoreTimer(await timeableIssue(key), timerOptions)
      return { snapshot: await timerSnapshot(), stopped: null, logged: null }
    },
    async stopTimer({ discard, ...args }) {
      await assertInProject(args.expectRunning)
      let stopped: TimerOutcome['stopped'] = null
      let logged: TimerOutcome['logged'] = null
      if (discard === true) {
        stopped = await stopCoreTimer({ ...timerOptions, expectRunning: args.expectRunning })
      } else {
        const result = await stopAndLog(http, { ...timerOptions, ...args })
        stopped = result?.draft ?? null
        logged = result?.worklog ?? null
      }
      return { snapshot: await timerSnapshot(), stopped, logged }
    },
    async switchTimer({ key, discard, ...args }) {
      await assertInProject(args.expectRunning)
      const issue = await timeableIssue(key)
      if (discard === true) {
        const { stopped } = await startCoreTimer(issue, {
          ...timerOptions,
          switch: true,
          expectRunning: args.expectRunning,
        })
        return { snapshot: await timerSnapshot(), stopped, logged: null }
      }
      const result = await switchAndLog(http, issue, { ...timerOptions, ...args })
      return {
        snapshot: await timerSnapshot(),
        stopped: result.stopped,
        logged: result.logged?.worklog ?? null,
      }
    },
    dispose: clearLateReads,
    async flush() {
      await Promise.all([settingsWrites, viewCalls])
    },
  }
}
