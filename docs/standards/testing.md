# Testing

Jira holds the data and the rules, so `core` tests run against a fake Jira.

| Layer | Tool | Location | Runs against |
|---|---|---|---|
| Units: parsing, mapping, ADF conversion, formatting | Vitest | `<file>.test.ts` beside the source | Nothing external |
| `core` integration | Vitest and MSW | `<file>.int.test.ts` beside the source | The MSW fake |
| Live read-only checks | Vitest | `<file>.live.test.ts` beside the source | Real PSAPAC, reads only |
| CLI | Vitest calling `run(argv, io, deps)` in process, plus a few smoke tests of the built binary | `apps/cli/src/` beside the source | The MSW fake, except the binary smoke tests, which need no Jira |
| Desktop end to end | Playwright's Electron driver | `e2e/` | The MSW fake |

`pnpm test` runs the first two layers and the CLI tests, which build the bundle first. `pnpm test:live` runs the live layer, and `pnpm e2e` runs the desktop end-to-end layer.

## The Fake

- `core` tests run against an MSW server that replays recorded PSAPAC responses. Record the responses once and commit them as fixtures exactly as recorded. Do not scrub or obfuscate any data: the repository and the app are approved to hold PSAPAC data. A recording saves response bodies only, never request headers, so tokens never reach a fixture.
- Record a fixture with `pnpm fixture:record -- <name> <GET|POST> <path> [json-body]`, which reads `JM_JIRA_SITE`, `JM_JIRA_EMAIL` and `JM_JIRA_TOKEN` from the environment and writes `packages/core/fixtures/<name>.json`. It refuses every write except the `POST` that searches. See [scripts](../../scripts/README.md#record-a-fixture).
- Serve a fixture in a test with `serveFixture(method, path, name)` from `packages/core/test/msw.ts`. The setup file fails any request with no handler and resets handlers after each test.
- Refresh a fixture when Jira's response shape changes, and record why in the pull request. `docs/how-to/refresh-fixtures.md` holds the steps once written.
- The fake answers writes with canned responses and records the requests, so a test asserts what core would send.
- Desktop end-to-end tests start the same fake and point the app at it. CLI tests call `run()` in process and inject a client, because MSW cannot intercept a child process and core refuses any site but `https://<name>.atlassian.net`.

## Live Tests

- A live test runs only when `JM_LIVE_JIRA=1` is set, and only through `pnpm test:live`. Without the variable it skips.
- A live test reads PSAPAC with the stored token. It never writes: no create, edit, transition, comment, worklog, attachment or delete.
- A live test checks that the recorded fixtures still match what Jira returns.

## Rules

- Test behaviour through public interfaces: core exports, CLI commands, the app's screens. Leave private helpers to the tests that use them.
- Never write to Jira from any test, live or not.
- Each test builds its own fake state, so tests run in parallel and in any order.
- Keep tests deterministic: inject the clock and id generation, and wait on conditions rather than sleeping.
- Name a test for the behaviour it proves: `groups a child under its Epic's Customer`.
- A bug fix starts with a test that reproduces the bug.

Coverage has no percentage target. The [definition of done](code-review.md#definition-of-done) lists what must be tested.
