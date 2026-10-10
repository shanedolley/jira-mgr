# Rate Limited

**Use when:** Jira answers 429 and `jm` or the app stalls, or `jm` exits 5 with `Jira answered 429 to ... Try again later.`

**Severity:** reads and writes slow or fail for every client using the same account until Jira's limit clears. Nothing is lost, but a write that failed after a retry may have gone through.

`jm` below means the linked binary ([Install the CLI](../how-to/install-cli.md)), or `pnpm -s jm --` from the repository root.

## Check

1. Repeat a read with request logging on:

   ```
   JM_DEBUG=1 jm issue list --mine --limit 5
   ```

   Lines such as `jm http POST /rest/api/3/search/jql 429 180ms` confirm the limit. A line with no status and `failed` points at the network or a timeout instead. The log shows paths without query strings and never a header.

2. List what else calls Jira as this account: agents running `jm` in a loop, a second app window, a script.

## What the Client Does

The HTTP client retries a `429`, and a `503` that sends `Retry-After`, up to 3 times (`packages/core/src/http.ts`). It waits as long as `Retry-After` says, up to 60 seconds. With no usable header it waits 1, 2 and 4 seconds. After the last retry it throws `jira_error` (exit 5). Each request also times out after 30 seconds.

## Fix

1. Stop what you started that is hammering Jira. Wait a minute, then rerun the command once.
2. Cut the request count: add `--limit`, or filters such as `--mine`, `--status` and `--label`, so the CLI reads fewer search pages.
3. For an agent, run commands one after another, not in parallel, and stop on exit 5 instead of looping.
4. After a failed write, read the issue (`jm issue get <key>`) before repeating it. The failure may have followed a request that got through.

## Verify

1. `JM_DEBUG=1 jm issue list --mine --limit 5` shows `200` and no `429`.
2. The app refetches its issues when you refocus its window.

## Follow Up

- A limit that returns every day means a caller is too busy. Fix the caller, not the client. Jira Cloud limits apply to the CLI and the app alike ([ADR-0002](../adr/0002-live-fetch-without-replica.md)).
