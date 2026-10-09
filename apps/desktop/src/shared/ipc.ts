import type { ErrorCode, Issue } from '@jira-mgr/core'
import type { AdfDoc, AdfNode } from '@jira-mgr/core/adf'
import type { CustomerOption, HierarchyOptions } from '@jira-mgr/core/hierarchy'
import type { IssueDetail, SwappableType } from '@jira-mgr/core/issue'
import type { SavedView } from '@jira-mgr/core/state'
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

/** The three toggles `settings.json` remembers (Q28). */
export type Toggles = Pick<HierarchyOptions, 'hideDone' | 'assigneeMe' | 'hideEmptyCustomers'>

/** A saved view as `views.json` holds it, the file `jm view list` reads. */
export type { SavedView }

/** The view to add: a name, the filter bar's filters and the three toggles. Core makes the id. */
export interface CreateViewArgs {
  name: string
  filters: ViewFilters
  toggles: Toggles
}

export interface RenameViewArgs {
  id: string
  name: string
}

export interface DeleteViewArgs {
  id: string
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

export interface EditIssueArgs {
  key: string
  changes: IssueChanges
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
  'issues:setSummary': { args: SetSummaryArgs; result: null }
  /** One issue with its description and subtasks, read afresh. */
  'issues:get': { args: KeyArgs; result: IssueDetail }
  'issues:edit': { args: EditIssueArgs; result: null }
  /** Writes the description unless Jira's no longer matches `base`. */
  'issues:setDescription': { args: SetDescriptionArgs; result: SetDescriptionResult }
  /** Attaches a dropped image to the issue and returns the `mediaSingle` that embeds it. */
  'attachments:addImage': { args: AddImageArgs; result: { node: AdfNode } }
  /** The bytes of an image attachment, found by the media id a description embeds. */
  'attachments:image': { args: ImageArgs; result: ImageResult }
  'issues:transitions': { args: KeyArgs; result: StatusOption[] }
  'issues:setStatus': { args: SetStatusArgs; result: null }
  'issues:setSprint': { args: SetSprintArgs; result: null }
  'issues:create': { args: CreateIssueArgs; result: CreatedIssue }
  /** Permanent. Refuses to cascade to subtasks the user was not shown. */
  'issues:delete': { args: DeleteIssueArgs; result: DeletedIssue }
  /** Active and future sprints of the project's board, or every sprint with `all`. */
  'sprints:list': { args: { all: boolean }; result: SprintOption[] }
  /** Assignable users whose name or email matches `query`. */
  'users:search': { args: { query: string }; result: UserOption[] }
  'fields:options': { args: FieldOptionsArgs; result: FieldChoice[] }
  'user:me': { args: undefined; result: CurrentUser }
  /** A profile image by URL, fetched and checked by main. Fails with `not_found` when it will not load. */
  'avatars:get': { args: AvatarArgs; result: AvatarImage }
  'fields:customers': { args: undefined; result: CustomerOption[] }
  'settings:getToggles': { args: undefined; result: Toggles }
  'settings:setToggles': { args: Toggles; result: Toggles }
  'views:list': { args: undefined; result: SavedView[] }
  'views:create': { args: CreateViewArgs; result: SavedView }
  'views:rename': { args: RenameViewArgs; result: SavedView }
  'views:delete': { args: DeleteViewArgs; result: null }
}

export type Channel = keyof IpcContract
export type ArgsOf<C extends Channel> = IpcContract[C]['args']
export type ResultOf<C extends Channel> = IpcContract[C]['result']

const CHANNEL_TABLE: Record<Channel, true> = {
  'session:get': true,
  'session:login': true,
  'session:logout': true,
  'issues:list': true,
  'issues:setSummary': true,
  'issues:get': true,
  'issues:edit': true,
  'issues:setDescription': true,
  'attachments:addImage': true,
  'attachments:image': true,
  'issues:transitions': true,
  'issues:setStatus': true,
  'issues:setSprint': true,
  'issues:create': true,
  'issues:delete': true,
  'sprints:list': true,
  'users:search': true,
  'fields:options': true,
  'user:me': true,
  'avatars:get': true,
  'fields:customers': true,
  'settings:getToggles': true,
  'settings:setToggles': true,
  'views:list': true,
  'views:create': true,
  'views:rename': true,
  'views:delete': true,
}

/** Every channel, for code that builds one function per channel. The table fails to compile when one is missing. */
export const CHANNELS = Object.keys(CHANNEL_TABLE) as Channel[]

/** Main to renderer: true when the window gains focus, false when it loses it. */
export const WINDOW_FOCUS_EVENT = 'window:focus'

/** Main to renderer: an `IssuesProgress` for each page a load fetches. */
export const ISSUES_PROGRESS_EVENT = 'issues:progress'

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
  /** Subscribes to the second read of each created issue. Returns the unsubscribe function. */
  onLateRead(listener: (read: LateRead) => void): () => void
}
