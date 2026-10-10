# Linear Gap Analysis

**Date:** 2026-10-10
**Feeds:** Story #120, which of Linear's functions jira-mgr should build next

## Summary

jira-mgr covers the issue core: create, edit every property, comments, worklogs, links, attachments, the timer, undo, the Peek and saved views. The gaps sit around the list, not the issue page.

- **The list shows and filters too little.** Rows carry type, status, key, summary, assignee and type name only. Priority, labels, due date and sprint are loaded but never shown (`02-my-issues.png`, `24-display-options.png`). The Filter menu has five fields and no Customer, Engagement or Priority, although Customer is the Tree's top level (`23-filter-menu.png`).
- **No way to act on many issues.** The Tree has one active row and no selection, so moving ten issues into a sprint takes ten trips. Linear's hover checkbox, `X` and bulk bar have no counterpart (`25-row-hover.png`, `27-row-selected.png`).
- **The command menu searches and does nothing else.** Linear's `Cmd+K` runs actions on the issue in context (`21-command-palette.png`). `docs/reference/shortcuts.md` records that the Palette lists no commands.
- **Sprints are a field, not a place.** Linear's cycle page groups one cycle's issues beside a progress panel (`09-cycle-detail.png`). PSAPAC has 106 sprints on its board and no page for one.
- **No overview of Customers or Epics.** Linear's Projects table gives progress, issue count, lead and target date per project (`06-projects-list.png`). PSAPAC's equivalent is an Epic per engagement, and the app shows Epics only as Tree groups.
- **Create is thinner than Linear's.** The create dialog has no description or attachment (`22-create-issue-dialog.png`).
- **Nothing tells the user what changed.** There is no Inbox, no activity feed on the issue page, no blocked badge on rows and no search of descriptions or comments (`00-inbox.png`, `12-issue-activity.png`, `04-team-active-grouped.png`).
- **Deliberately absent, and still right to skip:** initiatives, SLAs, triage, Asks, agents, coding sessions, releases, integrations, administration and importers. Jira cannot back most of them for PSAPAC, or the Customer field and the CLI already cover them.

The matrix lists 87 rows in 7 areas: 9 Have, 34 Partial and 44 Missing. 26 rows are Build, 21 Later and 40 Skip. The Build rows map to the 15 stories ranked below.
## Reading the Matrix

| Column | Meaning                                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | Have, Partial or Missing, with a file, doc or screenshot as evidence. Paths are repository paths; `NN-name.png` is a file in `docs/design/linear/`.                                                                                                                                 |
| Jira   | The Jira equivalent and whether the REST API can back it for PSAPAC. `[J1]` to `[J10]` point at Jira References, `F:` names a recorded fixture under `packages/core/fixtures/`. "Live check" marks a claim that needs one and that no run here made.                                |
| Value  | H, M or L for a PSAPAC consultant working 764 open issues.                                                                                                                                                                                                                          |
| Effort | S under two days, M under a week, L longer, for one pull request with tests and docs.                                                                                                                                                                                               |
| Call   | Build, Later or Skip. Skip also marks a feature already built.                                                                                                                                                                                                                      |

Where the roadmap or the [product grilling](2026-10-07-product-grilling.md) puts a feature out of scope, the row says so with its Q number.

## Getting Started

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Concepts: workspace, team](https://linear.app/docs/conceptual-model) | Have. One Site and one Project per login (`CONTEXT.md`, Q36) | Project is the team. Switching means logging in again | L | S | Skip. Multiple teams are out of scope (Q36) |
| [Download Linear: desktop, mobile, offline](https://linear.app/docs/get-the-app) | Partial. macOS only, live fetch, no offline (ADR-0002, Q7, Q13) | Client concern; Jira has no offline API | L | L | Skip. Out of v1 |
| [Start Guide](https://linear.app/docs/start-guide) | Partial. A login screen and no tour (`apps/desktop/src/renderer/src/LoginScreen.tsx`) | None needed | L | S | Skip. One user knows the app |
| [Sidebar destinations](https://linear.app/docs/default-team-pages) (`00-inbox.png`, `01-team-home.png`) | Partial. The sidebar holds Views, the timer and the account (`Sidebar.tsx`); Linear adds Inbox, My issues, Customers, Projects, Favorites and per-team pages | Each destination is its own row below | M | S | Later. The sidebar grows as destinations arrive |

## Intake

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Triage](https://linear.app/docs/triage) | Missing | Jira has no triage state. The nearest is JQL `status = "To Do" AND assignee is EMPTY` [J1], statuses in `F:project-statuses.json` | L | M | Skip. The PS team creates its own issues and PSAPAC automation rewrites them (`apps/desktop/README.md`, Create and Delete) |
| [Triage Intelligence](https://linear.app/docs/triage-intelligence) | Missing | None. Linear's AI suggests properties and duplicates from issue content | L | L | Skip |
| [Linear Asks](https://linear.app/docs/linear-asks) (Slack, email, web forms) | Missing | Request intake needs Jira Service Management. PSAPAC is a software project (`F:board-psapac.json`, `projectTypeKey`) | L | L | Skip |
| [Customer Requests](https://linear.app/docs/customer-requests): customers, requests, importance | Partial. Customer is a required field and the Tree's top group (`CONTEXT.md`); no request records, no Customers page | Customer is a single select, `customfield_14849` (round 2). Jira has no request object. Customer attributes (tier, revenue) have no home | M | M | Skip as a request system. The Customer filter and the Customers overview cover the practical need (stories 1 and 7) |

## Projects and Initiatives

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Projects](https://linear.app/docs/projects): list, progress, lead, target date (`06-projects-list.png`) | Partial. Epics are Tree groups with a child count (`TreeRow.tsx`) and open as pages; no progress, no table | Epic and children through `parent`, already loaded (`packages/core/src/search.ts`, `hierarchy.ts`); lead is the assignee, target date is `duedate` | H | M | Build. Customer and Epic overview (story 7) |
| [Customers page](https://linear.app/docs/customer-requests) (`00-inbox.png` sidebar, `06-projects-list.png`) | Missing. Customer groups exist only inside the Tree | Counts and progress per Customer derive from loaded issues | M | M | Build. Story 7 |
| [Project views](https://linear.app/docs/projects): saved views attached to a project | Missing. Saved views are global (`ViewsList.tsx`) | A view with an Epic filter; needs the Epic filter of story 1 | M | S | Later. After story 1 |
| [Project priority](https://linear.app/docs/project-priority), [status](https://linear.app/docs/project-status), [labels](https://linear.app/docs/project-labels) | Have. An Epic takes Status, Priority and Labels on its page (`IssueProperties.tsx`) | Native Epic fields | M | S | Skip. Built |
| [Project milestones](https://linear.app/docs/project-milestones) (`20-picker-project.png`, `11-issue-page.png`) | Missing | Fix versions is the nearest (`F:createmeta-story.json`) and is out of v1 (Q22). Epics already nest the stages PSAPAC uses | L | M | Skip |
| [Project dependencies](https://linear.app/docs/project-dependencies) | Partial. Blocks links work on any issue, Epics included (`LinksSection.tsx`); no dependency view or violation colour | `issuelinks` [J4] | L | M | Skip |
| [Project templates](https://linear.app/docs/project-templates): a project with its milestones and issues | Missing | No Jira template API. PSAPAC keeps a "PS TEMPLATES" sprint and a "PS Project Templates" field (round 2, `F:createmeta-story.json`), which suggests template Epics that are cloned. A clone is create calls [J2] | M | L | Later. Ask Shane how PS TEMPLATES is used first |
| [Project notifications](https://linear.app/docs/project-notifications) | Missing | Watchers on an Epic [J3]; follows the Inbox | L | M | Skip |
| [Initiatives](https://linear.app/docs/initiatives), [sub-initiatives](https://linear.app/docs/sub-initiatives) | Missing | PSAPAC has no level above Epic: Epic, Story, Task, Bug, Subtask (`F:createmeta-issuetypes.json`). Customer groups are the top level | L | L | Skip |
| [Initiative and project updates](https://linear.app/docs/initiative-and-project-updates): health, cadence | Missing | No update object. A structured comment on the Epic is the nearest [J5]; reminders would reuse `src/main/reminders.ts` | M | M | Later. Weekly engagement status is real PS work, but the comment form needs design |
| [Project graph](https://linear.app/docs/project-graph), [Timeline](https://linear.app/docs/timeline) | Missing | Scope and completed lines derive from `created` and status changes in the changelog [J2]; Timeline over issues needs Advanced Roadmaps, which PSAPAC lacks | M | L | Later. After the Epic overview |
| [Pulse](https://linear.app/docs/pulse) (`00-inbox.png`) | Missing | Pulse is a feed of project updates; PSAPAC has none to feed it | L | L | Skip |

## Issues

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Create an issue](https://linear.app/docs/creating-issues) | Have. `C`, modal, "Create more" (`CreateIssueDialog.tsx`, `22-create-issue-dialog.png`) | Create issue [J2] | H | S | Skip. Built |
| [Create dialog](https://linear.app/docs/creating-issues): description, attachment, own assignee (`22-create-issue-dialog.png`) | Partial. No description, no attachment, assignee starts empty (`apps/desktop/README.md`, Known Limits) | `jm issue create` already sends a Markdown description through core (`docs/reference/cli.md`), so core takes one. Attachments need the issue key, so they upload after create [J2] | H | M | Build. Story 3 |
| [Create from a template](https://linear.app/docs/issue-templates) (`22-create-issue-dialog.png` Template chip) | Missing | Jira has no issue template API. A local file like `views.json` would hold them | M | M | Later. Prefill from the selected issue and "Create more" cover most repeats |
| [Duplicate an issue](https://linear.app/docs/parent-and-sub-issues) with sub-issues | Missing | No clone endpoint. The client creates and copies fields [J2]. A Cloners link type exists (`F:issuelinktype.json`) | M | M | Later |
| [Drafts](https://linear.app/docs/creating-issues) | Partial. Description drafts survive navigation (`drafts.ts`); the create modal's text does not | Local state | L | S | Later |
| [Create by URL, email, recurring](https://linear.app/docs/creating-issues) | Missing | Recurring work is Jira Automation, not REST | L | L | Skip |
| [Edit title and description inline](https://linear.app/docs/creating-issues) | Have. `SummaryEditor.tsx`, `DescriptionEditor.tsx` | Edit issue [J2], ADF [J9] | H | S | Skip. Built |
| [Description history](https://linear.app/docs/creating-issues) | Missing | The changelog records description edits [J2]; restoring writes the old ADF back | L | M | Later. Follows the activity feed (story 14) |
| [Move to another team](https://linear.app/docs/creating-issues) | Missing | Bulk move exists [J2] but PSAPAC is the only Project | L | M | Skip. Q36 |
| [Assign issues](https://linear.app/docs/assigning-issues) (`17-picker-assignee.png`) | Partial. `A` opens a picker with Me, recents and search (`PropertyPickers.tsx`); no `I` assign-to-me key, no "Invite and assign" | `assignee`; inviting users is Jira administration | H | S | Build. The `I` key (story 10) |
| [Delegate to agents](https://linear.app/docs/assigning-issues) | Missing | None | L | L | Skip |
| [Status, priority, labels, dates](https://linear.app/docs/issue-property) (`15-picker-status.png`, `16-picker-priority.png`) | Have. `IssueProperties.tsx`, status order Q21 | Native fields, transitions (`F:transitions-story.json`) | H | S | Skip. Built |
| Picker number keys ([issue properties](https://linear.app/docs/issue-property) do not document them; shown in `15-picker-status.png`, `16-picker-priority.png`, `17-picker-assignee.png`) | Missing. Pickers move by arrows and Enter only (`Picker.tsx`) | None needed | L | S | Build. Story 10 |
| [Label picker](https://linear.app/docs/issue-property) sections: Suggestions, Frequently used (`19-picker-label.png`) | Partial. One list of the Project's labels (Q35) | "Frequently used" counts labels on loaded issues; Jira's suggestions are site-wide (Q35) | L | S | Later |
| [Workflows and statuses](https://linear.app/docs/issue-property) | Partial. The Status picker lists reachable transitions in Q21 order; workflow editing is absent | Workflow editing is Jira administration, not issue work | L | L | Skip |
| [Estimates](https://linear.app/docs/issue-property) (`18-picker-estimate.png`) | Partial. Original estimate, remaining estimate and Time remaining (h); no points or T-shirt sizes (`IssueProperties.tsx`) | `customfield_13809` story points exists (round 2) and was declined | L | S | Skip. Q22 |
| [Due dates](https://linear.app/docs/issue-property): coloured icon, overdue filter, `Shift+D`, sort | Partial. The Due date field edits and saves (`IssueProperties.tsx`); rows show nothing, no overdue filter | `duedate` is loaded (`packages/core/src/search.ts`); JQL `duedate < now()` [J1] | M | S | Build. Icon in story 2, filter in story 1 |
| [SLAs](https://linear.app/docs/issue-property) | Missing | SLAs belong to Jira Service Management; PSAPAC is a software project (`F:board-psapac.json`). Due date is the substitute and is built | L | L | Skip |
| [Manual ordering](https://linear.app/docs/select-issues) with `Option+Shift+Up` and `Down` | Missing | Rank field `customfield_11600` (`F:createmeta-story.json`) and the Agile rank endpoint [J7] | L | M | Skip. The Tree orders by Customer and key |
| [Select and bulk edit](https://linear.app/docs/select-issues): hover checkbox, bulk bar (`25-row-hover.png`, `26-row-keyboard-focus.png`, `27-row-selected.png`) | Missing. `tree.ts` holds one active row and no selection | Bulk edit, bulk transition and bulk move take up to 1000 issues [J2]. Bulk edit needs the global Bulk change permission, which round 2 says the user holds. Live check that it accepts the team-managed project. The fallback is one edit per issue | H | L | Build. Story 4 |
| [Sub-issues](https://linear.app/docs/parent-and-sub-issues): tree lines, dimmed parent in other groups (`02-my-issues.png`, `04-team-active-grouped.png`) | Have. The Tree nests children and repeats a dimmed parent as context (`TreeRow.tsx`, `contextOnly`) | `parent` | M | S | Skip. Built |
| [Sub-issues section](https://linear.app/docs/parent-and-sub-issues): progress, add, paste a list (`11-issue-page.png`, `14-issue-comments.png`) | Partial. Subtasks list on the page (`IssuePage.tsx`), the create modal takes a Subtask with a parent; no progress count, no Add sub-issue button, no create from a pasted list | `parent`, `subtasks` [J2]; a Subtask sits only under a Story (round 2) | M | M | Build. Story 9 |
| Parent progress pills on rows and "Sub-issue of" line ([sub-issues page](https://linear.app/docs/parent-and-sub-issues) does not describe the pill; shown in `02-my-issues.png`, `03-team-issues.png`, `11-issue-page.png`) | Missing. Epics show a child count only (`TreeRow.tsx`) | Done over total from the loaded children, Done included once that phase loads | H | S | Build. Story 7 |
| [Parent auto-close](https://linear.app/docs/parent-and-sub-issues) | Missing | A Jira Automation rule, not REST | L | M | Skip |
| [Issue relations](https://linear.app/docs/issue-property): blocked and blocking badges (`04-team-active-grouped.png`, `25-row-hover.png`, `31-closeup-list-row.png`) | Partial. All 21 link types add and remove (`LinksSection.tsx`, Q19); no badge on rows | `issuelinks` [J4]. The search fields in `packages/core/src/search.ts` omit it, so the badge needs one more field. Link fixtures: `F:issue-links-psapac-664.json` | M | S | Build. Story 8 |
| [Related list](https://linear.app/docs/issue-property) in the page sidebar (`11-issue-page.png`, `32-closeup-properties-sidebar.png`) | Partial. Links are a section of the page's main column (`LinksSection.tsx`) | Same data | L | S | Skip |
| [Duplicate status](https://linear.app/docs/issue-property) | Partial. A Duplicate link type, no status | PSAPAC has no reserved Duplicate status (`F:project-statuses.json`) | L | S | Skip |
| [Comments](https://linear.app/docs/comment-on-issues) (`12-issue-activity.png`) | Have. Add, edit and delete your own, attach (`CommentsSection.tsx`) | Comments [J5] | M | S | Skip. Built |
| [Threads, reactions, resolve, inline comments](https://linear.app/docs/comment-on-issues) | Missing | Jira comments are flat and have no reaction endpoint [J5] | L | L | Skip |
| [@mentions](https://linear.app/docs/editor) | Missing. Out of v1 (Q38) | ADF `mention` node [J9] plus the assignable-user search already built | M | M | Later |
| [Delete](https://linear.app/docs/delete-archive-issues) | Have. `DeleteIssueDialog.tsx`; not undoable (Q38) | Delete issue [J2]; Jira cannot restore | M | S | Skip. Built |
| [Archive, auto-close, recently deleted](https://linear.app/docs/delete-archive-issues) | Missing | Archive takes a Jira admin and up to 1000 issues [J2]; no restore for deletes; auto-close is Automation | L | L | Skip |
| [Cycles](https://linear.app/docs/use-cycles) as sprints: page, panel, nav (`09-cycle-detail.png`, `12-issue-activity.png` sidebar) | Partial. Sprint picker, Sprint filter, "Current sprint" view and `jm sprint list` and `set` (`docs/reference/cli.md`); no sprint page, no Current and Upcoming entries | Sprint, sprint issues and move-to-sprint exist [J7]. The board lists 106 sprints (`F:board-sprints-all.json`). Scope, started and completed counts and the per-assignee split derive from loaded issues | H | M | Build. Story 6 |
| [Cycle graph](https://linear.app/docs/cycle-graph), capacity, rollover, auto-add, sprint lifecycle | Missing. Out of v1 (sprint lifecycle) | Create, start and complete go through sprint update [J7]. The sprint API documents no burndown report, so a graph would derive from the changelog: live check | M | L | Later |
| [Activity feed](https://linear.app/docs/creating-issues) with collapsed events (`11-issue-page.png`, `12-issue-activity.png`, `14-issue-comments.png`) | Missing. Out of v1 (issue history, Q38); `apps/desktop/README.md` lists it as not built | Changelog per issue [J2], bulk fetch at `/rest/api/3/changelog/bulkfetch` | M | M | Build. Story 14 |
| [Subscribe](https://linear.app/docs/notifications), unsubscribe, subscriber avatars (`11-issue-page.png`) | Missing. Out of v1 (watchers) | Watchers [J3]: add, remove and list | M | S | Later. Pairs with the Inbox |

## Working in Linear

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Inbox](https://linear.app/docs/inbox) (`00-inbox.png`) | Missing | Jira's REST has no per-user notification feed. Poll JQL on `updated` for issues assigned to, reported by or watched by the user [J1], then read changelogs [J2]. Push needs a webhook, which an app or admin registers [J8]. Live check: the `watcher` clause | H | L | Build. Story 15 |
| [Snooze and reminders](https://linear.app/docs/inbox) | Missing | Local state; `src/main/reminders.ts` already schedules notifications | M | M | Later. After the Inbox |
| [Notifications](https://linear.app/docs/notifications) | Partial. Timer reminders through Electron (`src/main/reminders.ts`) | Local | M | M | Later. After the Inbox |
| [My issues](https://linear.app/docs/my-issues): Assigned, Created, Subscribed, Activity (`02-my-issues.png`) | Partial. A "My issues" view and "Assignee: me" (`ViewsList.tsx`); no Created, Subscribed or Activity tab, no Focus grouping | JQL `reporter = currentUser()`, `watcher = currentUser()` [J1]. Reporter is out of v1 (Q22) | M | S | Build. Story 1 |
| [Favorites](https://linear.app/docs/favorites) (`00-inbox.png` Favorites, star in `11-issue-page.png`) | Missing | Local file like `views.json`. Jira's favourite filters [J10] do not cover issues | M | S | Build. Story 13 |
| [Recent issues](https://linear.app/docs/search) | Missing. The Palette shows matches only (`CommandPalette.tsx`) | Local list | M | S | Build. Story 13 |
| [Preferences](https://linear.app/docs/account-preferences), [Profile](https://linear.app/docs/profile) | Partial. Theme (`theme.ts`; light in `29-light-team-active.png`), the three toggles and timer settings; no start page, no assign-on-create, no assign-on-start | Local; the account comes from `/myself` (`F:myself.json`). Assign-on-start is an assignee edit after a transition | M | S | Later. Assign on move to In Progress suits PSAPAC |
| [Documents](https://linear.app/docs/documents) | Missing | Confluence, a different product | L | L | Skip |
| [Board layout](https://linear.app/docs/board-layout) (`24-display-options.png` List and Board toggle) | Missing. Out of v1 (board view) | Columns are statuses and a drop is a transition (`F:transitions-story.json`) | M | L | Later. The Tree is the primary layout |
| [Custom views](https://linear.app/docs/custom-views) (`10-views-list.png`, `08-empty-state-views.png`) | Partial. Create, rename, delete, shared with the CLI (`ViewsList.tsx`, `jm view list`); no update in place, ordering, duplicate, owner or link | Views stay local (Q30). Jira shared filters [J10] could back sharing and are out of scope | M | S | Build. Story 11 |
| [Team pages](https://linear.app/docs/default-team-pages): Active, Backlog, All and view tabs (`03-team-issues.png`, `05-team-backlog.png`) | Partial. Two starter views, "My issues" and "Current sprint" (`ViewsList.tsx`); views sit in the sidebar, not as tabs over the list | PSAPAC statuses: Opportunity, To Do, In Progress, Review, Hold, Done (`F:project-statuses.json`), so Active and Backlog are filters over them | M | S | Build. Story 11 |
| [Editor](https://linear.app/docs/editor) | Partial. Markdown shortcuts, images, code; no slash menu, link dialog, tables, mentions or emoji (`apps/desktop/README.md`, Known Limits) | ADF supports them [J9] | M | M | Later |
| [Search](https://linear.app/docs/search) | Partial. The Palette ranks loaded issues by key and summary (`search.ts`, Q37 option a); no description or comment text, no `/` key | `text ~ "..."` searches summary, description and comments [J1]. This reverses Q37 option a | M | M | Build. Story 12 |
| [Filters](https://linear.app/docs/filters) (`23-filter-menu.png`) | Partial. Assignee, Status, Label, Type, Sprint and text (`filters.ts`, `TreeToolbar.tsx`); Linear adds Status type, Creator, Priority, Relations, Dates, Customers, Content, AND/OR and an `F` key | Every field but Creator is already loaded (`packages/core/src/search.ts`) and the filter runs client-side. Creator needs `reporter` added to those fields | H | M | Build. Story 1 |
| [Display options](https://linear.app/docs/display-options) (`24-display-options.png`) | Partial. Three toggles and Collapse all (`TreeToolbar.tsx`); fixed grouping; no ordering; no priority, labels, due date or sprint on rows (`TreeRow.tsx`). "Show empty groups" exists as "Hide empty Customers" | `priority`, `labels`, `duedate`, sprint, `created` and `updated` are already loaded | H | M | Build. Story 2 |
| [Row anatomy](https://linear.app/docs/display-options): priority bars, labels, sprint chip, due and created date (`02-my-issues.png`, `31-closeup-list-row.png`) | Partial. Type icon, status dot, key, summary, assignee (`TreeRow.tsx`) | Fields loaded | H | M | Build. Story 2 |
| [Group header](https://linear.app/docs/display-options) with count and "+" create (`03-team-issues.png`) | Partial. Customer, Epic and No Epic headers carry counts (`TreeRow.tsx`); no "+" | `C` already prefills from a header's Customer | L | S | Build. Story 10 |
| Drag between groups ([display options](https://linear.app/docs/display-options)) | Missing | A drop sets a parent or status through the existing edits; the Customer prompt (Q16) still applies | M | M | Later |
| [Peek](https://linear.app/docs/peek) (`28-issue-peek.png`) | Partial. `Space` toggles it and holds the pickers, summary and Delete (`IssueDetail.tsx`); no description preview, no hold-to-peek | The read-only `AdfEditor` already renders a description | M | S | Build. Description in the Peek (story 10) |
| [Command menu](https://linear.app/docs/search) and actions (`21-command-palette.png`) | Partial. The Palette searches issues and lists no commands (`docs/reference/shortcuts.md`); no context chip | None needed. Every action exists | H | M | Build. Story 5 |
| Copy key, link and [Markdown](https://linear.app/docs/editor); [pre-filled create URL](https://linear.app/docs/creating-issues); open in Jira (`11-issue-page.png` header buttons) | Missing. The page has an Open action for external links only (`shared/links.ts`) | The browse URL derives from the Site and key | M | S | Build. Story 10 |
| Empty states ([custom views](https://linear.app/docs/custom-views) does not describe them; shown in `08-empty-state-views.png`) | Partial. "No issues match" with text (`Shell.tsx`); no illustration or action | None needed | L | S | Later |
| [Light theme](https://linear.app/docs/account-preferences) (`29-light-team-active.png`, `30-light-issue-page.png`) | Have. System, light or dark (`theme.ts`, `ThemeToggle.tsx`) | None needed | M | S | Skip. Built |
| [Insights](https://linear.app/docs/insights), [Dashboards](https://linear.app/docs/dashboards) | Missing | Counts and age derive from loaded issues; lead time needs the resolution date. Time logged by Customer would use worklogs [J6] and JQL `worklogDate` [J1] | M | L | Later |
| [Security and access](https://linear.app/docs/security-and-access) | Partial. The token sits in the app's own Keychain item (ADR-0003); no sessions or passkeys | Jira API token | L | S | Skip |

## Agents and Coding

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [Coding sessions](https://linear.app/docs/coding-sessions), [Reviews](https://linear.app/docs/diffs), [Coding settings](https://linear.app/docs/code-and-reviews), [Releases](https://linear.app/docs/releases) (`00-inbox.png` Reviews, `04-team-active-grouped.png` PR chip) | Missing | The Development field exists (`customfield_13800`, `F:createmeta-story.json`); releases map to fix versions, out of v1 (Q22) | L | L | Skip. PSAPAC is delivery work, not code |
| [Linear Agent](https://linear.app/docs/linear-agent), [Loops](https://linear.app/docs/loops), [AI Agents](https://linear.app/docs/agents-in-linear), [Code Intelligence](https://linear.app/docs/code-intelligence), [MCP server](https://linear.app/docs/mcp) | Partial. `jm` gives an agent every operation with `jm help --json` (`docs/reference/cli.md`, Q12) | None needed | M | S | Skip. The CLI is the agent surface |

## Integrations, Admin, Import

| Feature | Status | Jira | Value | Effort | Call |
|---|---|---|---|---|---|
| [GitHub](https://linear.app/docs/github), [Slack](https://linear.app/docs/slack), [Jira](https://linear.app/docs/jira) and other integrations | Missing | Jira is the backend; Slack and Teams are out of scope. Linear's own Jira sync maps Epic to Project and needs a Jira admin token, so it is no model here | L | L | Skip |
| [Teams](https://linear.app/docs/teams), [sub-teams](https://linear.app/docs/sub-teams), [private teams](https://linear.app/docs/private-teams), team home (`01-team-home.png`) | Missing | One Project (Q36); Customer groups are the practical grouping | L | L | Skip |
| Administration: [workspaces](https://linear.app/docs/workspaces), members, SAML, SCIM, API, audit, billing, export (admin pages, not read) | Missing | Jira administration belongs to Jira | L | L | Skip |
| [Import Guide](https://linear.app/docs/import-issues), [Jira importer](https://linear.app/docs/jira-to-linear) | Missing | Imports into Linear, the reverse direction | L | L | Skip |

## Jira References

Jira REST pages checked in this run: the operation lists in `swagger-v3.v3.json` at `dac-static.atlassian.com/cloud/jira/platform/` and the sprint page at `developer.atlassian.com`. Behaviour that needs a live PSAPAC call is marked "live check" in the matrix, and none ran.

| Ref | Page | Backs |
|---|---|---|
| J1 | [Issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) and [JQL fields](https://support.atlassian.com/jira-software-cloud/docs/jql-fields/) | `POST /rest/api/3/search/jql`, `text`, `watcher`, `reporter`, `updated`, `duedate`, `worklogDate` |
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

1. **Filter by more fields.** Add Customer, Engagement, Priority, Epic, Creator, Status type, Relations (blocked, blocking) and Dates (due, created, updated, overdue) to the Filter menu, with an "is not" operator and the `F` key. Add Created by me to the My issues starters. Filters stay client-side over loaded issues. Acceptance: each new field filters the Tree and appears as a chip; a saved view stores it and `jm issue list` reads it back; the Customer choices list the Project's Customers; Overdue lists open issues with a due date before today; `pnpm test` and e2e pass.
2. **Row properties and ordering.** Show priority bars, labels, sprint, a due-date icon (red when due or overdue, orange within a week, grey otherwise) and created or updated date on Tree rows, chosen from a Display menu, and order issues within a group by key, priority, updated or due date. Acceptance: each property toggles on the row and persists in `settings.json`; rows stay 32 px; the virtual window still holds; the order changes within Epics without breaking the Customer grouping.
3. **Description and attachment on create.** Put the description editor and a file picker in the create dialog, and start the assignee as the user when Shane opts in. Attachments upload after the issue exists. Acceptance: a created issue carries the typed ADF description; attachments appear on the new issue; a failed upload leaves the issue and says so in the notice; "Create more" clears the description.
4. **Bulk select and edit.** Add a hover checkbox, `X`, `Shift`+click, `Shift`+arrows and `Cmd+A` selection to the Tree, and a bar that reads "N selected" with a primary action and an Actions menu covering Status, Assignee, Labels, Priority, Sprint and Customer. Use the bulk endpoints if the live check passes, otherwise one edit per issue with progress. Acceptance: ten selected issues change status in one action; a refusal names the issues it skipped; `Cmd+Z` undoes the batch; `Esc` clears the selection. Needs a live check that the bulk endpoints accept PSAPAC.
5. **Command menu actions.** Make `Cmd+K` show the issue in context as a chip and list its actions with their keys: assign, assign to me, change status, change priority, add labels, set sprint, create sub-issue, copy key and link, open in Jira, go to a view. Acceptance: every action runs the same mutation as its picker; the menu shows the shortcut beside each; searching still finds issues; with a selection the actions apply to all of it once story 4 lands.
6. **Sprint page.** Open a sprint as a page with a right panel: dates, goal, scope, started and completed counts, a progress bar, and tabs for Assignees, Labels, Priority, Customer and Engagement showing "N% of M". Add Current and Upcoming sprint entries to the sidebar. Acceptance: the active sprint opens from the sidebar and the picker; counts equal the sprint's issues; the page reads `GET /rest/agile/1.0/sprint/{id}/issue` through core and `jm sprint list` shows the same sprint; the burndown line is out of scope.
7. **Customer and Epic overview.** Add progress (done over total) to Epic rows and to the "Sub-issue of" line on the issue page, an Epics table with columns Customer, Status, Priority, Assignee, Issues, Due date and percent done, and a Customers page with open count and percent done per Customer. Acceptance: the counts match `buildHierarchy` including Done children once that phase loads; the Epics table sorts by each column and opens an Epic; the Customers page lists every Customer in the Project and opens the Tree filtered to it.
8. **Blocked badge on rows.** Request `issuelinks`, and show a red pill with a count on rows that open blockers hold up and a second pill on rows that block open issues, with the tooltip "Blocking 2 issues". Acceptance: the pill counts open blockers only; it clears when the blocker reaches Done; the Peek lists the blockers; the recorded link fixtures drive the test.
9. **Add sub-issue.** Add an Add sub-issue button and a create-from-pasted-list form to the issue page, with a progress count in the section heading. Acceptance: a pasted list of five titles makes five Subtasks under the Story with the parent's Customer and Engagement; each shows in the Subtasks section at once; a Subtask cannot be added under an Epic.
10. **Quick actions.** Add `I` to assign to me, number keys in the Status and Priority pickers, click-to-change on a row's status dot and avatar, a "+" on group headers that opens create with that group's Customer, copy key and copy link, and the description in the Peek. Acceptance: each works from the Tree without opening the page; the keys obey the guard in `keymap.ts`; `docs/reference/shortcuts.md` lists them; the Peek shows the description read-only.
11. **Saved view upkeep.** Add Update view with the current filters, Duplicate view and a drag order to the sidebar, show views as tabs over the list, and ship starter views Active (In Progress, Review) and Backlog (Opportunity, To Do, Hold). Acceptance: Update view rewrites `views.json` through core and the CLI reads it; the starters appear for a new user; ordering survives a restart.
12. **Search descriptions and comments.** Add a "Search text in Jira" row to the Palette that runs JQL `text ~` through core, debounced and cancellable, and opens the match. Acceptance: a word that only a description holds finds its issue; the loaded-issue ranking stays first. Supersedes Q37 option a, so record that in the grilling record.
13. **Favourites and recents.** Add a sidebar Favourites section for issues and views, a star on the issue page, `Alt+F` to toggle, and a Recent list at the top of the Palette. Acceptance: favourites and recents persist in a state file; a deleted issue drops out with a notice; the Palette shows the last ten opened issues before any query.
14. **Activity feed.** Add the issue's history to the Activity section, interleaved with comments: status, assignee, priority, sprint, link and field changes with author and age, with runs of related events collapsed under "Show N events". Acceptance: the feed reads the changelog through core; it pages; it matches the history Jira shows for three recorded issues; description edits show as one line.
15. **Inbox.** Add an Inbox page listing issues assigned to, reported by or watched by the user that changed since the user last looked, with unread marks, mark all read and a badge. Acceptance: it polls on window focus and every few minutes; each entry names the change from the changelog; opening an entry marks it read; a live check confirms the `watcher` clause on PSAPAC before the story starts.

## Open Questions

Each needs a live PSAPAC call or an answer from Shane, and none was made here.

- Do the bulk endpoints accept the team-managed PSAPAC project (simple board 1706, `F:board-psapac.json`)? Round 2 records "You hold every permission needed", so the Bulk change permission is not in doubt (story 4).
- Does JQL `watcher = currentUser()` return issues on PSAPAC (story 15 and the My issues tabs)?
- Can a sprint's progress derive from the changelog alone, since the sprint API documents no report (the Later cycle graph row)?
- How does PSAPAC use the "PS TEMPLATES" sprint and the "PS Project Templates" field? If as template Epics, project templates move from Later to Build.

## Sources Read

Date read for every page: 2026-10-10. Linear's docs index at https://linear.app/docs and the page list at https://linear.app/llms.txt gave the navigation. Pages came through the `.md` form of each URL. All 33 screenshots in `docs/design/linear/` were viewed on the second pass.

Read in full, under `https://linear.app/docs/`: creating-issues, assigning-issues, select-issues, parent-and-sub-issues, issue-templates, comment-on-issues, delete-archive-issues, issue-property (status, priority, labels, relations, estimates, SLAs, due dates), use-cycles, cycle-graph, project-graph, inbox, my-issues, favorites, notifications, board-layout, timeline, custom-views, editor, search, filters, display-options, peek, triage, triage-intelligence, linear-asks, customer-requests, projects, project-milestones, project-priority, project-status, project-labels, project-dependencies, project-notifications, project-templates, initiatives, sub-initiatives, initiative-and-project-updates, default-team-pages, teams, sub-teams, private-teams, dashboards, insights, pulse, documents, account-preferences, profile, security-and-access, conceptual-model, start-guide, get-the-app, github, jira, slack, coding-sessions, diffs, releases and code-and-reviews.

Read in part: linear-agent (the overview and the chat and comment sections), and loops, agents-in-linear, code-intelligence and mcp by headings and opening lines only. They describe Linear's hosted agents and do not change a row.

Not read: the Asks pages for Slack, email and web forms (linear-asks-slack, linear-asks-email, linear-asks-web-forms); the integration pages other than GitHub, Slack and Jira; the administration pages (workspaces, login-methods, invite-members, members-roles, saml-and-access-control, scim, api-and-webhooks, third-party-application-approvals, security, audit-log, billing-and-plans, ai-credits, usage-and-limits, exporting-data); the importer pages other than Jira; and the developer pages. They describe administration, integrations and APIs, not the user functionality this analysis compares.

Not available: https://linear.app/docs/issue-relations loads the Issue properties page, whose Issue relations section was read. https://linear.app/docs/configuring-workflows returned 404, and the Issue status section of the Issue properties page covers workflows. https://linear.app/docs/issue-properties-home has no body of its own.

jira-mgr evidence: `AGENTS.md`, `CONTEXT.md`, `ARCHITECTURE.md`, `apps/desktop/README.md`, `docs/reference/shortcuts.md`, `docs/reference/cli.md` (command list and `jm issue list` options), `docs/product/roadmap.md`, `docs/discovery/2026-10-07-product-grilling.md`, round 2 of its folder, `docs/design/linear/README.md` and all 33 screenshots, and the desktop and core source named in the matrix, at `origin/main` on the run date. The app was not launched.
