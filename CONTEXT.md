# jira-mgr Domain

The words jira-mgr's code, CLI, UI and docs use. Use the **term**, not the *avoid* words. The [product grilling](docs/discovery/2026-10-07-product-grilling.md) defines each term; where this page and that record differ, the record wins and this page is fixed.

## Site and Access

| Term | Meaning | Avoid |
|---|---|---|
| **Site** | The Jira Cloud site the app talks to, such as `engineering-collibra.atlassian.net`. | instance, server |
| **Project** | The one Jira project the app manages, such as PSAPAC. Switching project means logging in again. | space, board |
| **API token** | The Jira credential entered at login and held in the app's own macOS Keychain item. | password, key |
| **Login** | Entering site URL, project key, email and API token, in the app or with `jm auth login`. | sign-in, connect |
| **Settings file** | The local file holding overrides, such as custom field ids. | config (for the file) |
| **Field resolution** | Looking up Customer, Engagement, Sprint and Start date by name in the project's create metadata, then caching the ids. | field mapping |

## Issues

| Term | Meaning | Avoid |
|---|---|---|
| **Issue** | The unit of work. Issues nest through a parent. | ticket, item |
| **Epic** | An issue that groups Stories, Tasks and Bugs. | initiative |
| **Story**, **Task**, **Bug** | The issue types that sit under an Epic. Type changes among them are allowed if Jira accepts them. | |
| **Subtask** | A child of a Story, Task or Bug. The desktop app's "Add sub-issue" and "Create sub-issue" make one. | child task |
| **Customer** | The required field naming the customer an issue serves. Every issue type carries one. | client, account |
| **Engagement** | The required field naming the workstream. | project |
| **Status** | A state an issue sits in. The order is Opportunity, To Do, In Progress, Review, Hold, Done. | state, column |
| **Sprint** | A Jira sprint an issue moves into or out of. Hidden on Epics and Subtasks. Closed and undated sprints sit behind "Show all". | iteration, cycle |
| **Link** | A relation between two issues, of one of Jira's 21 link types. | dependency (unless the type is Blocks) |
| **Worklog** | A time entry on an issue. Created by hand or by stopping a Timer. Task, Bug, Story and Subtask take worklogs, Epics do not. | time log, timesheet |
| **Timer** | The one running clock, on one issue, kept in a state file the app and `jm timer` share. It can pause and resume, and stopping it logs one Worklog with paused time excluded. | stopwatch, tracker |
| **Rounding step** | The unit a Timer's elapsed time rounds to: none, 5m or 15m, default 5m. It rounds to the nearest step, with one step as the minimum. | increment, granularity |
| **Attachment** | A file on an issue, up to 100 MB. | upload |

## Tree and Views

| Term | Meaning | Avoid |
|---|---|---|
| **Tree** | The list's hierarchy: Customer, then Epic, then Story, Task or Bug, then Subtask, in collapsible groups. | board, outline |
| **Customer group** | A top-level tree group for one Customer. Sorted alphabetically, with the two Collibra internal groups last. | folder |
| **No Epic group** | The group under a Customer for stories without an Epic. | orphans, unparented |
| **Mismatch badge** | The mark on a child whose Customer differs from its Epic's, with a one-click fix that copies the Epic's Customer. | warning |
| **Done chip** | The "N done" chip under an open parent that reveals its hidden Done children. | |
| **Hide done** | The toggle that hides Done parents with their whole subtree, except a Done parent of an open issue, which stays as dimmed context. On at first launch. | archive |
| **Row property** | A field a Tree row shows after its title, chosen from the Display menu: labels, sprint, due date, created date or updated date. Updated shows by default. The priority glyph is not one: it shows when the priority is not Medium. | column, field |
| **Order** | How issues sort within an Epic, among an Epic's children and in No Epic: by key, priority, updated or due date. Customer groups keep their own order. A saved view may carry its row properties and order. | sort, rank |
| **Saved view** | A named filter and set of toggles, and optionally its row properties and order, you create, update with the current filters, duplicate, rename, reorder and delete, stored as local JSON that the CLI also reads. The array order is its place in the sidebar and the tabs over the list. | filter, query |
| **Creator** | The person who created an issue. The Filter menu and a saved view's `creator` filter use it. | reporter, author |
| **Relations** | The Filter menu's field for Link state: Blocked (a "Blocks" link into the issue from one not Done) and Blocking (one out of it). | dependencies |
| **Is not** | The operator that leaves out the issues holding a value. A saved view stores it under `not`. | exclude, negate |
| **Overdue** | An open issue with a due date before today. | late |
| **Palette** | The Cmd+K menu: the issue in context and its actions, saved views, a search over loaded issues, and Jira text search below them. | command bar, omnibox |
| **Inbox** | The sidebar page listing the issues the user is assigned to, reported or watches that changed in the last 14 days, each marked read or unread, with a badge in the sidebar. | notifications, activity feed |
| **Read mark** | The `updated` time of an issue when the user opened it, kept in `inbox.json`. An issue is unread when it changed after its read mark, or after the Inbox-wide mark set by Mark all read, and someone else made the change. | seen, last looked |
| **Peek** | The space-bar preview of an issue. | quick view |
| **Issue page** | The full page of one issue, opened with Enter: summary, description and subtasks beside the properties sidebar. | detail view |
| **Sprint page** | The page of one sprint, opened from the sidebar's Current and Upcoming entries or the Sprint row of an Issue page: its issues by status beside the dates, goal, counts and breakdowns. | cycle page |
| **Scope, Started, Completed** | The Sprint page's counts. Scope is every issue in the sprint, Started the issues whose status category is In Progress, and Completed the issues whose status category is Done, whatever the status is called. A breakdown row reads "N% of M": M issues share a value, and N percent of them are Completed. | done count |
| **Properties sidebar** | The right column of the Issue page. Each property is a picker or a field that edits at once and rolls back if Jira refuses. | inspector |
| **Customer prompt** | The question the parent picker asks when a new parent's Customer or Engagement differs: also set them to the parent's? | |
| **Read-only block** | Content the description editor shows but cannot edit, such as a panel, a table or a macro, kept as the original ADF and saved unchanged. | unsupported node, macro |
| **Draft** | Unsaved description text, kept for the session until it is saved or discarded. | autosave |
| **Undo stack** | The session's list of field edits, reverted newest first by writing the previous value back. | history |

## Code

| Term | Meaning | Avoid |
|---|---|---|
| **Core** | `@jira-mgr/core`, the package that holds the Jira client and domain rules. | sdk, lib, api |
| **`jm`** | The CLI binary. Commands read `jm <noun> <verb>`. | |
| **Command schema** | The one definition that drives `--help`, `jm help --json` and `docs/reference/cli.md`. | |
| **Fake** | The MSW server that `core` tests run against, fed by recorded PSAPAC responses. | mock server |
| **Live test** | A read-only test against real PSAPAC, run only with `JM_LIVE_JIRA=1`. | integration test |
