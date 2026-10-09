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

/** The message as the app shows it. A message without CLI wording comes back unchanged. */
export function desktopMessage(message: string): string {
  return REWRITES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    message,
  )
}
