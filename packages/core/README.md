# Core

`@jira-mgr/core`, the package every client imports: the CLI and the desktop app. It will own the Jira client, domain rules, the saved view schema and typed errors with stable codes. It exports `JiraMgrError`, plus `APP_NAME`, `appTitle` and the `Issue` type. The Node-only state file readers and writers live at `@jira-mgr/core/state`, the credential functions at `@jira-mgr/core/auth`, field resolution at `@jira-mgr/core/fields`, the HTTP client at `@jira-mgr/core/http`, issue search at `@jira-mgr/core/search`, and the issue tree at `@jira-mgr/core/hierarchy`, so the renderer bundle never pulls in `node:` modules.

Its exported API is public to the other packages, so change it additively.

## Use

Other packages import it by name:

```ts
import { appTitle } from '@jira-mgr/core'
```

The `exports` map points at `src/index.ts`. The package has no build step: tsup and electron-vite bundle the source into each client.

## State Files

`readSettings`, `readViews`, `readTimer` and `readFields` (with matching `write` functions) own the non-secret state in `~/Library/Application Support/jira-mgr/`. Set `JM_STATE_DIR` to use another folder, as the tests do.

- A missing file yields defaults: starter views for `views.json`, `null` for `timer.json` and `fields.json`.
- A file that is not valid JSON or fails its schema throws `JiraMgrError` with code `validation_failed`, and the message names the file. Writes validate first, then write a temp file and rename it.

## Credentials

`@jira-mgr/core/auth` exports `login`, `logout` and `getCredentials`.

- `login({ siteUrl, projectKey, email, token })` accepts only an `https://<name>.atlassian.net` site with no path, port or userinfo. It checks the token with `GET /rest/api/3/myself` (no redirects), resolves the custom fields (see Field Resolution), then stores the token in the Keychain, `siteUrl`, `projectKey` and `email` in `settings.json`, and the ids in `fields.json`. A 401 or 403 throws `permission_denied`, and a field failure throws `validation_failed`; either stores nothing.
- `logout()` deletes every `jira-mgr` Keychain item, even when `settings.json` is corrupt, and clears `email` from settings. A missing item is not an error. `login` deletes the previous account's item when the email changes.
- `getCredentials()` returns `{ siteUrl, email, token }`, or throws `permission_denied` ("Not logged in") when settings hold no email or the Keychain holds no token. A `siteUrl` in settings that fails the login site check throws `validation_failed`, so the token never goes to a tampered site.

The Keychain item has service `jira-mgr` and the email as account. Every call goes through `/usr/bin/security`: reads use `find-generic-password -w`, and writes send `add-generic-password -U` to `security -i` on stdin, so the token never reaches a command line. A token or email holding a quote, backslash or control character is refused, since `security -i` has no safe encoding for it. A token over 1024 bytes or an email over 254 bytes is refused too, because `security -i` reads stdin in 4095-byte chunks and runs any overflow as a new command. `security -i` exits 0 even when its command fails, so a write reads the item back.

## Field Resolution

`@jira-mgr/core/fields` exports `resolveFields` and `getFieldIds`. `login` calls `resolveFields`; clients call `getFieldIds()`.

- `resolveFields(http, project, overrides)` reads the create metadata of every issue type of the project, all pages, and matches Customer, Engagement, Sprint, Start date and Time remaining (h) by exact name. A name counts as found when any type lists it. It returns `{ customer, engagement, sprint, startDate, timeRemaining }`.
- A name that no type lists, or that maps to more than one field id, throws `validation_failed` naming each field and its candidate ids, and telling the user to set `fieldOverrides` in `settings.json`.
- A `fieldOverrides` id wins over the name. It must still appear in the project's create metadata, or the login fails.
- `getFieldIds()` returns the ids in `fields.json` with the current `fieldOverrides` applied. It throws `permission_denied` when `fields.json` is missing, and `validation_failed` when it was resolved for another site or project than settings name.

## HTTP Client

`createHttpClient(options?)` from `@jira-mgr/core/http` returns `{ request(method, path, { body, signal }) }`. It signs each request with Basic auth from `getCredentials()`, and `options.credentials` swaps that out for tests.

- `path` must start with `/rest/` and hold no `..`, backslash or encoded dot, so the token only goes to the site. Redirects are refused.
- A plain `body` goes as JSON. A `FormData` body goes as multipart with `X-Atlassian-Token: no-check`. A 204 or empty body resolves to `undefined`. Any other body resolves to parsed JSON typed `unknown`, which the caller validates.
- A 429, or a 503 with `Retry-After`, waits that many seconds (at most 60) and retries, up to 3 times. A 429 with no header, or a zero, past or unreadable one, backs off 1, 2, then 4 seconds. `options.sleep` replaces the wait in tests, and the caller's `signal` cuts a wait short. Each attempt, body read included, times out after `timeoutMs` (30 000 by default). A failed write says it may have gone through. A GET or HEAD with a body is refused.
- 400 throws `validation_failed`, 401 and 403 `permission_denied`, 404 `not_found`, and everything else `jira_error`, including network failures, timeouts and spent retries. `details` holds `{ status, errorMessages, errors }` from the response body.
- `JM_DEBUG=1` prints `jm http <METHOD> <path> <status> <ms>` to `stderr` for each attempt. It never prints headers, bodies or query strings.

## Issue Search

`@jira-mgr/core/search` exports `searchIssuePages` and `searchIssues`. The `Issue` type and its zod schema live in `@jira-mgr/core/issue`, which imports nothing from `node:`. The main entry re-exports the type, so a renderer imports it from `@jira-mgr/core`.

- `searchIssuePages(http, { pageSize, signal })` is an async generator over `POST /rest/api/3/search/jql`, following `nextPageToken` until `isLast`. It reads the project from settings and the custom field ids from `getFieldIds()`, and requests only the fields `Issue` needs, never the description. It yields `{ phase, issues, loaded }`.
- Two phases run in order: `unresolved` (`statusCategory != Done`), then `done`. Each orders by `key DESC`. The key never changes, so an edit made mid-load cannot move an issue across a page boundary as `updated` would.
- `loaded` counts issues across both phases. Jira sends no total, so there is no percentage.
- `searchIssues(http, options)` collects every issue in load order.
- `signal` goes to the HTTP client, so aborting stops the paging and rejects with the signal's reason.
- An issue that fails the schema, or a page that is not last but sends no token or repeats one, throws `jira_error`.
- `Issue` holds `id`, `key`, `summary`, `issueType`, `status` (with `category`), `resolution`, `parentKey`, `assignee`, `labels`, `priority`, `customer`, `engagement`, `sprints`, `startDate`, `dueDate`, `originalEstimateSeconds`, `remainingEstimateSeconds`, `timeRemainingHours`, `created` and `updated`. Times are UTC ISO strings, and a value Jira leaves empty is `null` (`[]` for `sprints`).

## Hierarchy

`@jira-mgr/core/hierarchy` exports `buildHierarchy(issues, options)`. It is pure, has no `node:` imports, and returns plain data that survives IPC. Options: `hideDone`, `assigneeMe` and `hideEmptyCustomers` (the settings toggles), `accountId`, and optionally `customers`, the full Customer option list.

It returns `CustomerGroup[]`, each `{ customer, epics, noEpic }`, and `customer: null` is the "No Customer" group. A `HierarchyNode` holds `issue`, `children`, `doneChildren`, `doneCount`, `contextOnly` and `customerMismatch`.

- An Epic and its children sit under the Epic's Customer. A direct child whose own Customer differs gets `customerMismatch: { own, epic }`, where either side may be `null`. Subtasks nest under their parent and are never flagged.
- `noEpic` holds issues with no Epic parent in the input, and Subtasks whose parent is not in the input, under their own Customer.
- Under an open parent, Done children go to `doneChildren` whatever the toggles say. Under a Done parent they stay in `children`. `hideDone` drops a Done Epic or `noEpic` issue with its whole subtree. With `assigneeMe` on, a Done ancestor of a kept open issue stays as context instead, with its other Done children dropped.
- `assigneeMe` keeps issues assigned to `accountId` plus their ancestors. An ancestor kept only as context has `contextOnly: true`.
- `hideEmptyCustomers: false` adds a group for every Customer in `customers`, and for every Customer whose issues the toggles hid.
- Customers sort case-insensitively, then No Customer, then "Collibra (Internal team)" and "Collibra (Internal template)". Epics sort by key descending. Children sort by status (Opportunity, To Do, In Progress, Review, Hold, Done, then any other), then key descending.

## Test

```
pnpm --filter @jira-mgr/core test
```

Vitest runs `<file>.test.ts` beside the source. `pnpm test:live` sets `JM_LIVE_JIRA=1`, the opt-in for tests that read the live PSAPAC Jira. Tests never write to Jira. Integration tests run against an MSW fake fed by the recorded PSAPAC responses in `fixtures/`, served through `test/msw.ts`.

Set `JM_LIVE_KEYCHAIN=1` on macOS to run `auth.live.test.ts`, one test against the real `security` binary, using a throwaway service name it deletes afterwards.
