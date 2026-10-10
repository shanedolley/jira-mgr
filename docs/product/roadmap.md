# Roadmap

Three milestones, built in order: Core, CLI, Desktop. Each item becomes one GitHub issue and one pull request. Decisions cited as Q numbers live in the [product grilling](../discovery/2026-10-07-product-grilling.md).

## Core

`@jira-mgr/core`: everything both front ends share. No Electron, DOM or React imports ([ADR-0001](../adr/0001-shared-core-monorepo.md)). Tests run against the MSW fake; live reads run only under `pnpm test:live`.

| Id | Item | Done when | Needs |
|---|---|---|---|
| C1 | Test harness | MSW installed; `packages/core/scripts/record-fixture.ts` saves response bodies (never headers) to `packages/core/fixtures/`; a first recorded PSAPAC search and createmeta load in a test | - |
| C2 | State files | Paths under `~/Library/Application Support/jira-mgr/`; `settings.json`, `views.json`, `timer.json`, `fields.json` read and written with validation at load; a corrupt file yields a `validation_failed` error naming it | - |
| C3 | Credentials | Keychain read and write through `/usr/bin/security`, writes over `security -i` stdin ([ADR-0003](../adr/0003-token-in-own-keychain-item.md)); login verifies against `/rest/api/3/myself`; logout removes the item | C2 |
| C4 | HTTP client | Basic auth, JSON and multipart, `429` with `Retry-After` honoured, HTTP status mapped to `JiraMgrError` codes, `JM_DEBUG` logging with the auth header redacted | C1, C3 |
| C5 | Field resolution | Customer, Engagement, Sprint, Start date and Time remaining (h) resolved by name from createmeta across every issue type; missing or ambiguous names fail login; overrides from `settings.json` ([ADR-0004](../adr/0004-custom-fields-resolved-by-name.md)) | C2, C4 |
| C6 | Issue search | Token-paged `search/jql` into a domain `Issue`; unresolved first, Done second; running count without a total | C5 |
| C7 | Hierarchy | Pure function: Customer, Epic, Story/Task/Bug, Subtask tree; Customer mismatch flag; "No Epic" group; Done children of an open parent collapsed to a count; "Hide done", "Assignee: me" and empty-Customer toggles; Customer sort with internal last (Q15, Q17, Q27-Q29) | C6 |
| C8 | Views and search | Saved view model and filter evaluation (assignee, status, label, type, sprint, text on key and summary); starter views "My issues" and "Current sprint" (Q30, Q37) | C2, C7 |
| C9 | ADF and Markdown | ADF to Markdown and back for the CLI; nodes Markdown can't express survive a no-edit round trip | C1 |
| C10 | Issue writes | Create with Customer and Engagement required on every type; edit summary, description, assignee, priority, dates, labels, parent, Customer, Engagement, original estimate, Time remaining (h), type within Story, Task and Bug; delete with an explicit subtask flag; status change by transition (Q14, Q23, Q9) | C5, C9 |
| C11 | Issue extras | Comments add, edit, delete; worklogs add, edit, delete with auto-adjusted remaining estimate; links add and remove across all 21 types; attachments add and remove; sprint set; label suggestions; assignable user search; field options | C10 |
| C12 | Timer engine | Shared `timer.json`; start, stop, pause, resume with segments; switching stops the running timer first; rounding none, 5m or 15m to the nearest step, one step minimum; threshold and midnight checks; Task, Bug, Story and Subtask only (Q49-Q59) | C2, C11 |

## CLI

`jm`: every Core operation, for people and agents.

| Id | Item | Done when | Needs |
|---|---|---|---|
| L1 | Command schema | One schema drives `--help`, `jm help --json` and `scripts/gen-reference.ts` (`pnpm docs:reference` writes `docs/reference/cli.md`); TTY tables, JSON when piped or `--json`; exit codes 0, 2, 3, 4, 5. Design doc first | Core |
| L2 | Auth | `jm auth login`, `status`, `logout` | L1, C3, C5 |
| L3 | Reading | `jm issue list` (with `--view`, `--search` and filters), `get` (Markdown description), `tree`; `jm field options <field>`; `jm link types`; `jm sprint list` | L2, C7, C8, C9 |
| L4 | Writing | `jm issue create`, `edit`, `delete` (`--confirm`, `--with-subtasks`); `jm status set`; Markdown in, `--adf <file>` for raw ADF | L3, C10 |
| L5 | Extras | `jm comment`, `jm worklog`, `jm link`, `jm attach`, `jm sprint set` | L4, C11 |
| L6 | Timer | `jm timer start`, `stop` (`--comment`, `--discard`), `status`, `pause`, `resume` | L5, C12 |
| L7 | Live check | `docs/runbooks/` smoke checklist run against PSAPAC; every command exercised once and the result recorded | L6 |

## Desktop

The Linear-style app. The renderer reaches Jira only through main-process IPC.

| Id | Item | Done when | Needs |
|---|---|---|---|
| D1 | Shell | Typed IPC bridge to Core; login screen; sidebar, list and detail layout; dark and light themes; TanStack Query with refetch on focus and optimistic updates ([ADR-0002](../adr/0002-live-fetch-without-replica.md)) | CLI |
| D2 | Issue tree | Virtualised tree list from C7 with collapsible groups, mismatch badges, "N done" chips, toggles, filter bar, `J`/`K` navigation and space-bar peek; Done issues load in the background. Design doc first | D1 |
| D3 | Issue page | Full page with properties sidebar and every picker: status, assignee (me and recent first), labels, sprint, parent with the Customer prompt (Q16), Customer, Engagement, dates, estimates, priority, type | D2 |
| D4 | Editor | TipTap with ADF round trip; unknown nodes kept as read-only blocks; image drop embeds inline ([ADR-0005](../adr/0005-tiptap-editor-with-adf-round-trip.md)). Design doc first | D3 |
| D5 | Activity | Comments, worklogs, links and attachments on the issue page. An Attachments section at the bottom lists files of any type with download, and a file dropped on its "Attach file to issue" zone attaches (the zone lights up with the description's during a drag) | D4 |
| D6 | Create and delete | `C` create modal with prefill and "Create more"; delete modal listing subtasks | D3 |
| D7 | Keyboard | `Cmd+K` palette with issue search; `S`, `A`, `L`, `P`, `E`, `Esc` shortcuts; `Cmd+Z` undo of field edits with toast | D3 |
| D8 | Saved views | Create, rename and delete views in the sidebar, shared with the CLI | D2 |
| D9 | Timer | `T` start and stop; elapsed time on row, page and sidebar; stop and switch dialogs; long-timer confirmation; reminder notifications while the app runs | D5 |
| D10 | Packaging | `pnpm package` builds an unsigned local `.app`; install steps in `docs/how-to/` | D1 |
| D11 | Click to edit summary | Clicking the summary on the issue page edits it in place with the existing optimistic edit and undo; Enter or blur saves, `Esc` cancels, and the Edit summary button goes. Issue #83 | D3, D7 |
| D12 | Issue type icons | A coloured icon for Epic, Story, Bug, Task and Subtask before the key on Tree rows, the Peek, the issue page header, the palette and the parent picker, as inline SVG with an accessible name. Issue #85 | D3 |
| D13 | Profile images | Jira profile images beside users in the Tree, Peek, page, assignee picker and sidebar, with initials as the fallback. Main fetches the images under strict rules, so it gets a security review. Issue #86 | D3 |

## Working Rules

- One issue, one branch, one pull request with `Refs #n`; merge on green CI.
- A reviewer other than the builder signs off each pull request.
- Write the design doc for L1, D2 and D4 before their code.
