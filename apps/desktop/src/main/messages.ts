/**
 * Core words its errors for the CLI: "Run `jm auth login`", "jm manages the PSAPAC project only".
 * The app has no `jm` to run, so main rewrites those sentences before they cross IPC. The code
 * and every other word stay as core wrote them, and the CLI never passes through here.
 */
const REWRITES: readonly [RegExp, string][] = [
  [/Run `jm auth login` to sign in again\./g, 'Log in again to continue.'],
  [/Run `jm auth login` again\./g, 'Log in again.'],
  [/Run `jm auth login`\./g, 'Log in again.'],
  [/\bjm manages the (\S+) project only\./g, 'This app manages the $1 project only.'],
  [/ read it with `jm issue get (\S+)`\./g, ' open $1 to read it.'],
  [
    /, or delete the file if no jm or app process is running\./g,
    ', or delete the file if no other process is using it.',
  ],
]

/** A request as core words it: "GET /rest/api/3/issue/PSAPAC-2", with the "to" of "answered 500 to" before it. */
const REQUEST = /(?:(?: to)? )?(?:GET|POST|PUT|DELETE|PATCH|HEAD) \/\S*?(?=[:.]?(?:\s|$))/g

/** Core's wording with the CLI's `jm` sentences put in the app's words. */
const rewritten = (message: string): string =>
  REWRITES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), message)

/**
 * Drops the request core's message names: "Jira answered 500 to GET /rest/api/3/issue/PSAPAC-2:
 * Boom." reads "Jira answered 500: Boom." A label that leads or follows another word becomes
 * "The request" or "the request".
 */
const withoutRequest = (message: string): string =>
  message.replace(REQUEST, (match, offset: number) =>
    match.startsWith(' to ') ? '' : offset === 0 ? 'The request' : ' the request',
  )

/** The message as the app shows it. A message without CLI wording or a request comes back unchanged. */
export function desktopMessage(message: string): string {
  return withoutRequest(rewritten(message))
}

/**
 * The message for the window, and the full one as `detail` when dropping the request changed it,
 * so a Details disclosure can still show where the failure happened.
 */
export function desktopError(message: string): { message: string; detail?: string } {
  const full = rewritten(message)
  const plain = withoutRequest(full)
  return plain === full ? { message: plain } : { message: plain, detail: full }
}
