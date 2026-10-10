# Linear Gap Analysis

**Date:** 2026-10-10
**Feeds:** Story #120, which of Linear's functions jira-mgr should build next

Compares what a Linear user can do with what jira-mgr does, to find gaps worth filling for one Jira project, PSAPAC. jira-mgr status comes from the code and docs at `origin/main` on the run date; the app was not launched.

## Summary

jira-mgr covers the issue core: create, edit every property, comments, worklogs, links, attachments, the timer, undo, the Peek and saved views. The gaps sit around the list, not the issue page.

- **The list shows and filters too little.** Rows carry type, status, key, summary, assignee and type name only. Priority, labels, due date and sprint are loaded but never shown. The Filter menu has five fields and no Customer, Engagement or Priority, although Customer is the Tree's top level.
- **No way to act on many issues.** The Tree has one active row and no selection, so moving ten issues into a sprint takes ten trips. Linear's `X`, `Shift`+click and bulk bar have no counterpart.
- **The command menu searches and does nothing else.** Linear's `Cmd+K` runs actions on the issue in context. `docs/reference/shortcuts.md` records that the Palette lists no commands.
- **Sprints are a field, not a place.** Linear's cycle page groups the issues of one cycle with progress. PSAPAC has 106 sprints on its board and no page for one.
- **Nothing tells the user what changed.** There is no Inbox, no activity feed on the issue page, no blocked badge on rows and no search of descriptions or comments.
- **Deliberately absent, and still right to skip:** initiatives, SLAs, triage, Asks, customer requests, agents, coding sessions, integrations, administration and importers. Jira cannot back most of them for PSAPAC, or the Customer field and the CLI already cover them.

The matrix lists 72 rows in 7 areas: 8 Have, 25 Partial and 39 Missing. 18 rows are Build, 15 Later and 39 Skip. The 18 Build rows map to the 13 stories ranked below.

## Reading the Matrix

| Column | Meaning |
|---|---|
| Status | Have, Partial or Missing, with a file, doc or screenshot as evidence. Paths are repository paths. |
| Jira | The Jira equivalent and whether the REST API can back it for PSAPAC. `[J1]` to `[J10]` point at Jira References, `F:` names a recorded fixture under `packages/core/fixtures/`. "Live check" marks a claim that needs one and that no run here made. |
| Value | H, M or L for a PSAPAC consultant working 764 open issues. |
| Effort | S under two days, M under a week, L longer, for one pull request with tests and docs. |
| Call | Build, Later or Skip. Skip also marks a feature already built. |

Where the roadmap or the [product grilling](2026-10-07-product-grilling.md) puts a feature out of scope, the row says so with its Q number.

## Getting Started

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Concepts: workspace, team](https://linear.app/docs/conceptual-model) | Have. One Site and one Project per login (`CONTEXT.md`, Q36) | Project is the team. Switching means logging in again | L | S | Skip. Multiple teams are out of scope (Q36) |
| [Download Linear: desktop, mobile, offline](https://linear.app/docs/get-the-app) | Partial. macOS only, live fetch, no offline (ADR-0002, Q7, Q13) | Client concern; Jira has no offline API | L | L | Skip. Out of v1 |
| [Start Guide](https://linear.app/docs/start-guide) | Partial. A login screen and no tour (`apps/desktop/src/renderer/src/LoginScreen.tsx`) | None needed | L | S | Skip. One user knows the app |

## Intake

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Triage](https://linear.app/docs/triage) | Missing | Jira has no triage state. The nearest is JQL `status = "To Do" AND assignee is EMPTY` [J1], statuses in `F:project-statuses.json` | L | M | Skip. The PS team creates its own issues and PSAPAC automation rewrites them (`apps/desktop/README.md`, Create and Delete) |
| [Triage Intelligence](https://linear.app/docs/triage-intelligence) | Missing | None. Linear's AI | L | L | Skip |
| [Linear Asks](https://linear.app/docs/linear-asks) (and Slack, email, web forms) | Missing | Request intake needs Jira Service Management. PSAPAC is a software project (`F:board-psapac.json`, `projectTypeKey`) | L | L | Skip |
| [Customer Requests](https://linear.app/docs/customer-requests) | Partial. Customer is a required field and the Tree's top group (`CONTEXT.md`); no request records | Customer is a single select, `customfield_14849` (round 2). Jira has no request object | M | M | Skip. A Customer filter closes the practical gap (story 1) |

## Projects and Initiatives

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Projects](https://linear.app/docs/projects): list, progress, details | Partial. Epics are Tree groups with a child count (`TreeRow.tsx`) and open as pages; no progress, lead or dates | Epic and children through `parent`, already loaded (`packages/core/src/search.ts`, `hierarchy.ts`). Start and due date are loaded fields | H | S | Build. Epic progress (story 6) |
| [Project priority](https://linear.app/docs/project-priority), [status](https://linear.app/docs/project-status), [labels](https://linear.app/docs/project-labels) | Have. An Epic takes Status, Priority and Labels on its page (`IssueProperties.tsx`) | Native Epic fields | M | S | Skip. Built |
| [Project milestones](https://linear.app/docs/project-milestones) | Missing | Fix versions is the nearest (`F:createmeta-story.json`) and is out of v1 (Q22) | L | M | Skip |
| [Project dependencies](https://linear.app/docs/project-dependencies) | Partial. Blocks links work on any issue, Epics included (`LinksSection.tsx`); no dependency view | `issuelinks` [J4] | L | M | Skip |
| [Project templates](https://linear.app/docs/project-templates), [notifications](https://linear.app/docs/project-notifications) | Missing | No Jira equivalent. PSAPAC keeps templates as a sprint and a field named "PS Templates" and "PS Project Templates" (round 2, `F:createmeta-story.json`) | L | M | Skip |
| [Initiatives](https://linear.app/docs/initiatives), [sub-initiatives](https://linear.app/docs/sub-initiatives) | Missing | PSAPAC has no level above Epic: Epic, Story, Task, Bug, Subtask (`F:createmeta-issuetypes.json`). Customer groups are the top level | L | L | Skip |
| [Initiative and project updates](https://linear.app/docs/initiative-and-project-updates) | Missing | No update object. A comment on the Epic is the nearest [J5] | M | M | Skip |
| [Project graph](https://linear.app/docs/project-graph), [Timeline](https://linear.app/docs/timeline) | Missing | Progress from loaded children; dates from `startdate` and `duedate`. Timeline over issues needs Advanced Roadmaps, which PSAPAC lacks | M | L | Later. After Epic progress |

## Issues

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Create an issue](https://linear.app/docs/creating-issues) | Have. `C`, modal, "Create more" (`CreateIssueDialog.tsx`, `docs/reference/shortcuts.md`) | Create issue [J2] | H | S | Skip. Built |
| [Create from a template](https://linear.app/docs/issue-templates) | Missing | Jira has no issue template API. A local file like `views.json` would hold them | M | M | Later. Prefill from the selected issue and "Create more" cover most repeats |
| [Duplicate an issue](https://linear.app/docs/parent-and-sub-issues) with sub-issues | Missing | No clone endpoint. The client creates and copies fields [J2]. A Clones link type exists (`F:issuelinktype.json`) | M | M | Later |
| [Drafts](https://linear.app/docs/creating-issues) | Partial. Description drafts survive navigation (`drafts.ts`); the create modal's text does not | Local state | L | S | Later |
| [Create by URL, email, recurring](https://linear.app/docs/creating-issues) | Missing | Recurring work is Jira Automation, not REST | L | L | Skip |
| [Edit title and description inline](https://linear.app/docs/creating-issues) | Have. `SummaryEditor.tsx`, `DescriptionEditor.tsx` | Edit issue [J2], ADF [J9] | H | S | Skip. Built |
| [Description history](https://linear.app/docs/creating-issues) | Missing | The changelog records description edits [J2]; restoring writes the old ADF back | L | M | Later. Follows the activity feed (story 12) |
| [Move to another team](https://linear.app/docs/creating-issues) | Missing | Bulk move exists [J2] but PSAPAC is the only Project | L | M | Skip. Q36 |
| [Assign issues](https://linear.app/docs/assigning-issues) | Partial. `A` opens a picker with Me, recents and search (`PropertyPickers.tsx`); no `I` assign-to-me key | `assignee` | H | S | Build. The `I` key (story 8) |
| [Delegate to agents](https://linear.app/docs/assigning-issues) | Missing | None | L | L | Skip |
| [Status, priority, labels, dates](https://linear.app/docs/issue-property) | Have. `IssueProperties.tsx`, status order Q21 | Native fields, transitions (`F:transitions-story.json`) | H | S | Skip. Built |
| [Picker number keys](https://linear.app/docs/issue-property) (`15-picker-status.png`) | Missing. Pickers move by arrows and Enter only (`Picker.tsx`) | None needed | L | S | Build. Story 8 |
| [Workflows and statuses](https://linear.app/docs/issue-property) | Partial. The Status picker lists reachable transitions in Q21 order; workflow editing is absent | Workflow editing is Jira administration, not issue work | L | L | Skip |
| [Estimates](https://linear.app/docs/issue-property) | Partial. Original estimate, remaining estimate and Time remaining (h); no points or T-shirt sizes (`IssueProperties.tsx`) | `customfield_13809` story points exists (round 2) and was declined | L | S | Skip. Q22 |
| [SLAs](https://linear.app/docs/issue-property) | Missing | SLAs belong to Jira Service Management; PSAPAC is a software project (`F:board-psapac.json`). Due date is the substitute and is built | L | L | Skip |
| [Manual order, priority drag](https://linear.app/docs/select-issues) | Missing | Rank field `customfield_11600` (`F:createmeta-story.json`) and the Agile rank endpoint [J7] | L | M | Skip. The Tree orders by Customer and key |
| [Select and bulk edit](https://linear.app/docs/select-issues) | Missing. `tree.ts` holds one active row and no selection (`27-row-selected.png` shows Linear's) | Bulk edit, bulk transition and bulk move take up to 1000 issues [J2]. Bulk edit needs the global Bulk change permission: live check, and live check that it accepts a team-managed project. The fallback is one edit per issue | H | L | Build. Story 3 |
| [Sub-issues](https://linear.app/docs/parent-and-sub-issues): add, convert, progress | Partial. Subtasks list on the page (`IssuePage.tsx`), the create modal takes a Subtask with a parent, the Parent picker sets a parent; no Add sub-issue button, no create from a pasted list, no progress count | `parent`, `subtasks` [J2]; a Subtask sits only under a Story (round 2) | M | M | Build. Story 6 |
| [Parent auto-close](https://linear.app/docs/parent-and-sub-issues) | Missing | A Jira Automation rule, not REST | L | M | Skip |
| [Issue relations](https://linear.app/docs/issue-property) | Partial. All 21 link types add and remove (`LinksSection.tsx`, Q19); no blocked or blocking badge on rows (`04-team-active-grouped.png`) | `issuelinks` [J4]. The search fields in `packages/core/src/search.ts` omit it, so the badge needs one more field. Link fixtures: `F:issue-links-psapac-664.json` | M | S | Build. Story 7 |
| [Duplicate status](https://linear.app/docs/issue-property) | Partial. A Duplicate link type, no status | PSAPAC has no reserved Duplicate status (`F:project-statuses.json`) | L | S | Skip |
| [Comments](https://linear.app/docs/comment-on-issues) | Have. Add, edit and delete your own (`CommentsSection.tsx`) | Comments [J5] | M | S | Skip. Built |
| [Threads, reactions, resolve, inline comments](https://linear.app/docs/comment-on-issues) | Missing | Jira comments are flat and have no reaction endpoint [J5] | L | L | Skip |
| [@mentions](https://linear.app/docs/editor) | Missing. Out of v1 (Q38) | ADF `mention` node [J9] plus the assignable-user search already built | M | M | Later |
| [Delete](https://linear.app/docs/delete-archive-issues) | Have. `DeleteIssueDialog.tsx`; not undoable (Q38) | Delete issue [J2]; Jira cannot restore | M | S | Skip. Built |
| [Archive, auto-close, recently deleted](https://linear.app/docs/delete-archive-issues) | Missing | Archive takes a Jira admin and up to 1000 issues [J2]; no restore for deletes; auto-close is Automation | L | L | Skip |
| [Cycles](https://linear.app/docs/use-cycles) as sprints: page and progress | Partial. Sprint picker, Sprint filter, "Current sprint" view and `jm sprint list` and `set` (`docs/reference/cli.md`); no sprint page (`09-cycle-detail.png`) | Sprint, sprint issues and move-to-sprint exist [J7]. The board lists 106 sprints (`F:board-sprints-all.json`) | H | M | Build. Story 5 |
| [Cycle graph](https://linear.app/docs/cycle-graph), rollover, sprint lifecycle | Missing. Out of v1 (sprint lifecycle) | Create, start and complete go through sprint update [J7]. The sprint API documents no burndown report, so a graph would derive from the changelog: live check | M | L | Later |
| [Activity feed](https://linear.app/docs/assigning-issues) (`12-issue-activity.png`) | Missing. Out of v1 (issue history, Q38); `apps/desktop/README.md` lists it as not built | Changelog per issue [J2], bulk fetch at `/rest/api/3/changelog/bulkfetch` | M | M | Build. Story 12 |

## Working in Linear

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Inbox](https://linear.app/docs/inbox) | Missing | Jira's REST has no per-user notification feed. Poll JQL on `updated` for issues assigned to, reported by or watched by the user [J1], then read changelogs [J2]. Push needs a webhook, which an app or admin registers [J8]. Live check: the `watcher` clause | H | L | Build. Story 13 |
| [Snooze and reminders](https://linear.app/docs/inbox) | Missing | Local state; `src/main/reminders.ts` already schedules notifications | M | M | Later. After the Inbox |
| [Notifications](https://linear.app/docs/notifications) | Partial. Timer reminders through Electron (`src/main/reminders.ts`) | Local | M | M | Later. After the Inbox |
| [Subscribe and watch](https://linear.app/docs/notifications) | Missing. Out of v1 (watchers) | Watchers [J3]: add, remove and list | M | S | Later. Pairs with the Inbox |
| [My issues](https://linear.app/docs/my-issues): Assigned, Created, Subscribed, Activity | Partial. A "My issues" view and "Assignee: me" (`ViewsList.tsx`); no Created, Subscribed or Activity tab | JQL `reporter = currentUser()`, `watcher = currentUser()` [J1]. Reporter is out of v1 (Q22) | M | S | Build. Story 1 |
| [Pulse](https://linear.app/docs/pulse) | Missing | No update feed to read | L | L | Skip |
| [Favorites](https://linear.app/docs/favorites) | Missing | Local file like `views.json`. Jira's favourite filters [J10] do not cover issues | M | S | Build. Story 11 |
| [Recent issues](https://linear.app/docs/search) | Missing. The Palette shows matches only (`CommandPalette.tsx`) | Local list | M | S | Build. Story 11 |
| [Preferences](https://linear.app/docs/account-preferences), [Profile](https://linear.app/docs/profile) | Partial. Theme (`theme.ts`), the three toggles and timer settings; no start page, no assign-on-create | Local; the account comes from `/myself` (`F:myself.json`) | L | S | Later |
| [Documents](https://linear.app/docs/documents) | Missing | Confluence, a different product | L | L | Skip |
| [Board layout](https://linear.app/docs/board-layout) | Missing. Out of v1 (board view) | Columns are statuses and a drop is a transition (`F:transitions-story.json`) | M | L | Later. The Tree is the primary layout |
| [Custom views](https://linear.app/docs/custom-views) | Partial. Create, rename, delete, shared with the CLI (`ViewsList.tsx`, `jm view list`); no update in place, ordering, duplicate or link | Views stay local (Q30). Jira shared filters [J10] could back sharing and are out of scope | M | S | Build. Story 9 |
| [Editor](https://linear.app/docs/editor) | Partial. Markdown shortcuts, images, code; no slash menu, link dialog, tables, mentions or emoji (`apps/desktop/README.md`, Known Limits) | ADF supports them [J9] | M | M | Later |
| [Search](https://linear.app/docs/search) | Partial. The Palette ranks loaded issues by key and summary (`search.ts`, Q37 option a); no description or comment text, no `/` key | `text ~ "..."` searches summary, description and comments [J1]. This reverses Q37 option a | M | M | Build. Story 10 |
| [Filters](https://linear.app/docs/filters) | Partial. Assignee, Status, Label, Type, Sprint and text (`filters.ts`, `TreeToolbar.tsx`); no Customer, Engagement, Priority, Epic, Created by, dates, negation or AND/OR | Every field but Created by is already loaded (`packages/core/src/search.ts`) and the filter runs client-side. Created by needs `reporter` added to those fields | H | M | Build. Story 1 |
| [Display options](https://linear.app/docs/display-options) | Partial. Three toggles and Collapse all (`TreeToolbar.tsx`); fixed grouping; no ordering; no priority, labels, due date or sprint on rows (`TreeRow.tsx`) | `priority`, `labels`, `duedate`, sprint and `updated` are already loaded | H | M | Build. Story 2 |
| [Drag between groups](https://linear.app/docs/display-options) | Missing | A drop sets a parent or status through the existing edits; the Customer prompt (Q16) still applies | M | M | Later |
| [Peek](https://linear.app/docs/peek) | Have. `Space` toggles it (`IssueDetail.tsx`); hold-to-peek is absent | None needed | M | S | Skip. Built |
| [Command menu](https://linear.app/docs/search) and actions | Partial. The Palette searches issues and lists no commands (`docs/reference/shortcuts.md`) | None needed. Every action exists | H | M | Build. Story 4 |
| [Insights](https://linear.app/docs/insights), [Dashboards](https://linear.app/docs/dashboards) | Missing | Counts derive from loaded issues. Time logged by Customer would use worklogs [J6] and JQL `worklogDate` [J1] | M | L | Later |
| [Security and access](https://linear.app/docs/security-and-access) | Partial. The token sits in the app's own Keychain item (ADR-0003); no sessions or passkeys | Jira API token | L | S | Skip |

## Agents and Coding

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Coding sessions](https://linear.app/docs/coding-sessions), [Reviews](https://linear.app/docs/diffs), [Coding settings](https://linear.app/docs/code-and-reviews), [Releases](https://linear.app/docs/releases) | Missing | The Development field exists (`customfield_13800`, `F:createmeta-story.json`); releases map to fix versions, out of v1 (Q22) | L | L | Skip. PSAPAC is delivery work, not code |
| [Linear Agent](https://linear.app/docs/linear-agent), [Loops](https://linear.app/docs/loops), [AI Agents](https://linear.app/docs/agents-in-linear), [Code Intelligence](https://linear.app/docs/code-intelligence), [MCP server](https://linear.app/docs/mcp) | Partial. `jm` gives an agent every operation with `jm help --json` (`docs/reference/cli.md`, Q12) | None needed | M | S | Skip. The CLI is the agent surface |

## Integrations, Admin, Import

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [GitHub](https://linear.app/docs/github), [Slack](https://linear.app/docs/slack), [Jira](https://linear.app/docs/jira) and other integrations | Missing | Jira is the backend; Slack and Teams are out of scope | L | L | Skip |
| [Teams](https://linear.app/docs/teams), [sub-teams](https://linear.app/docs/sub-teams), [private teams](https://linear.app/docs/private-teams) | Missing | One Project (Q36); Customer groups are the practical grouping | L | L | Skip |
| [Team pages](https://linear.app/docs/default-team-pages): All, Active, Backlog | Partial. Two starter views, "My issues" and "Current sprint" (`ViewsList.tsx`) | PSAPAC statuses: Opportunity, To Do, In Progress, Review, Hold, Done (`F:project-statuses.json`), so Active and Backlog are filters over them | M | S | Build. Story 9 |
| Administration: workspaces, members, SAML, SCIM, API, audit, billing, export | Missing | Jira administration belongs to Jira | L | L | Skip |
| [Import Guide](https://linear.app/docs/import-issues), [Jira importer](https://linear.app/docs/jira-to-linear) | Missing | Imports into Linear, the reverse direction | L | L | Skip |

## Jira References

Jira REST pages checked in this run: the operation lists in `swagger-v3.v3.json` at `dac-static.atlassian.com/cloud/jira/platform/` and the sprint page at `developer.atlassian.com`. Behaviour that needs a live PSAPAC call is marked "live check" in the matrix, and none ran.

| Ref | Page | Backs |
|---|---|---|
| J1 | [Issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) and [JQL fields](https://support.atlassian.com/jira-software-cloud/docs/jql-fields/) | `POST /rest/api/3/search/jql`, `text`, `watcher`, `reporter`, `updated`, `worklogDate` |
| J2 | [Issues](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/) | Create, edit, delete; changelog; bulk edit, transition, move and delete at `/rest/api/3/bulk/issues/*` (1000 issues, 200 fields per edit); archive (admin) |
| J3 | [Issue watchers](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-watchers/) | Watchers: add, remove and list; bulk watch is in J2 |
| J4 | [Issue links](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-links/) | `issuelinks` on an issue |
| J5 | [Issue comments](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/) | Flat comments, no reactions |
| J6 | [Issue worklogs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/) | Worklogs |
| J7 | [Sprint](https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/) | `/rest/agile/1.0/sprint`, sprint issues, move to sprint, start and complete by update; no burndown |
| J8 | [Webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/) | Push events, registered by an app or admin |
| J9 | [Atlassian Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/) | Tables, panels, mentions, links |
| J10 | [Filters](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-filters/) | Shared filters and favourite filters (`/rest/api/3/filter/favourite`) |

## Proposed Stories

Ranked by value over effort, with dependencies counted. Each Build row above maps to one story. None of these is filed: Shane picks which to build.

1. **Filter by more fields.** Add Customer, Engagement, Priority, Epic, Created by and Due date to the Filter menu, with an "is not" operator and the `F` key. Add "Created by me" to the starter views. Filters stay client-side over loaded issues. Acceptance: each new field filters the Tree and appears as a chip; a saved view stores it and `jm issue list` reads it back; the Customer choices list the Project's Customers; `pnpm test` and e2e pass.
2. **Row properties and ordering.** Show priority, labels, due date, sprint and updated on Tree rows, chosen from a Display menu, and order issues within a group by key, priority, updated or due date. Acceptance: each property toggles on the row and persists in `settings.json`; rows stay 32 px; the virtual window still holds; the order changes within Epics without breaking the Customer grouping.
3. **Bulk select and edit.** Add `X`, `Shift`+click, `Shift`+arrows and `Cmd+A` selection to the Tree, a bulk bar, and bulk Status, Assignee, Labels, Priority, Sprint and Customer. Use the bulk endpoints if the live check passes, otherwise one edit per issue with progress. Acceptance: ten selected issues change status in one action; a refusal names the issues it skipped; `Cmd+Z` undoes the batch; `Esc` clears the selection. Needs a live check of the Bulk change permission on PSAPAC.
4. **Command menu actions.** Make `Cmd+K` list actions for the issue in context or the selection: set status, assign, set sprint, create sub-issue, copy key and link, open in Jira, go to a view. Acceptance: every action in the menu runs the same mutation as its picker; the menu shows the shortcut beside each; searching still finds issues.
5. **Sprint page.** Open a sprint as a page: dates, goal, issues grouped by status, counts per assignee and a progress bar, with Move to sprint from the page. Acceptance: the active sprint opens from the sidebar and the picker; counts equal the sprint's issues; the page reads `GET /rest/agile/1.0/sprint/{id}/issue` through core and `jm sprint list` shows the same sprint.
6. **Epic progress and add sub-issue.** Show done over total on Epic rows and pages, and on Story rows with Subtasks; add an Add sub-issue button and a create-from-pasted-list form to the issue page. Acceptance: the progress counts match `buildHierarchy` including Done children; a pasted list of five titles makes five Subtasks under the Story with the parent's Customer and Engagement.
7. **Blocked badge on rows.** Request `issuelinks`, and show a red pill on rows that a Blocks link holds open and an amber one on rows that block open issues. Acceptance: the pill counts open blockers only; it clears when the blocker reaches Done; the Peek lists the blockers; the recorded link fixtures drive the test.
8. **Quick actions.** Add `I` to assign to me, number keys in the Status and Priority pickers, click-to-change on a row's status dot and avatar, and copy key and copy link on the Peek. Acceptance: each works from the Tree without opening the Peek; the keys obey the guard in `keymap.ts`; `docs/reference/shortcuts.md` lists them.
9. **Saved view upkeep.** Add Update view with the current filters, Duplicate view and a drag order to the sidebar, and ship starter views Active (In Progress, Review) and Backlog (Opportunity, To Do, Hold). Acceptance: Update view rewrites `views.json` through core and the CLI reads it; the starters appear for a new user; ordering survives a restart.
10. **Search descriptions and comments.** Add a "Search text in Jira" row to the Palette that runs JQL `text ~` through core, debounced and cancellable, and opens the match. Acceptance: a word that only a description holds finds its issue; results show which field matched where the API says; the loaded-issue ranking stays first. Supersedes Q37 option a, so record that in the grilling record.
11. **Favourites and recents.** Add a sidebar Favourites section for issues and views, `Alt+F` to toggle, and a Recent list at the top of the Palette. Acceptance: favourites and recents persist in a state file; a deleted issue drops out with a notice; the Palette shows the last ten opened issues before any query.
12. **Activity feed.** Add the issue's history to the Activity section, interleaved with comments: status, assignee, priority, sprint and field changes with author and age. Acceptance: the feed reads the changelog through core; it pages; it matches the history Jira shows for three recorded issues; description edits show as one line.
13. **Inbox.** Add an Inbox page listing issues assigned to, reported by or watched by the user that changed since the user last looked, with unread marks, mark all read and a badge. Acceptance: it polls on window focus and every few minutes; each entry names the change from the changelog; opening an entry marks it read; a live check confirms the `watcher` clause on PSAPAC before the story starts.

## Open Questions

Each needs a live PSAPAC call that this analysis did not make.

- Does the Bulk change permission hold for the user, and do the bulk endpoints accept a team-managed project (story 3)?
- Does JQL `watcher = currentUser()` return issues on PSAPAC (stories 13 and the My issues tabs)?
- Can a sprint's progress derive from the changelog alone, since the sprint API documents no report (the Later cycle graph row)?

## Sources Read

Date read for every page: 2026-10-10. Linear's docs index at https://linear.app/docs and the page list at https://linear.app/llms.txt gave the navigation. Pages came through the `.md` form of each URL.

Read in full:

- https://linear.app/docs/creating-issues
- https://linear.app/docs/assigning-issues
- https://linear.app/docs/select-issues
- https://linear.app/docs/parent-and-sub-issues
- https://linear.app/docs/issue-templates
- https://linear.app/docs/comment-on-issues
- https://linear.app/docs/delete-archive-issues
- https://linear.app/docs/issue-property (status, priority, labels, relations, estimates, SLAs)
- https://linear.app/docs/use-cycles
- https://linear.app/docs/inbox
- https://linear.app/docs/my-issues
- https://linear.app/docs/favorites
- https://linear.app/docs/notifications
- https://linear.app/docs/board-layout
- https://linear.app/docs/timeline
- https://linear.app/docs/custom-views
- https://linear.app/docs/editor
- https://linear.app/docs/search
- https://linear.app/docs/filters
- https://linear.app/docs/display-options
- https://linear.app/docs/peek
- https://linear.app/docs/triage

Read by headings and opening lines only: https://linear.app/docs/conceptual-model, get-the-app, start-guide, triage-intelligence, linear-asks, customer-requests, projects, project-milestones, project-priority, project-status, project-labels, project-dependencies, project-notifications, project-templates, initiatives, sub-initiatives, initiative-and-project-updates, dashboards, insights, project-graph, cycle-graph, pulse, documents, profile, account-preferences, default-team-pages, teams, sub-teams, private-teams, security-and-access, github, slack, jira, import-issues, jira-to-linear, coding-sessions, diffs, releases, code-and-reviews, linear-agent, loops, agents-in-linear, code-intelligence and mcp, each under `https://linear.app/docs/`.

Not read: the Asks pages for Slack, email and web forms (linear-asks-slack, linear-asks-email, linear-asks-web-forms); the integration pages other than GitHub, Slack and Jira; the administration pages (workspaces, login-methods, invite-members, members-roles, saml-and-access-control, scim, api-and-webhooks, third-party-application-approvals, security, audit-log, billing-and-plans, ai-credits, usage-and-limits, exporting-data); the importer pages other than Jira; and the developer pages. They describe administration, integrations and APIs, not the user functionality this analysis compares.

Not available: https://linear.app/docs/issue-relations loads the Issue properties page, whose Issue relations section was read. https://linear.app/docs/configuring-workflows returned 404, and the Issue status section of the Issue properties page covers workflows. https://linear.app/docs/issue-properties-home has no body of its own.

jira-mgr evidence: `AGENTS.md`, `CONTEXT.md`, `ARCHITECTURE.md`, `apps/desktop/README.md`, `docs/reference/shortcuts.md`, `docs/reference/cli.md` (command list and `jm issue list` options), `docs/product/roadmap.md`, `docs/discovery/2026-10-07-product-grilling.md`, round 2 of its folder, `docs/design/linear/README.md` (the screenshot index, not the images), and the desktop and core source named in the matrix.
