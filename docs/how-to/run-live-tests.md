# Run Live Tests

A live test reads real PSAPAC with your stored token. It never writes. Run one only when you changed code that depends on Jira's real answers, such as the attachment redirect in `packages/core/src/http.ts`.

## Before You Start

1. Log in so the Keychain holds a token: `pnpm -s jm -- auth login`. Live tests build their client with the stored credentials (`createHttpClient()` in `packages/core/src/extras.live.test.ts`).
2. Check the login with `pnpm -s jm -- auth status`. It must show `https://engineering-collibra.atlassian.net` and project `PSAPAC`.

## Run

```
pnpm test:live
```

The script is `JM_LIVE_JIRA=1 pnpm -r test` (root `package.json`), so it runs the normal suites too, with the live tests switched on. Without the variable, each live test skips. Run live tests only through `pnpm test:live`, as [AGENTS.md](../../AGENTS.md) requires.

To run one file:

```
JM_LIVE_JIRA=1 pnpm --filter @jira-mgr/core exec vitest run src/extras.live.test.ts
```

## What Runs

| File | Reads |
|---|---|
| `packages/core/src/extras.live.test.ts` | The image attachments of PSAPAC-19, PSAPAC-1219 and PSAPAC-3017, and each attachment's content redirect, to pin the media ids a description embeds |

It closes the MSW server first, because the shared setup fails any request with no handler.

## Keychain Test

`packages/core/src/auth.live.test.ts` runs against the real `/usr/bin/security`, not Jira. `pnpm test:live` does not enable it. Set `JM_LIVE_KEYCHAIN=1` on macOS to run it. It stores a throwaway token under a random service name and deletes it afterwards.

## Rules

- A live test makes no create, edit, transition, comment, worklog, attachment or delete call ([Testing](../standards/testing.md#live-tests)).
- A failure here means Jira's real answer differs from what core expects. Re-record the affected fixture ([Refresh fixtures](refresh-fixtures.md)) and fix core.
- The written, manual check of every CLI command against PSAPAC is the [L7 smoke check](../runbooks/l7-smoke-check.md).
