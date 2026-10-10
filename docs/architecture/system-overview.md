# System Overview

Two clients share one core. The CLI and the desktop app's main process both import `@jira-mgr/core`, and only core talks to Jira ([ADR-0001](../adr/0001-shared-core-monorepo.md)). [ARCHITECTURE.md](../../ARCHITECTURE.md) holds the directory map and the boundaries.

## Components

| Component | Runs in | Holds |
|---|---|---|
| `@jira-mgr/core` (`packages/core/src`) | Node, in either client's process | The Jira client (`http.ts`), domain rules, state files (`state.ts`), the Keychain wrapper (`auth.ts`), ADF conversion |
| `jm` (`apps/cli/src`) | A short-lived Node process per command | The command schema, handlers and output formatting |
| Desktop main (`apps/desktop/src/main`) | Electron main process | IPC handlers and `backend.ts`, the only desktop file that calls core |
| Desktop preload (`apps/desktop/src/preload/index.ts`) | The renderer's isolated bridge | `window.jm`, one function per IPC channel |
| Desktop renderer (`apps/desktop/src/renderer/src`) | A sandboxed Chromium page | React UI and the in-memory TanStack Query cache |
| State folder | Disk | `settings.json`, `fields.json`, `views.json`, `timer.json` |
| Keychain item | macOS Keychain | The API token |

## CLI Path

1. `apps/cli/src/index.ts` calls `run(argv, nodeIo())`.
2. `run.ts` calls `buildProgram` in `program.ts`, which builds a Commander program from the command schema (`schema.ts`). It parses `argv` and finds the handler in `commands/index.ts`.
3. The handler calls core. The context creates the HTTP client on first use, so `help`, `view list` and the other commands that never reach Jira skip the Keychain (`context.ts`).
4. The HTTP client reads the credentials on every request through `getCredentials`, which reads `settings.json` and the Keychain ([auth and Keychain](auth-and-keychain.md)).
5. `run.ts` prints the result as a table or as one JSON envelope and returns the exit code. Core's `JiraMgrError` code picks the exit code (`EXIT_CODES` in `packages/core/src/errors.ts`).

## Desktop Path

1. A React component calls `window.jm.<channel>(args)`. The preload script turns that into `ipcRenderer.invoke`.
2. `app.ts` accepts the call only from the main frame of one of its own windows, still showing its own page (`trust.ts`). Anything else gets `permission_denied`.
3. `handlers.ts` validates the argument with zod and calls the backend. A failure comes back as `{ ok: false, error }`, never as a throw.
4. `backend.ts` calls core and returns plain data. `messages.ts` rewrites CLI wording in an error message before it crosses the bridge.
5. The renderer caches the result in memory. It never holds the token or calls Jira.

## Loading

Neither client keeps a local replica ([ADR-0002](../adr/0002-live-fetch-without-replica.md)). The CLI fetches on every run. The app loads unresolved issues first, then Done issues in the background, through `searchIssuePages` in `packages/core/src/search.ts`, and refetches when the window regains focus.

## Shared State

Both clients read and write the files in the state folder, `~/Library/Application Support/jira-mgr/` or the folder `JM_STATE_DIR` names (`stateDir` in `packages/core/src/state.ts`). Each write goes to a temporary file and renames over the target. No lock guards the saved views file, so two writers at once can lose an edit. The CLI's `timer.json` is read by the CLI alone for now: the app has no timer yet.

The files and their fields are in [auth and Keychain](auth-and-keychain.md) and the [data model](data-model.md).
