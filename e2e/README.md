# End-to-End Tests

Playwright tests that cross package boundaries. Unit and integration tests sit beside the code they test.

| Suite      | Drives                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `desktop/` | The built desktop app, through Playwright's Electron driver, on a fake Jira and a fake Keychain: `shell.test.ts`, `tree.test.ts`, `page.test.ts` |

## Run

```
pnpm e2e
```

The command builds the desktop app, then launches `apps/desktop/out/main/e2e.js`, an entry that runs the real app with `fetch` replaced by an in-memory Jira (`src/main/e2e-fake.ts`) and the Keychain replaced by core's own code over a fake `security`. It refuses to start without `JM_STATE_DIR`, and each test gives it a temporary folder, which also holds Electron's own storage. Nothing reaches the network, the real Keychain or the real state folder. The fake holds every write (an edit, a transition or a sprint move) until a test calls `releaseEdit`, so a test sees the optimistic state without a timing window. It answers what the issue page asks: a read of one issue, transitions, assignable users, a board with sprints, and create metadata with Customer, Engagement and priority options. It applies edits as the live project does, so an estimate edit also moves the remaining estimate and Time remaining, and it refuses the summary `reject me` and the priority `Highest`, so a test can watch a rollback. `counts.issueReads` lists each read of one issue and `counts.editBodies` each write received, so a test checks what was sent and that an edit reloaded no list. It also holds the first Done search page until `releaseDone`, so a test sees the Tree before Done issues arrive, and `failDone` makes the next Done page answer 500. `failRead` makes the next read of one issue answer 500. `counts.doneEarly` counts Done pages requested before the unresolved phase served its last page, which must stay 0. `JM_E2E_BULK=<n>` adds that many open Stories under one Epic, for the virtual window test. `desktop/harness.ts` launches the app and holds these helpers. Windows open invisible, click-through and without focus, so a run never flashes on your screen, catches your clicks or types into whatever app you are using. (macOS keeps part of every window on a display, so the window cannot sit off-screen.) On Linux without a display, run `xvfb-run --auto-servernum pnpm e2e`. When `CI` is set, the test passes `--no-sandbox` to Electron, because GitHub's runners lack the setuid sandbox helper.

Electron downloads its binary on first launch.

The CLI will get a `cli/` suite that runs the built `jm` binary as a subprocess and checks `--json` output and exit codes.

`desktop/views.test.ts` covers the sidebar's saved views. It reads `views.json` and `settings.json` in the temporary `JM_STATE_DIR`, the files `jm view list` and the app share, to check what the app wrote, and writes `views.json` itself to check what the app reads.

`desktop/package.test.ts` launches the packaged `apps/desktop/dist/jira-mgr.app` on a scratch `JM_STATE_DIR` and expects the login screen. It skips unless `pnpm package` has built the app, so CI (Linux) skips it and the Mac check is `pnpm package && pnpm e2e`.
