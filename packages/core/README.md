# Core

`@jira-mgr/core`, the package every client imports: the CLI and the desktop app. It owns the Jira client, domain rules, the saved view schema and typed errors with stable codes. It exports `JiraMgrError`, plus `APP_NAME`, `appTitle` and the `Issue` type. The Node-only state file readers and writers live at `@jira-mgr/core/state`, the credential functions at `@jira-mgr/core/auth`, field resolution at `@jira-mgr/core/fields`, the HTTP client at `@jira-mgr/core/http`, issue search at `@jira-mgr/core/search`, the issue tree at `@jira-mgr/core/hierarchy`, issue writes at `@jira-mgr/core/write`, comments, worklogs, links and attachments at `@jira-mgr/core/extras`, sprints at `@jira-mgr/core/sprints`, the timer engine at `@jira-mgr/core/timer`, the pure timer rules at `@jira-mgr/core/timer-calc`, the pure view filters at `@jira-mgr/core/view-filter`, the row properties, orders and priority levels at `@jira-mgr/core/display`, the Inbox at `@jira-mgr/core/inbox`, pickers (labels, users, field options) at `@jira-mgr/core/lookups`, and the ADF and Markdown converters at `@jira-mgr/core/adf`, so the renderer bundle never pulls in `node:` modules.

Its exported API is public to the other packages, so change it additively.

## Use

Other packages import it by name:

```ts
import { appTitle } from '@jira-mgr/core'
```

The `exports` map points at `src/index.ts`. The package has no build step: tsup and electron-vite bundle the source into each client.

## State Files

`readSettings`, `readViews`, `readTimer` and `readFields` (with matching `write` functions) own the non-secret state in `~/Library/Application Support/jira-mgr/`. Set `JM_STATE_DIR` to use another folder, as the tests do.

- A missing file yields defaults: starter views for `views.json` (My issues, Created by me, Current sprint, Active, Backlog), `null` for `timer.json` and `fields.json`.
- A file that is not valid JSON or fails its schema throws `JiraMgrError` with code `validation_failed`, and the message names the file. Writes validate first, then write a temp file and rename it.

### Project Guard

`assertInProject(key)` in `@jira-mgr/core/state` throws before any request when an issue key is outside the project in settings (`validation_failed`) or no project is set (`permission_denied`). Every client calls it before a write, so the CLI and the desktop app refuse the same keys.

### Saved Views

`@jira-mgr/core/state` manages `views.json`. Each call reads, changes and writes the whole file, so the app and the CLI writing at once can lose an edit.

- `findView(idOrName)` returns the view with that id, or failing that that name in any case. It throws `not_found` for an unknown view.
- `createView(name, { filters, toggles, display? })` returns the new view. Its id is the name as a slug (`Bugs this week` is `bugs-this-week`), with `-2`, `-3` and so on when taken.
- `renameView(idOrName, name)` keeps the id, filters, toggles and display.
- `updateView(idOrName, { filters, toggles, display? })` replaces a view's filters and toggles, and its display when one is given, and keeps its id, name and place.
- `duplicateView(idOrName)` copies a view, display included, to just after it, named `<name> copy`, then `<name> copy 2` and so on.
- `moveView(idOrName, toIndex)` moves a view to a zero-based position and returns the new order. A position outside the list throws `validation_failed`. The order is the array order in `views.json`, so a reorder rewrites the array and the file keeps its shape.
- `deleteView(idOrName)` allows deleting the last view. The next `readViews()` then returns `[]`, not the starters: once `views.json` exists, "My issues", "Created by me", "Current sprint", "Active" and "Backlog" are ordinary views. A starter added later reaches only users with no `views.json`.
- A name is trimmed, and an empty one or one that matches another view in any case throws `validation_failed`. Renaming a view to its own name in a new case is allowed.

### Inbox

`@jira-mgr/core/inbox` is Node-only. It owns `inbox.json` (`readInbox`, `writeInbox`), the unread rule and the search that feeds the Inbox. A missing file reads as `{ version: 1, allReadAt: "1970-01-01T00:00:00.000Z", reads: {} }`. The shape is in [Config](../../docs/reference/config.md#inboxjson).

- `readMark(inbox, key)` is the later of `allReadAt` and `reads[key]`. `isUnread(inbox, issue)` is true when the issue's `updated` is later.
- `withRead(inbox, key, updated, now)` and `withAllRead(inbox, through, now)` return the new state, pruned. `markRead` and `markAllRead` read the file, apply one of them and write it back. They take no lock, so the caller runs the writes one at a time, as the desktop app's main process does.
- `listInbox(http, { inbox, cache })` searches `project = "PSAPAC" AND (assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= -14d ORDER BY updated DESC` (`INBOX_DAYS`) and returns `{ issue, unread, change }` for each issue, newest first. For each issue past its read mark it reads `GET /rest/api/3/issue/{key}/changelog`, keeps the histories created after the mark by someone else, and names the newest: `Status: To Do to In Progress`, with `and N more` when the history changed more fields. A history carries no author when Jira made it, so it counts as someone else's. When no history qualifies it reads the newest comment (`orderBy=-created&maxResults=1`) and names it `Comment by <name>`, since a comment writes no history. The mark never reaches back past the window, so a change older than 14 days is not news even with no file. An issue whose changes since the mark are all the user's own, or that no history or comment explains, is read.
- A changelog longer than one page reads its last page, since Jira lists oldest first. Reads run five at a time. `createInboxCache()` holds what was read by issue key and `updated`, and the account id, so a poll of an unchanged issue sends no request beyond the search. A failed read is not cached. When Jira answers `not_found` or `permission_denied` for an issue's changelog or newest comment, that issue is listed as read and the rest of the Inbox stands; any other failure throws and fails the call. A key that is not an issue key is listed as read, with no request.

## Credentials

`@jira-mgr/core/auth` exports `login`, `logout` and `getCredentials`.

- `login({ siteUrl, projectKey, email, token })` accepts only an `https://<name>.atlassian.net` site with no path, port or userinfo. It checks the token with `GET /rest/api/3/myself` (no redirects), resolves the custom fields (see Field Resolution), then stores the token in the Keychain, `siteUrl`, `projectKey` and `email` in `settings.json`, and the ids in `fields.json`. A 401 or 403 throws `permission_denied`, and a field failure throws `validation_failed`; either stores nothing. It returns `{ accountId, displayName }` from the check's response, so a caller needs no second `/myself` call; a response without them throws `jira_error` and stores nothing.
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

- `path` must start with `/rest/` and hold no `..`, backslash or encoded dot before its query string, so the token only goes to the site. The query string is free to hold them, as a label search may. Redirects are refused.
- A plain `body` goes as JSON. A `FormData` body goes as multipart with `X-Atlassian-Token: no-check`. A 204 or empty body resolves to `undefined`. Any other body resolves to parsed JSON typed `unknown`, which the caller validates.
- A 429, or a 503 with `Retry-After`, waits that many seconds (at most 60) and retries, up to 3 times. A 429 with no header, or a zero, past or unreadable one, backs off 1, 2, then 4 seconds. `options.sleep` replaces the wait in tests, and the caller's `signal` cuts a wait short. Each attempt, body read included, times out after `timeoutMs` (30 000 by default). A failed write says it may have gone through. A GET or HEAD with a body is refused.
- 400 throws `validation_failed`, 401 and 403 `permission_denied`, 404 `not_found`, and everything else `jira_error`, including network failures, timeouts and spent retries. `details` holds `{ status, errorMessages, errors }` from the response body.
- `options.as` reads the answer another way. `requestBytes(http, method, path, { maxBytes })` resolves to `{ contentType, bytes }`: it sends `Accept: */*`, refuses a `Content-Length` over `maxBytes` before reading, and aborts a body that passes it, both with `validation_failed`. `requestMediaId(http, path)` is for `/rest/api/3/attachment/content/<id>` and no other path. It does not follow the redirect: it reads the Media Services file id from the `Location` (an `https:` URL on `api.media.atlassian.com` with `/file/<uuid>/` in its path) and resolves to the UUID alone, so the short-lived token in that URL never leaves the client. Any other redirect, or a 2xx, throws `jira_error` with no `cause` and no `details`. Both are helpers over `request`, so a test fake that implements only `request` keeps working.
- `JM_DEBUG=1` prints `jm http <METHOD> <path> <status> <ms>` to `stderr` for each attempt. It never prints headers, bodies or query strings.

## Issue Search

`@jira-mgr/core/search` exports `searchIssuePages`, `searchIssues`, `searchText` and `getIssue`. The `Issue` type, the `IssueDetail` type and the zod schema live in `@jira-mgr/core/issue`, which imports nothing from `node:`. The main entry re-exports the `Issue` type, so a renderer imports it from `@jira-mgr/core`. `/issue` also holds the pure rules every client applies to an issue:

- `propertyRules(issueType)` takes the issue's `{ name, subtask }` and says what the type shows: `sprint` for every type but an Epic or a Subtask (Q20), `estimates` and `parent` for every type but an Epic, and `typeChange` for a Story, Task or Bug (Q23). Time remaining (h) is under `estimates`, so it shows on a Task, Bug and Subtask as well as a Story: live edits accepted it on a Subtask, and Jira has the last word on the rest.
- `parentCandidates(issue, issues)` lists the issues `issue` may take as parent: Epics for a Story, Task or Bug, a Story, Task or Bug for a Subtask, nothing for an Epic.
- `assertTypeChangeAllowed(key, currentType)` throws `validation_failed` unless `currentType` is a Story, Task or Bug. The CLI and the desktop app call it after reading the issue, before they edit the type.
- `parseEstimate(text)` and `formatEstimate(seconds)` convert a Jira duration, assuming 8 hours to a day and 5 days to a week, and write hours and minutes alone, so a site with other working time shows the same hours it stores.

- `searchIssuePages(http, { pageSize, phases, signal })` is an async generator over `POST /rest/api/3/search/jql`, following `nextPageToken` until `isLast`. It reads the project from settings and the custom field ids from `getFieldIds()`, and requests only the fields `Issue` needs, never the description. It yields `{ phase, issues, loaded }`.
- `phases` (default both) names the phases to load. `['unresolved']` sends no request for Done issues, so a client that hides them halves the requests.
- Two phases run in order: `unresolved` (`statusCategory != Done`), then `done`. Each orders by `key DESC`. The key never changes, so an edit made mid-load cannot move an issue across a page boundary as `updated` would.
- `loaded` counts issues across both phases. Jira sends no total, so there is no percentage.
- `searchIssues(http, options)` collects every issue in load order.
- `searchText(http, text, { signal })` runs `project = <key> AND text ~ "<text>" ORDER BY updated DESC` once and returns at most 50 issues, so it matches the summary, description, comments and other text fields. It trims the text and refuses blank text or text over 200 characters with `validation_failed` before any request. It escapes Lucene operators (`+ - * ? ~ : "` and the like), so the text matches as typed, and quotes the JQL string, so the text cannot add a clause. Jira matches whole words, not word parts.
- `getIssue(http, key, { signal })` reads one issue with the same fields plus `description` (an ADF document, or `null`) and `subtasks` (`{ key, summary, status, done }`, the status as its name and `done` true when its status category is Done; `jm issue get` leaves `done` out). An unknown key throws `not_found`.
- `signal` goes to the HTTP client, so aborting stops the paging and rejects with the signal's reason.
- An issue that fails the schema, or a page that is not last but sends no token or repeats one, throws `jira_error`.
- `Issue` holds `id`, `key`, `summary`, `issueType`, `status` (with `category`), `resolution`, `parentKey`, `assignee`, `creator`, `labels`, `links`, `priority`, `customer`, `engagement`, `sprints`, `startDate`, `dueDate`, `originalEstimateSeconds`, `remainingEstimateSeconds`, `timeRemainingHours`, `created` and `updated`. `creator` is `{ accountId, displayName }`. `links` holds one `{ type, direction, key, category }` per issue link, the `type` a link type's name, the `direction` `inward` or `outward` as Jira sends it, and the `category` the linked issue's status category. Times are UTC ISO strings, and a value Jira leaves empty is `null` (`[]` for `sprints` and `links`).

## Hierarchy

`@jira-mgr/core/hierarchy` exports `buildHierarchy(issues, options)`. It is pure, has no `node:` imports, and returns plain data that survives IPC. Options: `hideDone`, `assigneeMe` and `hideEmptyCustomers` (the settings toggles), `accountId`, and optionally `customers`, the full Customer option list, and `match`, a view's filter predicate (see View Filters).

It returns `CustomerGroup[]`, each `{ customer, epics, noEpic }`, and `customer: null` is the "No Customer" group. A `HierarchyNode` holds `issue`, `children`, `doneChildren`, `doneCount`, `contextOnly` and `customerMismatch`.

- An Epic and its children sit under the Epic's Customer. A direct child whose own Customer differs gets `customerMismatch: { own, epic }`, where either side may be `null`. Subtasks nest under their parent and are never flagged.
- `noEpic` holds issues with no Epic parent in the input, and Subtasks whose parent is not in the input, under their own Customer.
- Under an open parent, Done children go to `doneChildren` whatever the toggles say. Under a Done parent they stay in `children`. `hideDone` drops a Done Epic or `noEpic` issue with its whole subtree, unless an open issue sits below it. A Done ancestor of an open issue stays as context (`contextOnly: true`), with or without `assigneeMe` or `match`, and its other Done children are dropped.
- `assigneeMe` and `match` keep the issues assigned to `accountId` and the issues `match` accepts (both, when both are set), plus their ancestors. An ancestor kept only as context has `contextOnly: true`.
- `hideEmptyCustomers: false` adds a group for every Customer in `customers`, and for every Customer whose issues the toggles hid.
- `STATUS_ORDER` is the status display order, exported so a client lists statuses in the same order.
- Customers sort case-insensitively, then No Customer, then "Collibra (Internal team)" and "Collibra (Internal template)". Epics sort by key descending. Children sort by status (Opportunity, To Do, In Progress, Review, Hold, Done, then any other), then key descending. That is `order: 'key'`, the default.
- `order` (`IssueOrder`: `key`, `priority`, `updated` or `due`) changes the sort of Epics, of children at every depth and of `noEpic`, never of the Customer groups. `priority` sorts highest first (by `priorityLevel`, so an issue with no priority or an unlisted name sorts last), `updated` newest first, and `due` soonest first with undated issues last. Ties fall back to the `key` rule for that list: key descending for Epics, status then key descending for the rest.

`@jira-mgr/core/display` is pure and holds `ROW_PROPERTIES` (`labels`, `sprint`, `due`, `created`, `updated`), `ISSUE_ORDERS`, their defaults (`updated`, `key`), `keepKnownProperties` and `priorityLevel`, the four-level rank the Tree's priority glyph and the `priority` order share. `settings.json` and a saved view hold them as `display: { properties, order }`; see [config](../../docs/reference/config.md#settingsjson). The schema reads leniently, so a value from a newer build drops or falls back and never fails the file.

## View Filters

`@jira-mgr/core/view-filter` is pure and imports nothing from `node:`. A view's `filters` select issues: values within a field are alternatives (OR), and every filtered field must match (AND). An absent or empty list, and a blank `text`, filter nothing.

- `issueMatcher(filters, { accountId, issues?, now? })` returns the predicate, or `undefined` when the filters select everything. `issues` is the loaded list, which `epic` reads to climb from a Subtask to its Epic; it may still be filling, and the matcher sees what has arrived. `now` sets "today" for the date filters and defaults to the current time.
- `filterIssues(issues, filters, { accountId })` returns the matching issues in input order.
- `filtersNeedMe(filters)` is true when `me` appears under `assignee` or `creator`, included or excluded, so a client knows to fetch the signed-in user first.
- `filters.not` lists values to leave out, per field, and an issue must hold none of them. The new filters and `not` are optional keys, so a `views.json` from before them parses unchanged; see [config](../../docs/reference/config.md#viewsjson).
- `applyViewToggles(settings.toggles, view)` returns the toggles to build the hierarchy with. The view's win, since a saved view always holds all three.

| Filter                       | Values                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assignee`                   | An accountId, or `me` (the `accountId` passed in) or `unassigned` in any case                                                                                                     |
| `creator`                    | An accountId, or `me`                                                                                                                                                             |
| `status`, `type`, `priority` | A name in any case, or an id                                                                                                                                                      |
| `statusType`                 | `new`, `indeterminate` or `done`                                                                                                                                                  |
| `customer`, `engagement`     | An option's name in any case, or its id                                                                                                                                           |
| `epic`                       | An Epic's key: the Epic and every issue under it                                                                                                                                  |
| `relations`                  | `blocked` or `blocking`: a "Blocks" link to or from an issue that is not Done                                                                                                     |
| `dates`                      | `due`, `created` and `updated`, each one window around today: `today`, `last-7-days`, `last-30-days` or `next-7-days`; `due` also takes `overdue`, an open issue due before today |
| `label`                      | A label, matched exactly because Jira labels are case-sensitive                                                                                                                   |
| `sprint`                     | A sprint id, a name in any case, or `current` (any case) for any sprint whose state is `active`. `current` wins over a sprint literally named "Current"                           |
| `text`                       | A case-insensitive substring of the key or the summary, after trimming                                                                                                            |

To show a view as a tree, pass the predicate to `buildHierarchy` as `match`, with no separate filtering pass. It works like "Assignee: me": the matching issues stay, with their ancestors as `contextOnly` context, so a matching Story keeps its Epic. Filtering first would orphan the Story into "No Epic". Leave `match` out when `issueMatcher` returns `undefined`, so an empty view hides exactly what the toggles hide.

## ADF and Markdown

`@jira-mgr/core/adf` exports `adfToMarkdown(adf)`, `markdownToAdf(markdown)`, the `adfDocSchema` and `adfNodeSchema` zod schemas, and the `AdfDoc`, `AdfNode` and `AdfMark` types. Both functions are pure and import nothing from `node:`, so the CLI and the renderer share them.

- `adfToMarkdown(adf)` takes `unknown`, validates it as an ADF document (`version: 1`, `type: 'doc'`, nodes with a string `type`, blocks and no inline nodes at the top level), and throws `validation_failed` when it is not one. It returns GFM Markdown.
- `markdownToAdf(markdown)` returns `{ version: 1, type: 'doc', content }`. Any text is Markdown, so it fails only on nesting.
- Either function throws `validation_failed` when the document is nested so deeply that reading it overflows the stack, as `>` repeated thousands of times does.
- **No-edit round trip.** `markdownToAdf(adfToMarkdown(doc))` deep-equals `doc` for any valid ADF, including node types and attrs core has never seen. `adfToMarkdown` checks this itself: it reads each top-level block's Markdown back, and writes a block that does not come back identical as an `adf` fence. Only keys on the document itself beyond `version`, `type` and `content` are dropped.

### Markdown Form

| ADF                                                                                                                                                                    | Markdown                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `paragraph`, `heading` 1-6, `rule`, `blockquote`                                                                                                                       | Paragraph, `#` headings, `---`, `>`                                                                                                         |
| `bulletList`, `orderedList` (`order`), nested `listItem`                                                                                                               | `-` and `N.` lists, numbered from `order`, nested by indent                                                                                 |
| `codeBlock` (`language`)                                                                                                                                               | Fenced block, fence longer than any backtick run inside                                                                                     |
| `table`                                                                                                                                                                | GFM table when every cell holds one paragraph and the rows are the same width. A table with no header row gets an empty Markdown header row |
| `hardBreak`                                                                                                                                                            | `\` and a newline, or `<br>` at the edge of a paragraph, beside another break, beside a space, and in headings and table cells              |
| marks `strong`, `em`, `code`, `strike`, `link` (`href`, `title`)                                                                                                       | `**`, `_`, backticks, `~~`, `[text](href "title")`                                                                                          |
| mark `underline`                                                                                                                                                       | `<u>text</u>`                                                                                                                               |
| `inlineCard` with only a `url`                                                                                                                                         | `<https://...>`                                                                                                                             |
| any other inline node: `mention`, `emoji`, `date`, `status`, `mediaInline`, an inlineCard with more attrs, unknown nodes                                               | `<adf-node data='{"type":"mention",...}'>@Tony</adf-node>`                                                                                  |
| a text node Markdown cannot say as it stands: other marks, marks with other attrs, a different mark order, spaces inside a mark                                        | the same `<adf-node>` tag, holding the whole text node                                                                                      |
| any other block: `panel`, `expand`, `mediaSingle`, `mediaGroup`, `layoutSection`, `taskList`, `decisionList`, `extension`, `blockCard`, a complex table, unknown nodes | an `adf` fence holding the node as one line of JSON                                                                                         |

The `<adf-node>` tag carries the node as JSON in `data`, with `<`, `>` and `'` written as `\u` escapes, and a readable label inside that the reader ignores. An `adf` fence holds the node as JSON. To change one, edit the JSON, or write the node to a file and pass `--adf <file>`.

### Editor Form

The desktop editor works on ProseMirror JSON, and core converts to and from it without importing TipTap. `@jira-mgr/core/adf` also exports `adfToEditor`, `editorToAdf`, `equivalentAdf`, `sameAdf`, `imageNode` and the `EditorDoc`, `EditorNode` and `EditorMark` types.

- `adfToEditor(doc, { accepts? })` maps paragraphs, headings, quotes, lists, code blocks, rules, a `mediaSingle` of one file (`adfImage`), `strong`, `em`, `strike`, `code`, `underline` and `link`. Every other block becomes one read-only `adfBlock`, every other inline node an `adfInline` and every other mark an `adfMark`, each holding the original ADF. Each top-level block is converted and converted back, and one that does not come back equivalent, or that `accepts` refuses, becomes an `adfBlock` of the original. So a block with a table or a panel inside a list is one read-only block, never a lossy one.
- The attributes the editor does not model (`localId`, block marks such as `alignment`, a link's `title`) ride in an `adf` attribute and are written back. A modelled attribute (`level`, `order`, `language`, `href`) overwrites its original, and `order` is written only when the list starts at other than 1 or already had one.
- `editorToAdf(doc)` returns the ADF, or `null` for a document holding only an empty paragraph. It throws `validation_failed` for an image still uploading (an `adfImage` with no `node`).
- `equivalentAdf(a, b)` is deep equality that ignores key order, how text splits into runs of the same marks, the order of marks and `content: []` against none. `sameAdf` is the plain key-order-blind equality.
- `imageNode({ mediaId, filename, width?, height? })` builds the centred `mediaSingle` Jira's own editor writes.
- Both directions throw `validation_failed` for a document nested past the stack. `@jira-mgr/core/test/adf-fixtures` exports every recorded ADF document for tests in other packages.

### Notes

An HTML comment `<!--adf TYPE {...}-->` at the end of a text block restores what Markdown cannot show of a node: attrs such as `localId`, block marks such as `alignment`, and spaces Markdown drops at the ends of the block (`head` and `tail`). `TYPE` names the node. A note sits on the first text line of the node it names, and a list item, list or quote takes the notes of its first child, so `1. text <!--adf paragraph {...}--><!--adf listItem {...}-->` carries a paragraph and an item. An empty paragraph is a line holding only its note. A table with no header row carries `"headerless": true` in a `table` note on the empty header row.

A block that needs a note but has no text line to hold it, such as a list item that starts with a code block, is written as a fence. A note naming a node that is not there is ignored.

Markdown is a trust boundary, so every note, tag and fence is validated when read. A note must be an object whose `attrs` is a record or `null`, `marks` a list of marks, `head` and `tail` strings, and `headerless` true; one that is not is dropped, with the space before it, as if it were not there. An `<adf-node>` tag must hold an inline node, so a `table` or `panel` cannot land in a paragraph, and an `adf` fence must hold a block node, so a `text` or `mention` cannot land in a document. One that does not stays as literal text, or as an ordinary code block, and nothing throws. A node type core has never seen passes either check, since it could be either kind. Markdown `<!-- -->` separates two lists of the same kind, which would otherwise merge.

### Reading Markdown

- Bare URLs, `www.` links and email addresses become `link` marks. `<https://...>` becomes an `inlineCard`.
- Images have no ADF form without an upload, so `![alt](url)` becomes the text `alt` linked to the URL.
- A task box `- [ ] x` keeps its box as text. HTML entities such as `&amp;` stay as written. HTML tags other than `<br>`, `<u>` and `<adf-node>` stay as text.
- A table gets `tableHeader` cells in its first row and `tableCell` cells after it, each with `attrs: {}`, and no table attrs.
- An `adf` fence holding a valid node becomes that node. One that does not stays a code block.

### Dependency

`marked` is a runtime dependency of core, used only for its lexer (`Lexer` with GFM). Core maps the tokens to ADF itself and never calls marked's HTML renderer. Writing a GFM block and inline parser by hand would cost more than the dependency: marked is MIT licensed, has no install scripts and no dependencies, and runs in a browser.

## Issue Writes

`@jira-mgr/core/write` exports `createIssue`, `editIssue`, `deleteIssue`, `listTransitions` and `transitionIssue`. It reads the project from settings and the custom field ids from `getFieldIds()`, so it is Node-only. Every function takes an `HttpClient` first and validates its input with zod before sending anything. Bad input throws `validation_failed` naming the field, and a Jira failure maps as in HTTP Client.

- `createIssue(http, input)` posts `POST /rest/api/3/issue`, then reads the new issue back with `getIssue` and returns it as an `IssueDetail`, so the caller sees what the PSAPAC automation changed after the create. When the create succeeds and the read fails, it throws `jira_error` with the new `{ key, id }` in `details` and the read error as `cause`. An optional third argument `{ signal }` aborts the create or the read; an abort after the create takes the same error path, so the key still surfaces. Required: `type` (`Epic`, `Story`, `Task`, `Bug` or `Subtask`), `summary`, `customerId` and `engagementId` (option ids, required on every type, Task and Bug included). A `Subtask` also needs `parentKey`. Core does not check fields per type: a field the type lacks, such as `timeRemainingHours` on a Bug, goes to Jira, whose 400 maps to `validation_failed` naming the field in the message and `details.errors`. Optional: `description` (ADF, validated with `adfDocSchema`; convert Markdown with `markdownToAdf`), `assignee` (account id), `priorityId`, `labels`, `startDate` and `dueDate` (`YYYY-MM-DD`), `originalEstimate` (a Jira duration such as `2h 30m`) and `timeRemainingHours`.
- `editIssue(http, key, input)` sends one `PUT /rest/api/3/issue/{key}` holding only the fields in `input`. It takes the create fields except `type`, plus `parentKey`, and `type` limited to `Story`, `Task` and `Bug` (Q23; any other type is refused). `null` clears `assignee`, `startDate`, `dueDate`, `description` and `timeRemainingHours`. `labels` replaces the labels; `addLabels` and `removeLabels` change some, and cannot be combined with `labels`. `originalEstimate` goes as `update.timetracking: [{ edit: { originalEstimate } }]`, so Jira keeps the remaining estimate. An edit with no fields, or only empty `addLabels` and `removeLabels`, is refused. Core does not read the current type, so an Epic or Subtask asked to become a Story goes to Jira, which answers 400 if it refuses.
- `deleteIssue(http, key, { deleteSubtasks })` sends `DELETE /rest/api/3/issue/{key}?deleteSubtasks=true|false`. The flag has no default: a call without a boolean is refused.
- `listTransitions(http, key)` reads `GET /rest/api/3/issue/{key}/transitions` and returns each move open to the issue as `{ id, name, to: { id, name, category } }`, where `category` is the target status category (`new`, `indeterminate`, `done` or `undefined`) or `null` when Jira sends none. A status picker lists the `to` of each.
- `transitionIssue(http, key, status)` reads the same transitions, picks the transition whose target status has that id or name (case-insensitive), posts it and returns the name of the status reached. A status the issue cannot reach throws `validation_failed` listing the ones it can, in `details.available`. The transition's own name is not matched: the recorded Epic transition 3 is named `REVIEW` and reaches `Review`.

Recorded `editmeta-*` and `transitions-*` fixtures for a Story, a Subtask and an Epic back the field shapes; a test checks that every field `editIssue` sends is settable on each type. Tests record the requests and never reach Jira.

## Issue Extras

Three subpaths cover the secondary operations. Each function takes an `HttpClient` first, validates its input with zod before any request, and validates every response, throwing `jira_error` on a shape it does not expect. Keys must look like `PSAPAC-12`, and comment, worklog, link, attachment and sprint ids must be digits, so no input can change a request path. A 403 from Jira, such as editing another user's comment or worklog (Q34), throws `permission_denied`.

### Comments, Worklogs, Links, Attachments

`@jira-mgr/core/extras`:

- `listComments`, `addComment`, `editComment` and `deleteComment`. Bodies are ADF: pass `markdownToAdf(text)` and render with `adfToMarkdown`. A comment is `{ id, author, body, created, updated }`, with UTC ISO times.
- `listWorklogs`, `addWorklog`, `editWorklog` and `deleteWorklog`. Every write sends `adjustEstimate=auto`, so Jira moves the remaining estimate by the time logged (Q11). `addWorklog(http, key, { timeSpent, started?, comment? })` takes a Jira duration such as `1h 30m` (decimals are refused), `started` as a `Date`, and an optional ADF comment. It sends `started` as UTC in Jira's `yyyy-MM-dd'T'HH:mm:ss.SSS+0000` form, since Jira rejects a `Z` suffix. Without `started` Jira uses the current time. `editWorklog` sends only the fields given.
- `listLinks(http, key)` returns `{ id, type, direction, issue: { key, summary, status } }` as seen from that issue. `direction` is `outward` when the issue reads "<this> <type.outward> <issue>" ("blocks") and `inward` for "is blocked by". `listLinkTypes` returns all of the site's types, 21 on PSAPAC, with nothing filtered.
- `addLink(http, { type: { name } | { id }, key, direction, otherKey })` reads as a sentence: `direction: 'outward'` with `Blocks` makes `key` block `otherKey`, and `'inward'` makes `key` blocked by `otherKey`. Jira answers 201 with no body, so find the new link's id with `listLinks`. `getLink(http, linkId)` reads one link by id (its type and the keys of both issues), and `removeLink(http, linkId)` removes by id. Jira's POST names the blocking side `inwardIssue`; core relies on that, and a live PSAPAC check confirmed it on 2026-10-07 (link 642179, created and deleted).
- `listAttachments`, `addAttachment(http, key, { filename, content, contentType? })`, `addAttachments(http, key, files)` and `removeAttachment`. `content` is a `Blob` or `Uint8Array`, so the CLI and the app both call it. The upload goes as multipart through the HTTP client. First it reads the site's `uploadLimit` from the attachment settings (100 000 000 bytes on PSAPAC), and a larger file, or a site with attachments off, throws `validation_failed` before any bytes are sent. `addAttachments` reads the limit once and refuses the whole batch before the first upload, uploads in order, and names the files already attached in the error when a later upload fails. Each upload gets a request timeout of 30 seconds plus 10 seconds per megabyte, through `RequestOptions.timeoutMs`. `contentType` makes the multipart part declare that type (`image/png`); without it the part is `application/octet-stream`.
- `attachmentMediaId(http, attachmentId)` returns the Media Services file id of an attachment, which is what a description's `media` node holds and the attachment responses omit. It reads the content redirect without following it (see HTTP Client). `attachmentContent(http, attachmentId, { maxBytes })` returns `{ contentType, bytes }` through `?redirect=false`, so the request stays on the site. The live test in `extras.live.test.ts` pins the redirect shape on PSAPAC; `attachment-content-redirect.json` is one recorded read (status 303 and the `Location`, token dropped) that the int tests replay.

### Sprints

`@jira-mgr/core/sprints`:

- `findBoard(http, projectKey?)` returns `{ id, name, type }` for the project's board (settings unless given), or `null`. Only a `scrum` or `simple` board counts, since a Kanban board has no sprints. A project with several of those gets the first one Jira lists.
- `listSprints(http, boardId, { all? })` returns `{ id, name, state, startDate, endDate }`, all pages. Without `all` it asks for `state=active,future`; with it, closed sprints come too. An undated sprint has `null` dates. The Q20 picker rule (dated future sprints first, undated behind "Show all") is the client's: core returns what Jira lists.
- `getSprint(http, sprintId)` returns one sprint with its `goal` (`null` when empty). The goal is not on `listSprints` rows, so `jm sprint list --json` keeps its shape; the other fields match the list's for the same sprint.
- `listSprintIssues(http, sprintId)` reads `GET /rest/agile/1.0/sprint/{id}/issue` page by page, validated as `Issue`, with the fields `searchIssues` asks for. It reads only.
- `sprintStats(issues)` counts a sprint: `scope` (every issue), `started` (status category In Progress) and `completed` (status category Done), and breakdowns `assignees`, `labels`, `priorities`, `customers` and `engagements`. A group holds `total`, `completed` and `percent`, which the app writes as "N% of M". The issues with no value form one group, last. `readSprint(http, sprintId)` gives `{ sprint, issues, stats }`.
- `moveToSprint(http, sprintId, keys)` moves issues into a sprint through the Agile sprint endpoint, and `moveToBacklog(http, keys)` moves them out through the Agile backlog endpoint. Each takes 1 to 50 keys, Jira's limit.

### Pickers

`@jira-mgr/core/lookups`:

- `suggestLabels(http, prefix)` returns label names from Jira's autocomplete. Jira suggests from every project on the site, so a client wanting only project labels filters further. The prefix is percent-encoded.
- `searchAssignableUsers(http, query, { projectKey? })` returns active users assignable in the project as `{ accountId, displayName, avatarUrl }`, at most 50, and drops the email address.
- `getCurrentUser(http, { signal? })` returns `{ accountId, displayName }` for the account the token authenticates as, from `GET /rest/api/3/myself`. A 401 throws `permission_denied`.
- `getFieldOptions(http, field)` returns `{ id, name }[]` for `customer`, `engagement`, `priority`, `issueType` or `status`. Customer, Engagement and Priority come from the project's create metadata, so Priority lists the project's 11 priorities, not the site's 20. `status` lists each status of the project once.

Recorded fixtures back every response mapping: `comments-psapac-666`, `worklogs-psapac-666`, `issue-links-psapac-666` and `-664` (the same link seen from both ends), `issue-attachments-psapac-3017`, `issuelinktype`, `attachment-meta`, `board-psapac`, `board-sprints-active-future`, `board-sprints-all`, `label-suggestions`, `assignable-users`, `project-statuses` and `myself`. Tests record each request's method, path, query and body, and never reach Jira.

## Timer

`@jira-mgr/core/timer-calc` is pure (no `node:` imports, so the renderer can use it). `@jira-mgr/core/timer` is the Node-only engine over `timer.json`.

### Engine

Every function takes `{ now?, lock? }`: `now` is the clock (tests pass a fixed one), `lock` tunes the wait.

- `startTimer(issue, { switch?, expectRunning? })` takes `{ key, issueType: { name } }`, so an `Issue` works. Only Task, Bug, Story and Subtask can be timed (Q56); anything else throws `validation_failed` before the file is read. It returns `{ timer, stopped }`.
  - Nothing running: starts, `stopped` is `null`.
  - The same issue already runs: no-op. If it is paused, it resumes.
  - Another issue runs: throws `validation_failed` with `details.runningIssueKey`, unless `switch: true`. Then one write stops that timer and starts the new one, and `stopped` holds the old timer's draft (Q50). That draft is the only record of the old timer, so use `switchAndLog` when the old time is to be logged, and `startTimer` with `switch` only to discard it.
  - `expectRunning` is the issue key the caller showed the user. If a different timer runs, it throws `validation_failed` with `details.runningIssueKey` and `details.expectedIssueKey`. No timer running passes.
- `stopTimer({ expectRunning? })` clears the timer and returns a `WorklogDraft`, or `null` when idle. `expectRunning` is as in `startTimer`.
- `pauseTimer()` and `resumeTimer()` close or open a segment and return the timer. Pausing a paused timer and resuming a running one change nothing. Both throw `not_found` when idle.
- `stopAndLog(http, { comment?, timeSpent?, expectRunning?, confirm?, signal? })` stops the timer and logs it with `addWorklog` (`started` from the draft, `timeSpent` from the draft or the override), for the stop dialog and `jm timer stop` (Q51). It returns `{ draft, worklog }`, or `null` when idle. `comment` is ADF and `timeSpent` a Jira duration, both checked before the timer stops, so bad input throws `validation_failed` and the timer keeps running. `expectRunning` is as in `startTimer`, and a different running timer stops nothing. It is required whenever `timeSpent` is given, so an adjusted time never lands on a timer the user did not see. There is no `started` override: a worklog always starts at the timer's first segment. A draft with `needsConfirmation` throws `validation_failed` with `details.draft` and stops nothing, unless `confirm: true` (the user accepts the draft as is) or `timeSpent` is given (the user chose the time). The check runs under the lock on the draft being taken, so the clock cannot pass midnight between a caller's own check and the stop. `signal` is passed to the worklog request: an abort fails it, and the timer comes back paused like any failed log. An already aborted signal throws before anything stops.
- `switchAndLog(http, issue, { comment?, timeSpent?, expectRunning?, confirm?, signal? })` (`timeSpent` again needs `expectRunning`; `confirm` and `signal` apply to the old timer as in `stopAndLog`, and a timer already on `issue` needs no confirmation) checks the issue and the log input, stops the running timer, logs it, then starts the timer on `issue`. It returns `{ timer, stopped, logged }`, with `stopped` and `logged` `null` when nothing was running or the issue already runs.
- `restoreTimer(timer)` writes a stopped timer back with every segment closed (paused), only when `timer.json` is empty, and returns whether it did.

The engine makes no HTTP call itself; `stopAndLog` and `switchAndLog` take the client. Tracked time is never dropped: when `addWorklog` fails for any reason (401, network, 5xx), the timer goes back paused through `restoreTimer`, and `switchAndLog` does not start the new timer. Between taking the timer off `timer.json` and the log finishing, the time lives only in memory: a SIGKILL, a power loss, or a second Ctrl-C during the restore (the first only aborts the request) loses it (a known limit of the C12 design, which keeps `timer.json` clear while the request runs). Ctrl-C does not: pass `signal` and the timer is restored. The error keeps Jira's code (`internal` for a non-Jira failure) and says `The timer is paused on KEY; stop the timer again.` with the `started` time. `details` holds `{ draft, timer, restored }`. If someone started another timer meanwhile, nothing is overwritten: `restored` is `false` and the message tells the user to log by hand. A `jira_error` or `internal` failure may follow a request that got through (a timeout, or a 2xx with a body core cannot read), so its message adds `Check KEY's worklogs before retrying.` and a retry may log twice. When `switchAndLog` logs the old timer and the start is then refused, the message says the old issue's time was logged and `details.logged` holds `{ draft, worklog }`.

The app's switch dialog (Q59): read the timer, show `worklogDraft(timer, settings.timer, new Date())` and remember its issue key. On confirm call `switchAndLog(http, issue, { expectRunning: shownKey, timeSpent, comment, confirm: true })`, which logs exactly the draft of the timer it stopped, so a timer the CLI changed meanwhile is refused instead of logged wrongly. On discard call `startTimer(issue, { switch: true, expectRunning: shownKey })` and drop `stopped`.

The app's stop dialog works the same way: show `worklogDraft(...)` for the running timer and remember its issue key, then on confirm call `stopAndLog(http, { expectRunning: shownKey, timeSpent, comment, confirm: true })` (`confirm` matters only when the shown draft needs confirmation and the user kept its time). If the CLI switched to another issue meanwhile, the call throws `validation_failed` and the user's adjusted time is not logged anywhere. If the CLI stopped the timer, the call returns `null`: nothing was logged, because the timer was already stopped elsewhere. On discard there is nothing to log: call `stopTimer({ expectRunning: shownKey })`.

### Draft

`WorklogDraft` is `{ issueKey, started, seconds, timeSpent, needsConfirmation }`. `started` is the first segment's start as a UTC ISO string (pass `new Date(started)` to `addWorklog`). Paused time is excluded.

- Rounding follows `timer.rounding` (default `5m`): nearest step, exact halves up, one step minimum (7m to 5m, 8m to 10m, 7m30s to 10m, 2m to 5m). `none` rounds to whole minutes with a one-minute minimum. `timeSpent` uses hours and minutes only, such as `1h 5m`, so a long timer never turns into days.
- `needsConfirmation` is true when the running total is over `reminderThresholdHours` (default 8, exactly 8h does not count), or when the first segment's start and the stop moment fall on different dates in the machine's local time, paused or not, because one worklog dated day 1 would hold day 2's work. Stopping exactly at midnight counts as the next date.
- `reminderDue(timer, settings.timer, now, lastReminderAt)` is true once the running total passes the threshold and no notice has gone out since it did, then again each `reminderIntervalMinutes` after `lastReminderAt` (`null` before the first notice). A paused or absent timer is never due. The app keeps `lastReminderAt` in memory.
- `elapsedMs(timer, now)` gives the running time for the row, page and sidebar displays.

### Concurrency

The app and the CLI both write `timer.json`, so each operation runs under an exclusive lock, `timer.json.lock` beside it. The lock is a file linked into place with its pid and time, so another writer sees it whole or not at all. A writer waits up to `lock.waitMs` (5000), polling every `pollMs` (10), then throws `internal` naming the file. Each attempt stamps the lock with the current time, so a lock taken after a long wait is never stale on entry. A lock is abandoned when its pid is dead, its time is older than `staleMs` (10000), or the file is unreadable; the next writer removes it by renaming it away, and links it back if the file it took was a lock acquired after the check. A holder only removes a lock that is still its own.

## Test

```
pnpm --filter @jira-mgr/core test
```

Vitest runs `<file>.test.ts` beside the source. `pnpm test:live` sets `JM_LIVE_JIRA=1`, the opt-in for tests that read the live PSAPAC Jira. Tests never write to Jira. Integration tests run against an MSW fake fed by the recorded PSAPAC responses in `fixtures/`, served through `test/msw.ts`, which the CLI imports as `@jira-mgr/core/test/msw`, with `@jira-mgr/core/test/setup` as its shared Vitest setup file.

Set `JM_LIVE_KEYCHAIN=1` on macOS to run `auth.live.test.ts`, one test against the real `security` binary, using a throwaway service name it deletes afterwards.

## Record a Fixture

```
pnpm fixture:record -- <name> <GET|POST> <path> [json-body]
```

`scripts/record-fixture.ts` reads `JM_JIRA_SITE`, `JM_JIRA_EMAIL` and `JM_JIRA_TOKEN` from the environment and saves the response body, pretty-printed, to `fixtures/<name>.json`. It never saves headers. It refuses a site that `parseSiteUrl` rejects before it sends the token, allows any `GET`, allows `POST` only to `/rest/api/3/search/jql`, and refuses every other write.
