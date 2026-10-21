# Desktop Development

Run, test and build the Electron app from the repository root with Node 24. Install first with `pnpm install --frozen-lockfile`.

## Run

```
pnpm dev
```

This runs `electron-vite dev` for `@jira-mgr/desktop`, the app with hot reload.

`pnpm dev` reads and writes your real state folder and Keychain item. `JM_STATE_DIR` moves the state files only:

```
JM_STATE_DIR=/path/to/scratch pnpm dev
```

The Keychain item `jira-mgr` is not scoped. Logging in during that run rewrites your real item, and logging out deletes it. For a run that touches neither the state folder nor the Keychain, use `pnpm e2e`.

## Debug

- The terminal that started the app shows `jm ipc <channel> failed: <code>` for each failed IPC call. `JM_DEBUG=1` adds the stack frames (`apps/desktop/src/main/handlers.ts`), and core prints each request's method, path and status. None of it prints the token or a header.
- Every IPC call returns `{ ok, data }` or `{ ok: false, error }`. A failing call shows its code in the renderer, so start from the channel in `apps/desktop/src/shared/ipc.ts`.
- Error text that mentions `jm` is rewritten to app wording in `src/main/messages.ts`. The CLI shows the original.

## Test

```
pnpm --filter @jira-mgr/desktop test
pnpm e2e
```

The first runs the Vitest unit tests. `pnpm e2e` builds the app and drives it with Playwright on a fake Jira and a fake Keychain, so it touches neither your account nor your state ([e2e README](../../e2e/README.md)). More in [Run the tests](run-tests.md).

## Build

```
pnpm --filter @jira-mgr/desktop build
```

This writes `apps/desktop/out`. It builds two main-process entries: `index`, the app, and `e2e`, the test entry. `pnpm package` assembles the `.app`, signed ad hoc, and fails when the e2e entry or fake code is inside ([Install the desktop app](install-desktop-app.md)).

## Where Code Goes

| Change | Put it in |
|---|---|
| A Jira call or domain rule | `packages/core/src`, never the app |
| A new IPC channel | `shared/ipc.ts` (types and the channel table), `main/handlers.ts` (a zod schema and handler), `main/backend.ts` |
| UI | `renderer/src` |

The renderer reaches Jira only through the main process. [Clients](../architecture/clients.md) explains the split.
