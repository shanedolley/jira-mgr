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

/** What each code means and what to do about it, for `jm help --json` and `docs/reference/errors.md`. */
export const ERROR_HELP: Record<ErrorCode, { meaning: string; fix: string }> = {
  validation_failed: {
    meaning:
      'A flag, argument or value is missing, unknown or invalid, or Jira rejected the input.',
    fix: 'Read the message, correct the command and run it again. `jm <command> --help` lists the flags.',
  },
  not_found: {
    meaning: 'The issue, comment, worklog, link, attachment, sprint, view or timer does not exist.',
    fix: 'Check the key or id. `jm <noun> list` shows what exists.',
  },
  permission_denied: {
    meaning: 'Jira refused the credentials, or no one is logged in.',
    fix: 'Run `jm auth login`, or ask a Jira admin for access to the project.',
  },
  jira_error: {
    meaning: 'Jira failed or sent a response the CLI cannot read, after the CLI retried.',
    fix: 'Try again later. A write may have gone through, so read the issue before repeating it.',
  },
  internal: {
    meaning: 'A bug in jm.',
    fix: 'Run again with `JM_DEBUG=1` for the stack and report it.',
  },
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
