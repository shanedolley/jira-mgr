import type { ErrorCode, Issue } from '@jira-mgr/core'
import type { AdfDoc, AdfNode } from '@jira-mgr/core/adf'
import type { Attachment, IssueComment, IssueLink, LinkType, Worklog } from '@jira-mgr/core/extras'
import type { CustomerOption, HierarchyOptions } from '@jira-mgr/core/hierarchy'
import type { InboxEntry } from '@jira-mgr/core/inbox'
import type { IssueDetail, SwappableType } from '@jira-mgr/core/issue'
import type { SprintReport } from '@jira-mgr/core/sprints'
import type { TreeLevel } from '@jira-mgr/core/display'
import type { Display, SavedView } from '@jira-mgr/core/state'
import type { TimeTrackingSettings } from '@jira-mgr/core/time-tracking'
import type { RunningTimer, TimerSettings, WorklogDraft } from '@jira-mgr/core/timer-calc'
import type { ViewFilters } from '@jira-mgr/core/view-filter'

/** The site, project and account a login stored. The token never appears here. */
export interface Session {
  siteUrl: string
  projectKey: string
  email: string
}

/** Logged out carries whatever settings already hold, so the login form starts filled. */
export type SessionState =
  { loggedIn: true; session: Session } | { loggedIn: false; prefill: Partial<Session> }

export interface LoginArgs extends Session {
  token: string
}

export interface SetSummaryArgs {
  key: string
  summary: string
}

/** The two search phases core loads, in load order. */
export type IssuePhase = 'unresolved' | 'done'

/** The renderer numbers each load it starts, so a superseded load's progress can be told apart. */
export interface ListIssuesArgs {
  phase: IssuePhase
  loadId: number
}

/** Main to renderer: issues loaded so far in one phase of one load. */
export interface IssuesProgress {
  phase: IssuePhase
  loadId: number
  loaded: number
}

/** The text the palette sends Jira's `text ~` search. */
export interface SearchTextArgs {
  query: string
}

/** The three toggles `settings.json` remembers (Q28). */
export type Toggles = Pick<HierarchyOptions, 'hideDone' | 'assigneeMe' | 'hideEmptyCustomers'>

/** The row properties and issue order `settings.json` remembers, and a saved view may carry. */
export type { Display, TreeLevel }

/** A saved view as `views.json` holds it, the file `jm view list` reads. */
export type { SavedView }

/** The view to add: a name, the filter bar's filters, the three toggles and the display. Core makes the id. */
export interface CreateViewArgs {
  name: string
  filters: ViewFilters
  toggles: Toggles
  /** Left out, the view carries no display (create) or keeps the one it has (update). */
  display?: Display
}

export interface RenameViewArgs {
  id: string
  name: string
}

export interface DeleteViewArgs {
  id: string
}

/** The issue the user opened in the Inbox, with the `updated` time of the entry they saw. */
export interface MarkInboxReadArgs {
  key: string
  updated: string
}

/** Everything updated up to `through`, the newest `updated` in the list the user saw, is read. */
export interface MarkInboxAllReadArgs {
  through: string
}

export type { InboxEntry }

/** The view to overwrite, with the filters, toggles and display to put in it. */
export interface UpdateViewArgs {
  id: string
  filters: ViewFilters
  toggles: Toggles
  /** Left out, the view carries no display (create) or keeps the one it has (update). */
  display?: Display
}

export interface DuplicateViewArgs {
  id: string
}

/** `toIndex` is the zero-based place the view takes in the saved order. */
export interface MoveViewArgs {
  id: string
  toIndex: number
}

/** Every field `issues:edit` can change. Each is optional, and `null` clears the ones that can clear. */
export interface IssueChanges {
  /** An account id, or `null` to unassign. */
  assignee?: string | null
  priorityId?: string
  startDate?: string | null
  dueDate?: string | null
  addLabels?: string[]
  removeLabels?: string[]
  parentKey?: string
  customerId?: string
  engagementId?: string
  /** A Jira duration such as `2h 30m`. */
  originalEstimate?: string
  timeRemainingHours?: number | null
  type?: SwappableType
}

/** The image types the editor embeds, which main checks by magic bytes. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

export type ImageType = (typeof IMAGE_TYPES)[number]

/** The largest image a drop embeds: Jira's attachment limit on PSAPAC (Q34). */
export const IMAGE_LIMIT_BYTES = 100_000_000

/** The largest attachment shown in the editor, so a page of huge images stays light. */
export const PREVIEW_LIMIT_BYTES = 20_000_000

/** A description edit with the description the edit started from, which main compares to Jira's. */
export interface SetDescriptionArgs {
  key: string
  description: AdfDoc | null
  base: AdfDoc | null
}

/** Saved, or Jira's description changed since the edit began and nothing was written. */
export type SetDescriptionResult = { saved: true } | { saved: false; current: AdfDoc | null }

export interface AddImageArgs {
  key: string
  filename: string
  mimeType: ImageType
  bytes: Uint8Array
  width?: number
  height?: number
}

export interface ImageArgs {
  key: string
  /** The Media Services file id of a `media` node. */
  mediaId: string
}

export interface ImageResult {
  mimeType: ImageType
  bytes: Uint8Array
}

/** The largest attachment: Jira's upload limit on PSAPAC (Q34), the same as an embedded image's. */
export const ATTACHMENT_LIMIT_BYTES = 100_000_000

export type CommentItem = IssueComment

export type WorklogItem = Worklog

export type LinkItem = IssueLink

export type LinkTypeItem = LinkType

/** An attachment as the page lists it. Jira's content URL stays in main. */
export type AttachmentItem = Omit<Attachment, 'contentUrl'>

export interface AddCommentArgs {
  key: string
  body: AdfDoc
}

export interface EditCommentArgs extends AddCommentArgs {
  commentId: string
}

export interface CommentIdArgs {
  key: string
  commentId: string
}

export interface AddWorklogArgs {
  key: string
  /** A Jira duration such as `1h 30m`. */
  timeSpent: string
  /** An ISO date-time. Jira starts the worklog now when it is left out. */
  started?: string
  comment?: AdfDoc
}

export interface EditWorklogArgs {
  key: string
  worklogId: string
  timeSpent?: string
  started?: string
  comment?: AdfDoc
}

export interface WorklogIdArgs {
  key: string
  worklogId: string
}

/** The links of an issue and every link type the site offers, which the add form needs. */
export interface LinksResult {
  links: LinkItem[]
  types: LinkTypeItem[]
}

export interface AddLinkArgs {
  /** The issue the link is added from. */
  key: string
  typeId: string
  /** `outward` reads "key <type.outward> otherKey", `inward` "key <type.inward> otherKey". */
  direction: 'outward' | 'inward'
  otherKey: string
}

export interface RemoveLinkArgs {
  /** The issue whose page shows the link. One end of the link must be this issue. */
  key: string
  linkId: string
}

export interface AddAttachmentArgs {
  key: string
  filename: string
  /** The type the browser reports, which may be empty. Main passes it on only when it is a valid type. */
  mimeType: string
  bytes: Uint8Array
}

export interface DownloadAttachmentArgs {
  key: string
  attachmentId: string
}

/** The user chose a place and the file was written there, or cancelled the dialog. */
export type DownloadResult = { saved: true; filename: string } | { saved: false }

/** The shared `timer.json` and the settings that shape the worklog a stop logs. `timer` is `null` when none runs. */
export interface TimerSnapshot {
  timer: RunningTimer | null
  settings: TimerSettings
}

export interface StartTimerArgs {
  key: string
}

/** How a dialog ends a timer. `expectRunning` is the issue the user was shown. */
export interface StopTimerArgs {
  expectRunning: string
  /** A Jira duration the user chose instead of the rounded elapsed time. */
  timeSpent?: string
  comment?: AdfDoc
  /** The user saw the long-timer warning and accepts the time. */
  confirm?: boolean
  /** Drop the time instead of logging it. */
  discard?: boolean
}

/** Stops `expectRunning` as `StopTimerArgs` says, then starts the timer on `key`. */
export interface SwitchTimerArgs extends StopTimerArgs {
  key: string
}

/** What a start, stop or switch did. */
export interface TimerOutcome {
  /** The timer file afterwards. */
  snapshot: TimerSnapshot
  /** The timer that ended, or `null` when none ran. */
  stopped: WorklogDraft | null
  /** The worklog the stopped timer became, or `null` when it was discarded or none ran. */
  logged: WorklogItem | null
}

export interface EditIssueArgs {
  key: string
  changes: IssueChanges
}

/** The change one batch item makes. Core's `runBatch` groups equal changes into one Jira call. */
export type BatchChange =
  | { kind: 'edit'; changes: IssueChanges }
  | { kind: 'status'; statusId: string }
  /** `sprintId: null` moves the issue to the backlog. */
  | { kind: 'sprint'; sprintId: number | null }

/** One issue of a batch. `id` is its numeric id, which Jira's bulk task results name it by. */
export interface BatchItem {
  key: string
  id: string
  change: BatchChange
}

/** The most issues one `issues:batch` takes, as many as Jira's bulk endpoints do. */
export const BATCH_MAX = 1000

/** The renderer numbers each batch, so a progress event is told apart from another batch's. */
export interface BatchArgs {
  batchId: number
  items: BatchItem[]
}

/** Which issues of a batch changed and which Jira refused, in input order. A refusal never throws. */
export interface BatchOutcome {
  done: string[]
  refused: { key: string; reason: string }[]
}

/** Main to renderer: issues of one batch settled so far, done or refused. */
export interface BatchProgress {
  batchId: number
  done: number
  total: number
}

export interface KeyArgs {
  key: string
}

/** The types the create modal offers, the ones core's `createIssue` takes. */
export const CREATE_TYPES = ['Story', 'Task', 'Bug', 'Epic', 'Subtask'] as const

export type CreateType = (typeof CREATE_TYPES)[number]

/** A new issue. Customer and Engagement are required on every type (Q14). */
export interface CreateIssueArgs {
  type: CreateType
  summary: string
  customerId: string
  engagementId: string
  /** Required for a Subtask, and never sent for an Epic. */
  parentKey?: string
  assignee?: string
  /** The description the issue starts with. Left out when it holds no text. */
  description?: AdfDoc
  priorityId?: string
  labels?: string[]
  /** A Jira duration such as `2h 30m`. */
  originalEstimate?: string
  /** Core's create takes no sprint, so main moves the new issue into it after the create. */
  sprintId?: number
}

/** What a create left behind. The issue exists whenever this comes back. */
export interface CreatedIssue {
  key: string
  /** The issue as Jira holds it after the create, the sprint move and any automation. `null` when a read-back failed. */
  issue: IssueDetail | null
  /** Set when the issue was created but a later step failed: the read-back or the sprint move. */
  warning: string | null
}

export interface DeleteIssueArgs {
  key: string
  /** True only when the user chose to delete the subtasks too. */
  deleteSubtasks: boolean
  /** The subtasks the user was shown, so one added since is never deleted unseen. */
  subtasks: string[]
}

export interface DeletedIssue {
  key: string
  deletedSubtasks: string[]
}

export interface SetStatusArgs {
  key: string
  /** The id of the status to reach. */
  statusId: string
}

export interface SetSprintArgs {
  key: string
  /** `null` moves the issue to the backlog. */
  sprintId: number | null
}

/** A status an issue can move to now. */
export interface StatusOption {
  id: string
  name: string
  category: Issue['status']['category'] | null
}

export interface SprintOption {
  id: number
  name: string
  state: 'active' | 'future' | 'closed'
  startDate: string | null
  endDate: string | null
}

export interface UserOption {
  accountId: string
  displayName: string
  avatarUrl: string | null
}

/** The fields whose values come from the project's create metadata. */
export type OptionField = 'customer' | 'engagement' | 'priority' | 'issueType'

export interface FieldOptionsArgs {
  field: OptionField
}

export interface FieldChoice {
  id: string
  name: string
}

export interface CurrentUser {
  accountId: string
  displayName: string
  avatarUrl: string | null
}

export interface AvatarArgs {
  url: string
}

/** A profile image as main checked it. The renderer makes a blob URL from `bytes`. */
export interface AvatarImage {
  type: ImageType
  bytes: Uint8Array
}

/**
 * Every request the renderer can make. The preload script, the main process handlers and the
 * renderer all derive their types from this one table, so a channel name or payload cannot drift.
 */
export interface IpcContract {
  'session:get': { args: undefined; result: SessionState }
  'session:login': { args: LoginArgs; result: SessionState }
  'session:logout': { args: undefined; result: SessionState }
  /** `null` when a newer load of the same phase, or a logout, aborted this one. */
  'issues:list': { args: ListIssuesArgs; result: Issue[] | null }
  /** Project issues whose text fields hold `query`. `null` when a newer search, or a logout, aborted this one. */
  'issues:searchText': { args: SearchTextArgs; result: Issue[] | null }
  'issues:setSummary': { args: SetSummaryArgs; result: null }
  /** One issue with its description and subtasks, read afresh. */
  'issues:get': { args: KeyArgs; result: IssueDetail }
  'issues:edit': { args: EditIssueArgs; result: null }
  /** Applies a change to each issue, through Jira's bulk endpoints where it has one. Progress arrives as `BATCH_PROGRESS_EVENT`. */
  'issues:batch': { args: BatchArgs; result: BatchOutcome }
  /** Writes the description unless Jira's no longer matches `base`. */
  'issues:setDescription': { args: SetDescriptionArgs; result: SetDescriptionResult }
  /** Attaches a dropped image to the issue and returns the `mediaSingle` that embeds it. */
  'attachments:addImage': { args: AddImageArgs; result: { node: AdfNode } }
  /** The bytes of an image attachment, found by the media id a description embeds. */
  'attachments:image': { args: ImageArgs; result: ImageResult }
  'comments:list': { args: KeyArgs; result: CommentItem[] }
  'comments:add': { args: AddCommentArgs; result: CommentItem }
  'comments:edit': { args: EditCommentArgs; result: CommentItem }
  'comments:delete': { args: CommentIdArgs; result: null }
  'worklogs:list': { args: KeyArgs; result: WorklogItem[] }
  /** The site's working day and week, or `null` when time tracking is off or unconfigured. */
  'timetracking:get': { args: undefined; result: TimeTrackingSettings | null }
  /** Logs work and lowers the remaining estimate by it (`adjustEstimate=auto`). */
  'worklogs:add': { args: AddWorklogArgs; result: WorklogItem }
  'worklogs:edit': { args: EditWorklogArgs; result: WorklogItem }
  'worklogs:delete': { args: WorklogIdArgs; result: null }
  'links:list': { args: KeyArgs; result: LinksResult }
  /** Refuses an issue outside the project at either end. */
  'links:add': { args: AddLinkArgs; result: null }
  'links:remove': { args: RemoveLinkArgs; result: null }
  'attachments:list': { args: KeyArgs; result: AttachmentItem[] }
  /** Attaches a file of any type. */
  'attachments:add': { args: AddAttachmentArgs; result: AttachmentItem }
  /** Saves an attachment where the user chooses in a native dialog. The renderer names no path. */
  'attachments:download': { args: DownloadAttachmentArgs; result: DownloadResult }
  'issues:transitions': { args: KeyArgs; result: StatusOption[] }
  'issues:setStatus': { args: SetStatusArgs; result: null }
  'issues:setSprint': { args: SetSprintArgs; result: null }
  'issues:create': { args: CreateIssueArgs; result: CreatedIssue }
  /** Permanent. Refuses to cascade to subtasks the user was not shown. */
  'issues:delete': { args: DeleteIssueArgs; result: DeletedIssue }
  /** Active and future sprints of the project's board, or every sprint with `all`. */
  'sprints:list': { args: { all: boolean }; result: SprintOption[] }
  /** One sprint with its issues and their counts, for the Sprint page. Read-only. */
  'sprints:get': { args: { id: number }; result: SprintReport }
  /** Assignable users whose name or email matches `query`. */
  'users:search': { args: { query: string }; result: UserOption[] }
  'fields:options': { args: FieldOptionsArgs; result: FieldChoice[] }
  'user:me': { args: undefined; result: CurrentUser }
  /** A profile image by URL, fetched and checked by main. Fails with `not_found` when it will not load. */
  'avatars:get': { args: AvatarArgs; result: AvatarImage }
  'fields:customers': { args: undefined; result: CustomerOption[] }
  'settings:getToggles': { args: undefined; result: Toggles }
  'settings:setToggles': { args: Toggles; result: Toggles }
  'settings:getDisplay': { args: undefined; result: Display }
  'settings:setDisplay': { args: Display; result: Display }
  'settings:getTreeLevel': { args: undefined; result: TreeLevel }
  'settings:setTreeLevel': { args: TreeLevel; result: TreeLevel }
  'views:list': { args: undefined; result: SavedView[] }
  'views:create': { args: CreateViewArgs; result: SavedView }
  'views:rename': { args: RenameViewArgs; result: SavedView }
  'views:delete': { args: DeleteViewArgs; result: null }
  /** The Inbox: issues the user is assigned to, reported or watches that changed in 14 days, with their read state. */
  'inbox:list': { args: undefined; result: InboxEntry[] }
  /** Marks one issue read up to the `updated` time the user saw. */
  'inbox:markRead': { args: MarkInboxReadArgs; result: null }
  /** Marks every issue read up to `through`. */
  'inbox:markAllRead': { args: MarkInboxAllReadArgs; result: null }

  'views:update': { args: UpdateViewArgs; result: SavedView }
  'views:duplicate': { args: DuplicateViewArgs; result: SavedView }
  /** The whole list in its new order. */
  'views:move': { args: MoveViewArgs; result: SavedView[] }
  /** The shared timer file, which `jm timer` also writes. */
  'timer:get': { args: undefined; result: TimerSnapshot }
  /** Starts a timer on a Task, Bug, Story or Subtask. Another running timer is refused: switch instead. */
  'timer:start': { args: StartTimerArgs; result: TimerOutcome }
  /** Logs the running timer as a worklog, or drops it with `discard`. */
  'timer:stop': { args: StopTimerArgs; result: TimerOutcome }
  /** Logs or drops the running timer, then starts one on `key`. */
  'timer:switch': { args: SwitchTimerArgs; result: TimerOutcome }
}

export type Channel = keyof IpcContract
export type ArgsOf<C extends Channel> = IpcContract[C]['args']
export type ResultOf<C extends Channel> = IpcContract[C]['result']

const CHANNEL_TABLE: Record<Channel, true> = {
  'session:get': true,
  'session:login': true,
  'session:logout': true,
  'issues:list': true,
  'issues:searchText': true,
  'issues:setSummary': true,
  'issues:get': true,
  'issues:edit': true,
  'issues:batch': true,
  'issues:setDescription': true,
  'attachments:addImage': true,
  'attachments:image': true,
  'comments:list': true,
  'comments:add': true,
  'comments:edit': true,
  'comments:delete': true,
  'worklogs:list': true,
  'timetracking:get': true,
  'worklogs:add': true,
  'worklogs:edit': true,
  'worklogs:delete': true,
  'links:list': true,
  'links:add': true,
  'links:remove': true,
  'attachments:list': true,
  'attachments:add': true,
  'attachments:download': true,
  'issues:transitions': true,
  'issues:setStatus': true,
  'issues:setSprint': true,
  'issues:create': true,
  'issues:delete': true,
  'sprints:list': true,
  'sprints:get': true,
  'users:search': true,
  'fields:options': true,
  'user:me': true,
  'avatars:get': true,
  'fields:customers': true,
  'settings:getToggles': true,
  'settings:setToggles': true,
  'settings:getDisplay': true,
  'settings:setDisplay': true,
  'settings:getTreeLevel': true,
  'settings:setTreeLevel': true,
  'views:list': true,
  'views:create': true,
  'views:rename': true,
  'views:delete': true,
  'inbox:list': true,
  'inbox:markRead': true,
  'inbox:markAllRead': true,
  'views:update': true,
  'views:duplicate': true,
  'views:move': true,
  'timer:get': true,
  'timer:start': true,
  'timer:stop': true,
  'timer:switch': true,
}

/** Every channel, for code that builds one function per channel. The table fails to compile when one is missing. */
export const CHANNELS = Object.keys(CHANNEL_TABLE) as Channel[]

/** Main to renderer: true when the window gains focus, false when it loses it. */
export const WINDOW_FOCUS_EVENT = 'window:focus'

/** Main to renderer: an `IssuesProgress` for each page a load fetches. */
export const ISSUES_PROGRESS_EVENT = 'issues:progress'

/** Main to renderer: a `BatchProgress` as each issue of a running batch settles. */
export const BATCH_PROGRESS_EVENT = 'issues:batchProgress'

/** Main to renderer: a `LateRead` about 10 s after a create, once the PSAPAC automation has run. */
export const LATE_READ_EVENT = 'issues:lateRead'

/** A new issue read again after the automation had time to rewrite it. */
export interface LateRead {
  key: string
  issue: IssueDetail
}

/** The core error shape. Thrown `Error` objects lose their fields crossing IPC, so only these travel. */
export interface IpcError {
  code: ErrorCode
  message: string
  /** The message with the request it names, when `message` leaves that out. Shown behind Details. */
  detail?: string
  /** The HTTP status Jira answered with, when it answered. The window words 404 and 5xx differently. */
  status?: number
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

/** What the preload script exposes as `window.jm`. */
export type JmApi = {
  [C in Channel]: (args: ArgsOf<C>) => Promise<IpcResult<ResultOf<C>>>
} & {
  /** Subscribes to window focus changes. Returns the unsubscribe function. */
  onWindowFocus(listener: (focused: boolean) => void): () => void
  /** Subscribes to the progress of issue loads. Returns the unsubscribe function. */
  onIssuesProgress(listener: (progress: IssuesProgress) => void): () => void
  /** Subscribes to the progress of batches. Returns the unsubscribe function. */
  onBatchProgress(listener: (progress: BatchProgress) => void): () => void
  /** Subscribes to the second read of each created issue. Returns the unsubscribe function. */
  onLateRead(listener: (read: LateRead) => void): () => void
}
