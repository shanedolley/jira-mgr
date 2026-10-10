# Testing

Jira holds the data and the rules, so `core` tests run against a fake Jira.

| Layer | Tool | Location | Runs against |
|---|---|---|---|
| Units: parsing, mapping, ADF conversion, formatting | Vitest | `<file>.test.ts` beside the source | Nothing external |
| `core` integration | Vitest and MSW | `<file>.int.test.ts` beside the source | The MSW fake |
| Live read-only checks | Vitest | `<file>.live.test.ts` beside the source | Real PSAPAC, reads only |
| CLI | Vitest calling `run(argv, io, deps)` in process, plus a few smoke tests of the built binary | `apps/cli/src/` beside the source | The MSW fake, except the binary smoke tests, which need no Jira |
| Desktop units: IPC validation, optimistic updates, focus | Vitest | `<file>.test.ts` beside the source in `apps/desktop/src/` | Nothing external |
| Desktop end to end | Playwright's Electron driver | `e2e/` | An in-memory fake Jira inside the app's `e2e` entry |

`pnpm test` runs the first two layers, the desktop unit tests and the CLI tests, which build the bundle first. `pnpm test:live` runs the live layer, and `pnpm e2e` runs the desktop end-to-end layer.

## The Fake

- `core` tests run against an MSW server that replays recorded PSAPAC responses. Record the responses once and commit them as fixtures exactly as recorded. Do not scrub or obfuscate any data: the repository and the app are approved to hold PSAPAC data. A recording saves response bodies only, never request headers, so tokens never reach a fixture.
- Record a fixture with `pnpm fixture:record -- <name> <GET|POST> <path> [json-body]`, which reads `JM_JIRA_SITE`, `JM_JIRA_EMAIL` and `JM_JIRA_TOKEN` from the environment and writes `packages/core/fixtures/<name>.json`. It refuses every write except the `POST` that searches. See [scripts](../../scripts/README.md#record-a-fixture).
- Serve a fixture in a test with `serveFixture(method, path, name)` from `packages/core/test/msw.ts`, which CLI tests import as `@jira-mgr/core/test/msw`. The setup file fails any request with no handler and resets handlers after each test.
- Refresh a fixture when Jira's response shape changes, and record why in the pull request. `docs/how-to/refresh-fixtures.md` holds the steps once written.
- The fake answers writes with canned responses and records the requests, so a test asserts what core would send.
- Desktop end-to-end tests launch the app's `e2e` entry, which swaps `fetch` for an in-memory fake Jira and the Keychain for a fake `security`, because MSW cannot intercept Electron's main process. CLI tests call `run()` in process and inject a client, because MSW cannot intercept a child process and core refuses any site but `https://<name>.atlassian.net`.

## Live Tests

- A live test runs only when `JM_LIVE_JIRA=1` is set, and only through `pnpm test:live`. Without the variable it skips.
- A live test reads PSAPAC with the stored token. It never writes: no create, edit, transition, comment, worklog, attachment or delete.
- The Jira live test (`extras.live.test.ts`) pins the media ids that PSAPAC attachments resolve to. `auth.live.test.ts` runs the real `security` binary under `JM_LIVE_KEYCHAIN=1`, not `JM_LIVE_JIRA`, and makes no Jira call.

## Rules

- Test behaviour through public interfaces: core exports, CLI commands, the app's screens. Leave private helpers to the tests that use them.
- Never write to Jira from any test, live or not.
- Each test builds its own fake state, so tests run in parallel and in any order.
- Keep tests deterministic: inject the clock and id generation, and wait on conditions rather than sleeping.
- Name a test for the behaviour it proves: `groups a child under its Epic's Customer`.
- A bug fix starts with a test that reproduces the bug.

Coverage has no percentage target. The [definition of done](code-review.md#definition-of-done) lists what must be tested.
