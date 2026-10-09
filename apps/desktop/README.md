# Desktop App

The Electron app, package `@jira-mgr/desktop`, built with electron-vite. The renderer lives here too: React, Tailwind and TanStack Query. Today it logs in, then shows a sidebar with the saved views and the Tree: the project's issues grouped by Customer, Epic and child, with a toolbar of toggles and filters, `J` and `K` navigation, and a space-bar Peek that edits the summary in place. Light or dark theme.

## Run

```
pnpm dev     # app with hot reload
pnpm build   # writes apps/desktop/out
pnpm test    # Vitest: IPC validation, backend loads and views, tree model, optimistic updates, queries
```

`pnpm package` (from the repository root) builds the app and assembles the unsigned `dist/jira-mgr.app`. [Install the Desktop App](../../docs/how-to/install-desktop-app.md) covers installing it.

`pnpm dev` and a normal launch read and write the real state folder and Keychain item. Set `JM_STATE_DIR` to a scratch folder for any manual run that must not touch them.

## Layout

```
src/shared/     the IPC contract: channel names and payload types, shared by all three sides
src/main/       main process: window, IPC handlers, the backend that calls core
src/preload/    preload script: the only bridge to the renderer
src/renderer/   React renderer
```

| File                               | Holds                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/ipc.ts`                | `IpcContract`, one entry per channel, the progress event and `JmApi`, the type of `window.jm`                                                |
| `src/main/handlers.ts`             | One handler per channel: validates the argument with zod, calls the backend, returns an `IpcResult`                                          |
| `src/main/backend.ts`              | The only code that calls `@jira-mgr/core`: login, logout, per-phase issue loads, Customers, current user, toggles, saved views, summary edit |
| `src/main/app.ts`                  | Window creation, handler registration, window focus events, progress events to the window that asked                                         |
| `src/main/trust.ts`                | Decides whether an IPC request came from our own page                                                                                        |
| `src/main/e2e.ts`                  | Test entry: the same app on a fake Jira and a fake Keychain, with windows that open without taking focus. Not the package's `main`           |
| `src/renderer/src/ipc.ts`          | `call(channel, args)`: sends a request and throws a `JiraMgrError` on failure                                                                |
| `src/renderer/src/queries.ts`      | TanStack Query hooks over `call`: the two phase queries, me, Customers, toggles; the load tracker                                            |
| `src/renderer/src/viewQueries.ts`  | The saved views query and the create, rename and delete mutations: optimistic rename and delete with rollback                                |
| `src/renderer/src/views.ts`        | `activeView`: which saved view the filter bar and toggles currently equal                                                                    |
| `src/renderer/src/ViewsList.tsx`   | The sidebar's Views section: apply, New view, inline rename, inline delete confirmation, arrow-key navigation                                |
| `src/renderer/src/optimistic.ts`   | The summary mutation: optimistic update in every phase cache that holds the issue, rollback, refetch of the touched phases                   |
| `src/renderer/src/tree.ts`         | Pure Tree model: `mergeIssues`, `flattenTree`, `moveActive`, `clickRow`, `windowRange`, `fallbackRow`                                        |
| `src/renderer/src/filters.ts`      | Pure filter-bar model: the choices per field, toggling a choice, the chips                                                                   |
| `src/renderer/src/Shell.tsx`       | Owns the tree state (filters, collapsed and revealed sets, active row, Peek) and derives the rows from the query caches                      |
| `src/renderer/src/IssueTree.tsx`   | The virtual window over the rows: keys, scroll anchoring, `aria-activedescendant`                                                            |
| `src/renderer/src/TreeRow.tsx`     | One row of any kind                                                                                                                          |
| `src/renderer/src/TreeToolbar.tsx` | The three toggles, the Filter and Groups menus, filter chips and the text filter                                                             |
| `src/renderer/src/IssueDetail.tsx` | The Peek: summary editor, properties, mismatch detail                                                                                        |
| `src/renderer/src/focus.ts`        | Feeds the Electron window's focus to TanStack Query                                                                                          |
| `src/renderer/src/theme.ts`        | System, light or dark; the choice sits in `localStorage`                                                                                     |

## Tree

- Loading: `['issues', 'unresolved']`, `['toggles']` and `['me']` start together. The Tree renders once the unresolved phase and the toggles have data, and `me` when "Assignee: me" or the assignee filter needs it. `['issues', 'done']` then loads in the background, always, since Done chips need the Done issues under open parents, and the toolbar shows the running count. A saved summary refetches only the phases that hold the issue.
- The Tree has no grouping, sorting or Done rules of its own: `buildHierarchy` and `issueMatcher` from core decide, as `jm issue tree` does. One difference remains. `jm issue tree` never loads Done issues under "Hide done", so it prints an open Story whose Epic is Done under No Epic. The app moves that Story under its dimmed Epic once Done issues load.
- Rows are 32 pixels tall and only the rows in view, plus 10 of overscan and the active row, are in the DOM. Scroll anchoring keeps the first visible row where it is when a rebuild changes the rows above it.
- Collapsed groups, revealed chips and filters last for the session. "Hide done", "Assignee: me" and "Hide empty Customers" persist in `settings.json` under `toggles`; the CLI ignores them.
- Keys: `J`/`K` and the arrows move, `ArrowRight` and `ArrowLeft` expand, collapse and change level, `Shift` with them expands or collapses all, `Home`, `End`, `PageUp` and `PageDown` jump, `Enter` toggles a group or opens an issue, `Space` toggles the Peek, `Esc` closes it. Every other single-letter key is left to D7.

## Saved Views

- The sidebar's Views section lists `views.json`, the file `jm view list` and `jm issue list --view` read. Core's `createView`, `renameView` and `deleteView` do the work in main, so a view made here shows in the CLI and the reverse. Before the file exists the list shows the starters, "My issues" and "Current sprint"; they are ordinary views once the first change writes the file, so they can be renamed and deleted.
- Clicking a view replaces the filter bar's filters with the view's and sets the three toggles to the view's. The toggles go through the same write as a press on a toggle button, so they are written to `settings.json` and stay as the view left them after a restart (Q28: each toggle remembers its last state). The filters last for the session, as before.
- The view that equals the filter bar and the toggles is marked (`aria-current`). It is derived on each render, so it stops being active the moment a filter or toggle changes, and a bar built by hand that matches a view marks it.
- New view (the + beside the heading) saves the current filters and toggles under a name typed inline. Enter saves, Esc cancels, and a taken or empty name keeps the field open with core's message. Core makes the id, a slug of the name, so the row appears when the write answers.
- Rename is an inline field (pencil button, or F2 on a focused view): Enter or leaving the field saves, Esc cancels, and the id stays. Rename and delete are optimistic: the list changes at once and a refusal puts the old name or the view back and shows the error under the list. Delete asks inline, in place of the row, with Cancel focused; Esc cancels. Focus goes back to a view button afterwards.
- Up and Down move between the views. There are no single-letter shortcuts.
- Main runs every views call through one promise chain, since core reads, changes and rewrites the whole file and two overlapping calls would drop an edit. There is no lock file: the CLI only reads `views.json`. A CLI command that writes views must lock the file first, as core's timer does for `timer.json`.
- A view is read again on window focus, so a hand edit of the file shows up when the window regains focus.

## IPC

- Add a channel in three places: the `IpcContract` entry and the `CHANNELS` list in `src/shared/ipc.ts`, a zod schema in `argSchemas` and a handler in `createHandlers` in `src/main/handlers.ts`. The compiler fails when one is missing.
- Every handler returns `{ ok: true, data }` or `{ ok: false, error: { code, message } }`, the core error shape. A thrown `Error` loses its fields crossing IPC, so nothing throws across it. An error that is not a `JiraMgrError` becomes `internal` with a fixed message.
- Main answers only the main frame of one of its own windows while that frame shows the app's page (`src/main/trust.ts`). It refuses every permission request from the page, such as notifications and camera.
- Main validates every argument at the boundary. The schemas check shape and length; core owns the deeper rules and answers `validation_failed`.
- The token goes renderer to main once, at login, and stays in main. No channel returns it, and no error message or log line carries it, with `JM_DEBUG=1` too, which logs stack frames and never the message. The login mutation has `gcTime: 0`, so the cache drops the token with the login screen. Until then it sits in the renderer's memory, as the typed value does.
- Each handler gets a second argument, `{ sendProgress }`, built from the requesting window's sender. `issues:list` reports each page through it as the `issues:progress` event, which preload exposes as `onIssuesProgress`. The renderer numbers every load and ignores progress for any other load id.
- `issues:list` loads one phase. A new load of a phase aborts the one running for it, and `session:logout` aborts both before the token is removed. An aborted load answers `null`, never an error.
- `settings:setToggles` writes through a promise chain, so two quick presses write in order. It replaces only `toggles` and keeps the rest of the settings.
- `views:list`, `views:create`, `views:rename` and `views:delete` take strict objects: a name of at most 80 characters, filters in core's shape (lists of strings, a text string) and the three toggles. Core owns the name rules (trimmed, not empty, unique in any case) and answers `validation_failed` or `not_found`.
- Window focus travels the other way: main sends `window:focus`, and the renderer hands it to TanStack Query's focus manager. Chromium raises `visibilitychange` only when a window hides, so the default would miss a switch back from another app.

## Rules

- Context isolation and the sandbox stay on, and Node integration stays off. The renderer reaches the main process only through `contextBridge` in the preload script.
- The renderer imports only the renderer-safe core entry points: `@jira-mgr/core`, `/issue`, `/hierarchy`, `/adf`, `/timer-calc` and `/view-filter`. Node-only entry points (`/auth`, `/http`, `/search`, `/write`, `/state` and the rest) belong to the main process. `src/shared/ipc.ts` imports the `SavedView` type from `/state` with `import type`, which leaves nothing of it in the renderer bundle.
- The main process calls `@jira-mgr/core` and nothing else. Business rules live there. The write guard that refuses an issue outside the settings project is core's `assertInProject`, shared with the CLI.
- electron-vite bundles `@jira-mgr/core`, `zod` and the other `devDependencies`. Dependencies stay external in the main process.
- The package emits CommonJS, not ES modules, so the preload script can run in the sandbox. `electron.vite.config.ts` lists the main entries under `lib`, because `rollupOptions.input` drops the CommonJS and `electron` external settings with Vite 8.
- The e2e entry (`out/main/e2e.js`) is test code built beside the real one. `scripts/package.ts` leaves it out of the app, and fails the package if `e2e.js`, a fake Jira marker or a `require` of anything but `electron` and `node:` built-ins reaches it. Keep every runtime import bundled: the packaged app has no `node_modules`.
- The package is Electron's prebuilt `Electron.app` with `out/` as its app, renamed and signed ad hoc, so it needs no packaging dependency. No code signing identity and no auto-update: the app builds and runs locally.

## Known Limits

- The Tree shows nothing until a whole phase has loaded, since a partial phase can hold a Story whose Epic is on a later page.
- The renderer cannot cancel a load by itself. A newer load of a phase and logout abort the one running; an unmounted query otherwise runs to the end.
- Filter choices other than statuses come from the loaded issues, so an issue that is not loaded cannot be filtered for.
- The one-click fix for a Customer mismatch ships with D3. The badge shows the mismatch; the Peek names both Customers.
- Saved views have no order controls and no "update this view with the current filters": delete it and save it again.
- Row heights are fixed. A row with a second line would need a rewrite of the window.
- The theme choice lives in `localStorage`, not in the settings file, which the CLI also reads. Move it there if the CLI should honour it.
- A saved summary refetches the whole phase that holds the issue. Re-reading only that issue belongs with D3.
