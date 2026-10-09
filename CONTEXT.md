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
| **Subtask** | A child of a Story, Task or Bug. | child task |
| **Customer** | The required field naming the customer an issue serves. Every issue type carries one. | client, account |
| **Engagement** | The required field naming the workstream. | project |
| **Status** | A state an issue sits in. The order is Opportunity, To Do, In Progress, Review, Hold, Done. | state, column |
| **Sprint** | A Jira sprint an issue moves into or out of. Hidden on Epics, which have no Sprint field. Closed and undated sprints sit behind "Show all". | iteration |
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
| **Saved view** | A named filter you create, rename and delete, stored as local JSON that the CLI also reads. | filter, query |
| **Palette** | The Cmd+K search over commands and loaded issues. | command bar, omnibox |
| **Peek** | The space-bar preview of an issue. | quick view |
| **Issue page** | The full page of one issue, opened with Enter: summary, description and subtasks beside the properties sidebar. | detail view |
| **Properties sidebar** | The right column of the Issue page. Each property is a picker or a field that edits at once and rolls back if Jira refuses. | inspector |
| **Customer prompt** | The question the parent picker asks when a new parent's Customer or Engagement differs: also set them to the parent's? | |
| **Undo stack** | The session's list of field edits, reverted newest first by writing the previous value back. | history |

## Code

| Term | Meaning | Avoid |
|---|---|---|
| **Core** | `@jira-mgr/core`, the package that holds the Jira client and domain rules. | sdk, lib, api |
| **`jm`** | The CLI binary. Commands read `jm <noun> <verb>`. | |
| **Command schema** | The one definition that drives `--help`, `jm help --json` and `docs/reference/cli.md`. | |
| **Fake** | The MSW server that `core` tests run against, fed by recorded PSAPAC responses. | mock server |
| **Live test** | A read-only test against real PSAPAC, run only with `JM_LIVE_JIRA=1`. | integration test |
