/** Stable error codes. A new code is additive; renaming or removing one is a breaking change. */
export const ERROR_CODES = [
  'validation_failed',
  'not_found',
  'permission_denied',
  'jira_error',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** CLI exit code per error code, from docs/standards/errors-and-logging.md. */
export const EXIT_CODES: Record<ErrorCode, number> = {
  validation_failed: 2,
  not_found: 3,
  permission_denied: 4,
  jira_error: 5,
  // The standard gives `internal` no exit code. 1 is the conventional generic failure.
  internal: 1,
}

/** The typed error core throws. Clients branch on `code`, never on `message`. */
export class JiraMgrError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'JiraMgrError'
    this.code = code
    this.details = options.details
  }
}
