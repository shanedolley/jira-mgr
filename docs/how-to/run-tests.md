# Run the Tests

Run every suite with Node 24 (`.nvmrc`). Install first with `pnpm install --frozen-lockfile`.

## Suites

| Command | Runs | Needs |
|---|---|---|
| `pnpm test` | Core, CLI and desktop unit and integration tests | Nothing external: core and CLI tests run against the MSW fake |
| `pnpm e2e` | Playwright against the built desktop app | Electron's binary, downloaded on first launch |
| `pnpm test:live` | The read-only PSAPAC tests | [A stored token](run-live-tests.md) |

`pnpm test` runs `pnpm -r test`. The CLI package builds its bundle with `tsup` first, because a few tests spawn the built binary (`apps/cli/package.json`). `pnpm e2e` builds the desktop app first. On Linux without a display, use `xvfb-run --auto-servernum pnpm e2e`, as CI does.

CI also runs `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm docs:reference`, and fails when `docs/reference` differs from the committed files (`.github/workflows/ci.yml`). Run the same before you push.

## One Package or File

```
pnpm --filter @jira-mgr/core test
pnpm --filter @jira-mgr/core exec vitest run src/fields.int.test.ts
pnpm --filter @jira-mgr/core exec vitest run -t "ambiguous"
```

The packages are `@jira-mgr/core`, `@jira-mgr/cli`, `@jira-mgr/desktop` and `@jira-mgr/e2e`. Run `pnpm --filter @jira-mgr/e2e exec playwright test desktop/keyboard.test.ts` for one e2e file after `pnpm --filter @jira-mgr/desktop build`.

## Debug a Failure

- **Unhandled request.** The shared setup fails any request with no MSW handler (`packages/core/test/setup.ts`). Serve the call with `serveFixture`, `serveCreatemeta` or `serveRecorded` from `packages/core/test/msw.ts`.
- **State leaks.** A test that reads settings needs its own state folder. `usePsapacState()` makes a temporary `JM_STATE_DIR` with PSAPAC settings and field ids for each test.
- **No request detail.** Set `JM_DEBUG=1` to print the method, path, status and time of each request to stderr. Headers and query strings never print.
- **A CLI test reaches for the Keychain.** The CLI setup mocks `spawn` and throws, so inject a fake Keychain (`apps/cli/src/test-setup.ts`).
- **An e2e test hangs.** The fake Jira holds every write until the test calls `releaseEdit` ([e2e README](../../e2e/README.md)).

The testing rules are in [Testing](../standards/testing.md).
