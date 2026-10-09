# Desktop App

The Electron app, package `@jira-mgr/desktop`, built with electron-vite. The renderer lives here too: React, Tailwind and TanStack Query. Today it logs in, then shows a sidebar, a flat list of the project's unresolved issues and a detail pane, in a light or dark theme. The summary edits in place.

## Run

```
pnpm dev     # app with hot reload
pnpm build   # writes apps/desktop/out
pnpm test    # Vitest: IPC validation, optimistic update, focus bridge
```

`pnpm dev` and a normal launch read and write the real state folder and Keychain item. Set `JM_STATE_DIR` to a scratch folder for any manual run that must not touch them.

## Layout

```
src/shared/     the IPC contract: channel names and payload types, shared by all three sides
src/main/       main process: window, IPC handlers, the backend that calls core
src/preload/    preload script: the only bridge to the renderer
src/renderer/   React renderer
```

| File                             | Holds                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/shared/ipc.ts`              | `IpcContract`, one entry per channel, and `JmApi`, the type of `window.jm`                          |
| `src/main/handlers.ts`           | One handler per channel: validates the argument with zod, calls the backend, returns an `IpcResult` |
| `src/main/backend.ts`            | The only code that calls `@jira-mgr/core`: login, logout, issue list, summary edit                  |
| `src/main/app.ts`                | Window creation, handler registration, window focus events                                          |
| `src/main/e2e.ts`                | Test entry: the same app on a fake Jira and a fake Keychain. Not the package's `main`               |
| `src/renderer/src/ipc.ts`        | `call(channel, args)`: sends a request and throws a `JiraMgrError` on failure                       |
| `src/renderer/src/queries.ts`    | TanStack Query hooks over `call`                                                                    |
| `src/renderer/src/optimistic.ts` | The summary mutation: optimistic update, rollback, refetch                                          |
| `src/renderer/src/focus.ts`      | Feeds the Electron window's focus to TanStack Query                                                 |
| `src/renderer/src/theme.ts`      | System, light or dark; the choice sits in `localStorage`                                            |

## IPC

- Add a channel in three places: the `IpcContract` entry and the `CHANNELS` list in `src/shared/ipc.ts`, a zod schema in `argSchemas` and a handler in `createHandlers` in `src/main/handlers.ts`. The compiler fails when one is missing.
- Every handler returns `{ ok: true, data }` or `{ ok: false, error: { code, message } }`, the core error shape. A thrown `Error` loses its fields crossing IPC, so nothing throws across it. An error that is not a `JiraMgrError` becomes `internal` with a fixed message.
- Main validates every argument at the boundary. The schemas check shape and length; core owns the deeper rules and answers `validation_failed`.
- The token goes renderer to main once, at login, and stays in main. No channel returns it, and no error message or log line carries it.
- Window focus travels the other way: main sends `window:focus`, and the renderer hands it to TanStack Query's focus manager. Chromium raises `visibilitychange` only when a window hides, so the default would miss a switch back from another app.

## Rules

- Context isolation and the sandbox stay on, and Node integration stays off. The renderer reaches the main process only through `contextBridge` in the preload script.
- The renderer imports only the renderer-safe core entry points: `@jira-mgr/core`, `/issue`, `/hierarchy`, `/adf`, `/timer-calc` and `/view-filter`. Node-only entry points (`/auth`, `/http`, `/search`, `/write`, `/state` and the rest) belong to the main process.
- The main process calls `@jira-mgr/core` and nothing else. Business rules live there. The one rule kept here, that a write refuses an issue outside the settings project, mirrors the CLI's and moves to core when a third caller needs it.
- electron-vite bundles `@jira-mgr/core`, `zod` and the other `devDependencies`. Dependencies stay external in the main process.
- The package emits CommonJS, not ES modules, so the preload script can run in the sandbox. `electron.vite.config.ts` lists the main entries under `lib`, because `rollupOptions.input` drops the CommonJS and `electron` external settings with Vite 8.
- The e2e entry (`out/main/e2e.js`) is test code built beside the real one. D10 packaging must leave it out of the app.
- No code signing and no auto-update: the app builds and runs locally.

## Known Limits

- The list loads unresolved issues only, all pages before it shows any. D2 loads Done issues in the background and shows progress.
- Requests to core cannot be cancelled from the renderer yet. An unmounted query still runs to the end.
- The theme choice lives in `localStorage`, not in the settings file, which the CLI also reads. Move it there if the CLI should honour it.
- A saved summary refetches the whole list. D2 narrows that.
