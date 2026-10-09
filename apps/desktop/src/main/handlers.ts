import { JiraMgrError, type ErrorCode } from '@jira-mgr/core'
import { SWAPPABLE_TYPES } from '@jira-mgr/core/issue'
import { z } from 'zod'

import type {
  ArgsOf,
  Channel,
  CreateViewArgs,
  DeleteViewArgs,
  EditIssueArgs,
  FieldOptionsArgs,
  IpcError,
  IpcResult,
  IssueChanges,
  KeyArgs,
  ListIssuesArgs,
  LoginArgs,
  RenameViewArgs,
  ResultOf,
  SetSprintArgs,
  SetStatusArgs,
  SetSummaryArgs,
  Toggles,
} from '../shared/ipc'
import type { Backend, ProgressSender } from './backend'
import { desktopMessage } from './messages'

const MAX_TOKEN_BYTES = 1024
const MAX_EMAIL_BYTES = 254
/** Jira's limit on a summary. */
const MAX_SUMMARY = 255
/** Caps on a saved view, far above any real one. Core owns the name rules (trimmed, unique). */
const MAX_VIEW_NAME = 80
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

const setStatusArgs: z.ZodType<SetStatusArgs> = z.strictObject({
  key: issueKey,
  statusId: text(64),
})

const setSprintArgs: z.ZodType<SetSprintArgs> = z.strictObject({
  key: issueKey,
  sprintId: z.number().int().positive().nullable(),
})

const sprintListArgs = z.strictObject({ all: z.boolean() })

const userSearchArgs = z.strictObject({ query: z.string().max(200) })

const fieldOptionsArgs: z.ZodType<FieldOptionsArgs> = z.strictObject({
  field: z.enum(['customer', 'engagement', 'priority', 'issueType']),
})

const listIssuesArgs: z.ZodType<ListIssuesArgs> = z.strictObject({
  phase: z.enum(['unresolved', 'done']),
  loadId: z.number().int().nonnegative(),
})

const togglesArgs: z.ZodType<Toggles> = z.strictObject({
  hideDone: z.boolean(),
  assigneeMe: z.boolean(),
  hideEmptyCustomers: z.boolean(),
})

const filterValues = z.array(z.string().max(MAX_FILTER_VALUE)).max(MAX_FILTER_VALUES).optional()

const viewFilters = z.strictObject({
  assignee: filterValues,
  status: filterValues,
  label: filterValues,
  type: filterValues,
  sprint: filterValues,
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
})

const renameViewArgs: z.ZodType<RenameViewArgs> = z.strictObject({ id: viewId, name: viewName })

const deleteViewArgs: z.ZodType<DeleteViewArgs> = z.strictObject({ id: viewId })

export const argSchemas: { [C in Channel]: z.ZodType<ArgsOf<C>> } = {
  'session:get': z.undefined(),
  'session:login': loginArgs,
  'session:logout': z.undefined(),
  'issues:list': listIssuesArgs,
  'issues:setSummary': setSummaryArgs,
  'issues:get': keyArgs,
  'issues:edit': editIssueArgs,
  'issues:transitions': keyArgs,
  'issues:setStatus': setStatusArgs,
  'issues:setSprint': setSprintArgs,
  'sprints:list': sprintListArgs,
  'users:search': userSearchArgs,
  'fields:options': fieldOptionsArgs,
  'user:me': z.undefined(),
  'fields:customers': z.undefined(),
  'settings:getToggles': z.undefined(),
  'settings:setToggles': togglesArgs,
  'views:list': z.undefined(),
  'views:create': createViewArgs,
  'views:rename': renameViewArgs,
  'views:delete': deleteViewArgs,
}

export type Handlers = {
  [C in Channel]: (raw: unknown, progress: ProgressSender) => Promise<IpcResult<ResultOf<C>>>
}

const INTERNAL_MESSAGE =
  'The app hit an unexpected error. Try again, and restart it if it persists.'

/** Core errors keep their code and message. Anything else becomes `internal` with a fixed message. */
export function toIpcError(error: unknown): IpcError {
  if (error instanceof JiraMgrError) {
    return { code: error.code, message: desktopMessage(error.message) }
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
    'issues:setSummary': handle('issues:setSummary', async (args) => {
      await backend.setSummary(args)
      return null
    }),
    'issues:get': handle('issues:get', (args) => backend.getIssue(args)),
    'issues:edit': handle('issues:edit', async (args) => {
      await backend.editIssue(args)
      return null
    }),
    'issues:transitions': handle('issues:transitions', (args) => backend.listTransitions(args)),
    'issues:setStatus': handle('issues:setStatus', async (args) => {
      await backend.setStatus(args)
      return null
    }),
    'issues:setSprint': handle('issues:setSprint', async (args) => {
      await backend.setSprint(args)
      return null
    }),
    'sprints:list': handle('sprints:list', (args) => backend.listSprints(args)),
    'users:search': handle('users:search', (args) => backend.searchUsers(args)),
    'fields:options': handle('fields:options', (args) => backend.listFieldOptions(args)),
    'user:me': handle('user:me', () => backend.getMe()),
    'fields:customers': handle('fields:customers', () => backend.listCustomers()),
    'settings:getToggles': handle('settings:getToggles', () => backend.getToggles()),
    'settings:setToggles': handle('settings:setToggles', (args) => backend.setToggles(args)),
    'views:list': handle('views:list', () => backend.listViews()),
    'views:create': handle('views:create', (args) => backend.createView(args)),
    'views:rename': handle('views:rename', (args) => backend.renameView(args)),
    'views:delete': handle('views:delete', async (args) => {
      await backend.deleteView(args)
      return null
    }),
  }
}
