import { JiraMgrError, type ErrorCode } from '@jira-mgr/core'
import { z } from 'zod'

import type {
  ArgsOf,
  Channel,
  IpcError,
  IpcResult,
  LoginArgs,
  ResultOf,
  SetSummaryArgs,
} from '../shared/ipc'
import type { Backend } from './backend'

const MAX_TOKEN_BYTES = 1024
const MAX_EMAIL_BYTES = 254
/** Jira's limit on a summary. */
const MAX_SUMMARY = 255

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

const setSummaryArgs: z.ZodType<SetSummaryArgs> = z.strictObject({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/, 'must be an issue key such as PSAPAC-12'),
  summary: z.string().trim().min(1).max(MAX_SUMMARY),
})

export const argSchemas: { [C in Channel]: z.ZodType<ArgsOf<C>> } = {
  'session:get': z.undefined(),
  'session:login': loginArgs,
  'session:logout': z.undefined(),
  'issues:list': z.undefined(),
  'issues:setSummary': setSummaryArgs,
}

export type Handlers = { [C in Channel]: (raw: unknown) => Promise<IpcResult<ResultOf<C>>> }

const INTERNAL_MESSAGE =
  'The app hit an unexpected error. Try again, and restart it if it persists.'

/** Core errors keep their code and message. Anything else becomes `internal` with a fixed message. */
export function toIpcError(error: unknown): IpcError {
  if (error instanceof JiraMgrError) return { code: error.code, message: error.message }
  return { code: 'internal' satisfies ErrorCode, message: INTERNAL_MESSAGE }
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
    run: (args: ArgsOf<C>) => Promise<ResultOf<C>>,
  ): (raw: unknown) => Promise<IpcResult<ResultOf<C>>> {
    return async (raw) => {
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
        return { ok: true, data: await run(parsed.data) }
      } catch (error) {
        const mapped = toIpcError(error)
        // Names the channel and code only: messages may carry issue text.
        log(`jm ipc ${channel} failed: ${mapped.code}`)
        if (process.env.JM_DEBUG === '1' && error instanceof Error)
          log(error.stack ?? error.message)
        return { ok: false, error: mapped }
      }
    }
  }

  return {
    'session:get': handle('session:get', () => backend.getSession()),
    'session:login': handle('session:login', (args) => backend.login(args)),
    'session:logout': handle('session:logout', () => backend.logout()),
    'issues:list': handle('issues:list', () => backend.listIssues()),
    'issues:setSummary': handle('issues:setSummary', async (args) => {
      await backend.setSummary(args)
      return null
    }),
  }
}
