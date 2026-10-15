import { JiraMgrError, type ErrorCode } from '@jira-mgr/core'
import { adfDocSchema, type AdfDoc } from '@jira-mgr/core/adf'
import {
  ISSUE_ORDERS,
  MANUAL_ORDER_LIMIT,
  ORDER_DIRECTIONS,
  ROW_PROPERTIES,
  TREE_LEVELS,
} from '@jira-mgr/core/display'
import { DURATION_PATTERN, SWAPPABLE_TYPES } from '@jira-mgr/core/issue'
import { TEXT_QUERY_MAX } from '@jira-mgr/core/search'
import { DATE_WINDOWS, FILTER_LIST_FIELDS, type FilterListField } from '@jira-mgr/core/view-filter'
import { z } from 'zod'

import {
  ATTACHMENT_LIMIT_BYTES,
  BATCH_MAX,
  CREATE_TYPES,
  IMAGE_LIMIT_BYTES,
  IMAGE_TYPES,
} from '../shared/ipc'
import type {
  AddAttachmentArgs,
  AddCommentArgs,
  AddImageArgs,
  AddLinkArgs,
  AddWorklogArgs,
  ArgsOf,
  AvatarArgs,
  BatchArgs,
  Channel,
  CommentIdArgs,
  CreateIssueArgs,
  CreateViewArgs,
  DeleteIssueArgs,
  DeleteViewArgs,
  Display,
  DownloadAttachmentArgs,
  DuplicateViewArgs,
  EditCommentArgs,
  EditIssueArgs,
  EditWorklogArgs,
  FieldOptionsArgs,
  IpcError,
  ImageArgs,
  IpcResult,
  IssueChanges,
  KeyArgs,
  ListIssuesArgs,
  LoginArgs,
  MarkInboxAllReadArgs,
  MarkInboxReadArgs,
  MoveViewArgs,
  RemoveLinkArgs,
  RenameViewArgs,
  ResultOf,
  SearchTextArgs,
  SetDescriptionArgs,
  SetSprintArgs,
  SetStatusArgs,
  SetSummaryArgs,
  StartTimerArgs,
  StopTimerArgs,
  SwitchTimerArgs,
  Toggles,
  UpdateViewArgs,
  WorklogIdArgs,
} from '../shared/ipc'
import type { Backend, ProgressSender } from './backend'
import { desktopError } from './messages'

const MAX_TOKEN_BYTES = 1024
const MAX_EMAIL_BYTES = 254
/** Jira's limit on a summary. */
const MAX_SUMMARY = 255
/** Caps on a saved view, far above any real one. Core owns the name rules (trimmed, unique). */
/** The most JSON a description may be. Jira refuses far less than this, so it only bounds the work. */
const MAX_ADF_BYTES = 1_000_000
const MAX_VIEW_NAME = 80
const MAX_ISSUE_KEY = 64
const MAX_FILTER_VALUES = 200
const MAX_FILTER_VALUE = 500

const text = (max: number) => z.string().min(1).max(max)

/**
 * Shape checks only, with length caps. Core owns the deeper rules (site URL, email, token
 * storage) and throws `validation_failed` for them. The `z.ZodType<...>` annotations tie each
 * schema to the contract, so a payload type cannot drift from what main accepts.
 */
const loginArgs: z.ZodType<LoginArgs> = z.strictObject({
  siteUrl: text(2048),
  projectKey: text(64),
  email: text(MAX_EMAIL_BYTES),
  token: text(MAX_TOKEN_BYTES),
})

const issueKey = z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/, 'must be an issue key such as PSAPAC-12')

const setSummaryArgs: z.ZodType<SetSummaryArgs> = z.strictObject({
  key: issueKey,
  summary: z.string().trim().min(1).max(MAX_SUMMARY),
})

const keyArgs: z.ZodType<KeyArgs> = z.strictObject({ key: issueKey })

/**
 * An ADF document under 1 MB. A document nested past the stack makes the parser throw instead of
 * fail, so it is caught here and refused like any other invalid value.
 */
const adfArg = z.unknown().transform((value, ctx): AdfDoc | null => {
  if (value === null) return null
  try {
    if (JSON.stringify(value).length <= MAX_ADF_BYTES) return adfDocSchema.parse(value)
  } catch {
    // Not ADF, or nested too deeply for the parser: refused below.
  }
  ctx.addIssue({ code: 'custom', message: 'must be an ADF document of at most 1 MB' })
  return z.NEVER
})

const setDescriptionArgs: z.ZodType<SetDescriptionArgs> = z.strictObject({
  key: issueKey,
  description: adfArg,
  base: adfArg,
})

const addImageArgs: z.ZodType<AddImageArgs> = z.strictObject({
  key: issueKey,
  filename: text(255),
  mimeType: z.enum(IMAGE_TYPES),
  bytes: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.length > 0 && bytes.length <= IMAGE_LIMIT_BYTES, {
      message: 'must hold 1 byte to 100 MB',
    }),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

const imageArgs: z.ZodType<ImageArgs> = z.strictObject({
  key: issueKey,
  mediaId: z.uuid(),
})

/** A comment or worklog comment is an ADF document, never empty text. */
const adfBody = adfArg.transform((doc, ctx): AdfDoc => {
  if (doc !== null) return doc
  ctx.addIssue({ code: 'custom', message: 'must be an ADF document' })
  return z.NEVER
})

/** The id of a comment, worklog, link or attachment: digits, so it cannot alter a path. */
const jiraId = z.string().regex(/^[1-9]\d{0,18}$/, 'must be a Jira id such as 10042')

const addCommentArgs: z.ZodType<AddCommentArgs> = z.strictObject({ key: issueKey, body: adfBody })

const editCommentArgs: z.ZodType<EditCommentArgs> = z.strictObject({
  key: issueKey,
  commentId: jiraId,
  body: adfBody,
})

const commentIdArgs: z.ZodType<CommentIdArgs> = z.strictObject({
  key: issueKey,
  commentId: jiraId,
})

const timeSpent = z.string().max(64).regex(DURATION_PATTERN, 'must be a duration such as 1h 30m')
const started = z.iso.datetime({ offset: true })

const addWorklogArgs: z.ZodType<AddWorklogArgs> = z.strictObject({
  key: issueKey,
  timeSpent,
  started: started.optional(),
  comment: adfBody.optional(),
})

const editWorklogArgs: z.ZodType<EditWorklogArgs> = z.strictObject({
  key: issueKey,
  worklogId: jiraId,
  timeSpent: timeSpent.optional(),
  started: started.optional(),
  comment: adfBody.optional(),
})

const worklogIdArgs: z.ZodType<WorklogIdArgs> = z.strictObject({
  key: issueKey,
  worklogId: jiraId,
})

const addLinkArgs: z.ZodType<AddLinkArgs> = z.strictObject({
  key: issueKey,
  typeId: jiraId,
  direction: z.enum(['outward', 'inward']),
  otherKey: issueKey,
})

const removeLinkArgs: z.ZodType<RemoveLinkArgs> = z.strictObject({
  key: issueKey,
  linkId: jiraId,
})

const addAttachmentArgs: z.ZodType<AddAttachmentArgs> = z.strictObject({
  key: issueKey,
  filename: text(255),
  mimeType: z.string().max(255),
  bytes: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.length > 0 && bytes.length <= ATTACHMENT_LIMIT_BYTES, {
      message: 'must hold 1 byte to 100 MB',
    }),
})

const downloadAttachmentArgs: z.ZodType<DownloadAttachmentArgs> = z.strictObject({
  key: issueKey,
  attachmentId: jiraId,
})

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
const label = z.string().regex(/^\S+$/, 'must hold no spaces').max(255)
const labelList = z.array(label).max(50)

/** Every field `issues:edit` can change. Core checks the values; this checks shape and size. */
const issueChanges: z.ZodType<IssueChanges> = z
  .strictObject({
    assignee: text(128).nullable(),
    priorityId: text(64),
    startDate: date.nullable(),
    dueDate: date.nullable(),
    addLabels: labelList,
    removeLabels: labelList,
    parentKey: issueKey,
    customerId: text(64),
    engagementId: text(64),
    originalEstimate: text(64),
    timeRemainingHours: z.number().nonnegative().max(100_000).nullable(),
    type: z.enum(SWAPPABLE_TYPES),
  })
  .partial()

const editIssueArgs: z.ZodType<EditIssueArgs> = z.strictObject({
  key: issueKey,
  changes: issueChanges,
})

const batchArgs: z.ZodType<BatchArgs> = z.strictObject({
  batchId: z.number().int().nonnegative(),
  items: z
    .array(
      z.strictObject({
        key: issueKey,
        id: jiraId,
        change: z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('edit'), changes: issueChanges }),
          z.strictObject({ kind: z.literal('status'), statusId: text(64) }),
          z.strictObject({
            kind: z.literal('sprint'),
            sprintId: z.number().int().positive().nullable(),
          }),
        ]),
      }),
    )
    .max(BATCH_MAX),
})

const setStatusArgs: z.ZodType<SetStatusArgs> = z.strictObject({
  key: issueKey,
  statusId: text(64),
})

const setSprintArgs: z.ZodType<SetSprintArgs> = z.strictObject({
  key: issueKey,
  sprintId: z.number().int().positive().nullable(),
})

/** A new issue. Core checks the values and the Subtask rule; this checks shape and size. */
const createIssueArgs: z.ZodType<CreateIssueArgs> = z.strictObject({
  type: z.enum(CREATE_TYPES),
  summary: z.string().trim().min(1).max(MAX_SUMMARY),
  customerId: text(64),
  engagementId: text(64),
  parentKey: issueKey.optional(),
  assignee: text(128).optional(),
  description: adfBody.optional(),
  priorityId: text(64).optional(),
  labels: labelList.optional(),
  originalEstimate: text(64).optional(),
  startDate: date.optional(),
  dueDate: date.optional(),
  sprintId: z.number().int().positive().optional(),
})

const deleteIssueArgs: z.ZodType<DeleteIssueArgs> = z.strictObject({
  key: issueKey,
  deleteSubtasks: z.boolean(),
  subtasks: z.array(issueKey).max(MAX_FILTER_VALUES),
})

const sprintListArgs = z.strictObject({ all: z.boolean() })

const sprintGetArgs = z.strictObject({ id: z.number().int().positive() })

const userSearchArgs = z.strictObject({ query: z.string().max(200) })

const fieldOptionsArgs: z.ZodType<FieldOptionsArgs> = z.strictObject({
  field: z.enum(['customer', 'engagement', 'priority', 'issueType']),
})

const avatarArgs: z.ZodType<AvatarArgs> = z.strictObject({
  url: z
    .string()
    .max(2048)
    .refine(
      (url) => URL.canParse(url) && new URL(url).protocol === 'https:',
      'must be an https URL',
    ),
})

const listIssuesArgs: z.ZodType<ListIssuesArgs> = z.strictObject({
  phase: z.enum(['unresolved', 'done']),
  loadId: z.number().int().nonnegative(),
})

/** Shape and size only. Core trims the text and refuses it when blank. */
const searchTextArgs: z.ZodType<SearchTextArgs> = z.strictObject({
  query: z.string().max(TEXT_QUERY_MAX),
})

const instant = z.iso.datetime({ offset: true })

const markInboxReadArgs: z.ZodType<MarkInboxReadArgs> = z.strictObject({
  key: issueKey,
  updated: instant,
})

const markInboxAllReadArgs: z.ZodType<MarkInboxAllReadArgs> = z.strictObject({ through: instant })

const togglesArgs: z.ZodType<Toggles> = z.strictObject({
  hideDone: z.boolean(),
  assigneeMe: z.boolean(),
  hideEmptyCustomers: z.boolean(),
})

const displayArgs: z.ZodType<Display> = z.strictObject({
  properties: z.array(z.enum(ROW_PROPERTIES)).max(ROW_PROPERTIES.length),
  order: z.enum(ISSUE_ORDERS),
  direction: z.enum(ORDER_DIRECTIONS),
  manual: z.array(z.string().min(1).max(MAX_ISSUE_KEY)).max(MANUAL_ORDER_LIMIT).optional(),
})

const filterValues = z.array(z.string().max(MAX_FILTER_VALUE)).max(MAX_FILTER_VALUES).optional()

const filterLists = Object.fromEntries(
  FILTER_LIST_FIELDS.map((field) => [field, filterValues]),
) as Record<FilterListField, typeof filterValues>

const datePreset = z.enum(DATE_WINDOWS)

const viewFilters = z.strictObject({
  ...filterLists,
  dates: z
    .strictObject({
      due: z.enum(['overdue', ...DATE_WINDOWS]).optional(),
      created: datePreset.optional(),
      updated: datePreset.optional(),
    })
    .optional(),
  not: z.strictObject(filterLists).optional(),
  text: z.string().max(MAX_FILTER_VALUE).optional(),
})

const viewName = z.string().max(MAX_VIEW_NAME)
const viewId = z
  .string()
  .min(1)
  .max(MAX_VIEW_NAME * 2)

const createViewArgs: z.ZodType<CreateViewArgs> = z.strictObject({
  name: viewName,
  filters: viewFilters,
  toggles: togglesArgs,
  display: displayArgs.optional(),
})

const renameViewArgs: z.ZodType<RenameViewArgs> = z.strictObject({ id: viewId, name: viewName })

const deleteViewArgs: z.ZodType<DeleteViewArgs> = z.strictObject({ id: viewId })

const updateViewArgs: z.ZodType<UpdateViewArgs> = z.strictObject({
  id: viewId,
  filters: viewFilters,
  toggles: togglesArgs,
  display: displayArgs.optional(),
})

const duplicateViewArgs: z.ZodType<DuplicateViewArgs> = z.strictObject({ id: viewId })

const moveViewArgs: z.ZodType<MoveViewArgs> = z.strictObject({
  id: viewId,
  toIndex: z.number().int().nonnegative(),
})

const startTimerArgs: z.ZodType<StartTimerArgs> = z.strictObject({ key: issueKey })

const stopTimerArgs: z.ZodType<StopTimerArgs> = z.strictObject({
  expectRunning: issueKey,
  timeSpent: timeSpent.optional(),
  comment: adfBody.optional(),
  confirm: z.boolean().optional(),
  discard: z.boolean().optional(),
})

const switchTimerArgs: z.ZodType<SwitchTimerArgs> = z.strictObject({
  key: issueKey,
  expectRunning: issueKey,
  timeSpent: timeSpent.optional(),
  comment: adfBody.optional(),
  confirm: z.boolean().optional(),
  discard: z.boolean().optional(),
})

export const argSchemas: { [C in Channel]: z.ZodType<ArgsOf<C>> } = {
  'session:get': z.undefined(),
  'session:login': loginArgs,
  'session:logout': z.undefined(),
  'issues:list': listIssuesArgs,
  'issues:searchText': searchTextArgs,
  'issues:setSummary': setSummaryArgs,
  'issues:get': keyArgs,
  'issues:edit': editIssueArgs,
  'issues:batch': batchArgs,
  'issues:setDescription': setDescriptionArgs,
  'attachments:addImage': addImageArgs,
  'attachments:image': imageArgs,
  'comments:list': keyArgs,
  'comments:add': addCommentArgs,
  'comments:edit': editCommentArgs,
  'comments:delete': commentIdArgs,
  'worklogs:list': keyArgs,
  'timetracking:get': z.undefined(),
  'worklogs:add': addWorklogArgs,
  'worklogs:edit': editWorklogArgs,
  'worklogs:delete': worklogIdArgs,
  'links:list': keyArgs,
  'links:add': addLinkArgs,
  'links:remove': removeLinkArgs,
  'attachments:list': keyArgs,
  'attachments:add': addAttachmentArgs,
  'attachments:download': downloadAttachmentArgs,
  'issues:transitions': keyArgs,
  'issues:setStatus': setStatusArgs,
  'issues:setSprint': setSprintArgs,
  'issues:create': createIssueArgs,
  'issues:delete': deleteIssueArgs,
  'sprints:list': sprintListArgs,
  'sprints:get': sprintGetArgs,
  'users:search': userSearchArgs,
  'fields:options': fieldOptionsArgs,
  'user:me': z.undefined(),
  'avatars:get': avatarArgs,
  'fields:customers': z.undefined(),
  'settings:getToggles': z.undefined(),
  'settings:setToggles': togglesArgs,
  'settings:getDisplay': z.undefined(),
  'settings:setDisplay': displayArgs,
  'settings:getTreeLevel': z.undefined(),
  'settings:setTreeLevel': z.enum(TREE_LEVELS),
  'views:list': z.undefined(),
  'views:create': createViewArgs,
  'views:rename': renameViewArgs,
  'views:delete': deleteViewArgs,
  'inbox:list': z.undefined(),
  'inbox:markRead': markInboxReadArgs,
  'inbox:markAllRead': markInboxAllReadArgs,
  'views:update': updateViewArgs,
  'views:duplicate': duplicateViewArgs,
  'views:move': moveViewArgs,
  'timer:get': z.undefined(),
  'timer:start': startTimerArgs,
  'timer:stop': stopTimerArgs,
  'timer:switch': switchTimerArgs,
}

export type Handlers = {
  [C in Channel]: (raw: unknown, progress: ProgressSender) => Promise<IpcResult<ResultOf<C>>>
}

const INTERNAL_MESSAGE =
  'The app hit an unexpected error. Try again, and restart it if it persists.'

/** Core errors keep their code and message, less the request they name (the full text is `detail`). Anything else becomes `internal` with a fixed message. */
export function toIpcError(error: unknown): IpcError {
  if (error instanceof JiraMgrError) {
    const { details } = error
    const status =
      typeof details === 'object' && details !== null && 'status' in details ? details.status : null
    return {
      code: error.code,
      ...desktopError(error.message),
      ...(typeof status === 'number' ? { status } : {}),
    }
  }
  return { code: 'internal' satisfies ErrorCode, message: INTERNAL_MESSAGE }
}

/**
 * The `at ...` lines of an error's stack, without its header. The header holds the message,
 * which may span lines, start a line with `at` and carry issue text or a token, so the header is
 * cut off first and only lines that start like a frame stay.
 */
export function stackFrames(error: unknown): string {
  if (!(error instanceof Error) || error.stack === undefined) return ''
  const header = `${error.name}: ${error.message}`
  const body = error.stack.startsWith(header) ? error.stack.slice(header.length) : error.stack
  return body
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n')
}

/**
 * One handler per channel. Each validates its argument, calls the backend and returns a result
 * that is `ok` or carries the core error shape. A handler never throws and never echoes the input.
 */
export function createHandlers(
  backend: Backend,
  log: (line: string) => void = (line) => {
    console.error(line)
  },
): Handlers {
  function handle<C extends Channel>(
    channel: C,
    run: (args: ArgsOf<C>, progress: ProgressSender) => Promise<ResultOf<C>>,
  ): (raw: unknown, progress: ProgressSender) => Promise<IpcResult<ResultOf<C>>> {
    return async (raw, progress) => {
      const parsed = argSchemas[channel].safeParse(raw)
      if (!parsed.success) {
        // Issue messages name the field and the rule, never the value, so a token cannot leak.
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.') || 'argument'}: ${i.message}`)
          .join('; ')
        return {
          ok: false,
          error: {
            code: 'validation_failed',
            message: `Invalid request to ${channel} (${issues}).`,
          },
        }
      }
      try {
        return { ok: true, data: await run(parsed.data, progress) }
      } catch (error) {
        const mapped = toIpcError(error)
        // Names the channel and code only: messages may carry issue text.
        log(`jm ipc ${channel} failed: ${mapped.code}`)
        if (process.env.JM_DEBUG === '1') {
          const frames = stackFrames(error)
          if (frames !== '') log(frames)
        }
        return { ok: false, error: mapped }
      }
    }
  }

  return {
    'session:get': handle('session:get', () => backend.getSession()),
    'session:login': handle('session:login', (args) => backend.login(args)),
    'session:logout': handle('session:logout', () => backend.logout()),
    'issues:list': handle('issues:list', (args, progress) => backend.listIssues(args, progress)),
    'issues:searchText': handle('issues:searchText', (args) => backend.searchText(args)),
    'issues:setSummary': handle('issues:setSummary', async (args) => {
      await backend.setSummary(args)
      return null
    }),
    'issues:get': handle('issues:get', (args) => backend.getIssue(args)),
    'issues:edit': handle('issues:edit', async (args) => {
      await backend.editIssue(args)
      return null
    }),
    'issues:batch': handle('issues:batch', (args, progress) => backend.batch(args, progress)),
    'issues:setDescription': handle('issues:setDescription', (args) =>
      backend.setDescription(args),
    ),
    'attachments:addImage': handle('attachments:addImage', (args) => backend.addImage(args)),
    'attachments:image': handle('attachments:image', (args) => backend.image(args)),
    'comments:list': handle('comments:list', (args) => backend.listComments(args)),
    'comments:add': handle('comments:add', (args) => backend.addComment(args)),
    'comments:edit': handle('comments:edit', (args) => backend.editComment(args)),
    'comments:delete': handle('comments:delete', async (args) => {
      await backend.deleteComment(args)
      return null
    }),
    'worklogs:list': handle('worklogs:list', (args) => backend.listWorklogs(args)),
    'timetracking:get': handle('timetracking:get', () => backend.getTimeTracking()),
    'worklogs:add': handle('worklogs:add', (args) => backend.addWorklog(args)),
    'worklogs:edit': handle('worklogs:edit', (args) => backend.editWorklog(args)),
    'worklogs:delete': handle('worklogs:delete', async (args) => {
      await backend.deleteWorklog(args)
      return null
    }),
    'links:list': handle('links:list', (args) => backend.listLinks(args)),
    'links:add': handle('links:add', async (args) => {
      await backend.addLink(args)
      return null
    }),
    'links:remove': handle('links:remove', async (args) => {
      await backend.removeLink(args)
      return null
    }),
    'attachments:list': handle('attachments:list', (args) => backend.listAttachments(args)),
    'attachments:add': handle('attachments:add', (args) => backend.addAttachmentFile(args)),
    'attachments:download': handle('attachments:download', (args) =>
      backend.downloadAttachment(args),
    ),
    'issues:transitions': handle('issues:transitions', (args) => backend.listTransitions(args)),
    'issues:setStatus': handle('issues:setStatus', async (args) => {
      await backend.setStatus(args)
      return null
    }),
    'issues:setSprint': handle('issues:setSprint', async (args) => {
      await backend.setSprint(args)
      return null
    }),
    'issues:create': handle('issues:create', (args, progress) =>
      backend.createIssue(args, progress),
    ),
    'issues:delete': handle('issues:delete', (args) => backend.deleteIssue(args)),
    'sprints:list': handle('sprints:list', (args) => backend.listSprints(args)),
    'sprints:get': handle('sprints:get', (args) => backend.getSprint(args)),
    'users:search': handle('users:search', (args) => backend.searchUsers(args)),
    'fields:options': handle('fields:options', (args) => backend.listFieldOptions(args)),
    'user:me': handle('user:me', () => backend.getMe()),
    'avatars:get': handle('avatars:get', (args) => backend.getAvatar(args)),
    'fields:customers': handle('fields:customers', () => backend.listCustomers()),
    'settings:getToggles': handle('settings:getToggles', () => backend.getToggles()),
    'settings:setToggles': handle('settings:setToggles', (args) => backend.setToggles(args)),
    'settings:getDisplay': handle('settings:getDisplay', () => backend.getDisplay()),
    'settings:setDisplay': handle('settings:setDisplay', (args) => backend.setDisplay(args)),
    'settings:getTreeLevel': handle('settings:getTreeLevel', () => backend.getTreeLevel()),
    'settings:setTreeLevel': handle('settings:setTreeLevel', (args) => backend.setTreeLevel(args)),
    'views:list': handle('views:list', () => backend.listViews()),
    'views:create': handle('views:create', (args) => backend.createView(args)),
    'views:rename': handle('views:rename', (args) => backend.renameView(args)),
    'views:delete': handle('views:delete', async (args) => {
      await backend.deleteView(args)
      return null
    }),
    'inbox:list': handle('inbox:list', () => backend.listInbox()),
    'inbox:markRead': handle('inbox:markRead', async (args) => {
      await backend.markInboxRead(args)
      return null
    }),
    'inbox:markAllRead': handle('inbox:markAllRead', async (args) => {
      await backend.markInboxAllRead(args)
      return null
    }),
    'views:update': handle('views:update', (args) => backend.updateView(args)),
    'views:duplicate': handle('views:duplicate', (args) => backend.duplicateView(args)),
    'views:move': handle('views:move', (args) => backend.moveView(args)),
    'timer:get': handle('timer:get', () => backend.getTimer()),
    'timer:start': handle('timer:start', (args) => backend.startTimer(args)),
    'timer:stop': handle('timer:stop', (args) => backend.stopTimer(args)),
    'timer:switch': handle('timer:switch', (args) => backend.switchTimer(args)),
  }
}
