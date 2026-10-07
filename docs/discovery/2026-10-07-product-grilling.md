# jira-mgr Decisions

A Linear-style Electron app and an agent-friendly CLI (`jm`) for one Jira project, PSAPAC on `engineering-collibra.atlassian.net`. Question numbers point back to the round files, rounds 1 to 7.

## Architecture

- One TypeScript repo. A shared `core` module holds the Jira client and domain rules; the Electron main process and the CLI both import it and call Jira directly (Q25).
- Stack: electron-vite, React, TypeScript, Tailwind, TanStack Query, Commander. macOS only, built locally, unsigned, no auto-update; CLI installed with `npm link` (Q13).
- Data: live fetch with in-memory caching, refetch on window focus, optimistic updates. No local replica, no offline edits (Q7). The app loads unresolved issues first (764) and Done issues in the background (about 2000), paging `/rest/api/3/search/jql` by token.

## Auth and Configuration

- The app's login screen and `jm auth login` ask for site URL, project key, email and API token, and store the token in a macOS Keychain item of the app's own, which both read (Q1, Q26).
- One site and project at a time. On login the app resolves Customer, Engagement, Sprint and Start date by name from the project's create metadata, caches the ids, and allows overrides in a settings file. Switching project means logging in again (Q36).
- The settings file also holds the timer settings: rounding step, reminder threshold and reminder interval (Q52, Q55).

## Hierarchy and List

- Tree: Customer -> Epic -> Story, Task, Bug -> Subtask, in collapsible groups (Q5).
- A child whose Customer differs from its Epic's sits under the Epic, grouped by the Epic's Customer, with a mismatch badge and a one-click "match Epic's Customer" fix (Q15).
- Stories without an Epic sit in a "No Epic" group under their Customer (Q17).
- Customers sort alphabetically, with "Collibra (Internal team)" and "Collibra (Internal template)" last (Q29).
- Scope covers every issue and status. Toggles: "Hide done" (on at first launch), "Assignee: me" (off), empty Customers hidden (on). Each toggle remembers its last state (Q6, Q28).
- Under an open parent, Done children always hide behind an "N done" chip that reveals them. "Hide done" hides Done parents with their whole subtree (Q27).
- Status order and icons: Opportunity, To Do, In Progress, Review, Hold (paused icon), Done. Status changes need no extra fields (Q21).

## Linear Behaviour

- Cmd+K palette, which also searches loaded issues by key and summary (Q5, Q37).
- Single-key shortcuts: `C` create, `S` status, `A` assignee, `L` labels, `P` priority, `E` edit, `J`/`K` navigate, `Esc` back (Q5).
- Issue detail as a full page with a properties sidebar; space-bar peek; filter bar for assignee, status, label, type and sprint; dark and light themes (Q5).
- Saved views: you create, rename and delete them, stored as local JSON that the CLI also reads. "My issues" and "Current sprint" ship as starters (Q30).
- Undo: Cmd+Z, or the "Undo" button on the toast after each edit, reverts field edits (status, assignee, labels, dates, estimates, sprint, parent, Customer, Engagement, priority, type, summary, description) by writing the previous value back, newest first through a session stack. Creates, deletes, comments, worklogs, attachments and links can't be undone (Q38).

## Issue Operations

- Create: `C` opens a modal. Type defaults to Story. Parent, Customer and Engagement prefill from the selected issue. Customer and Engagement are required on every type, Task and Bug included. A "Create more" toggle keeps the modal open (Q14, Q33).
- Changing parent: when the new parent's Customer or Engagement differs, the app asks whether to copy them across (Q16).
- Edit summary and description; Jira has no separate name field (Q4). Rich editor (TipTap) with markdown shortcuts, converting to and from ADF. Panels and macros it can't represent stay intact as read-only blocks (Q8).
- Type changes allowed between Story, Task and Bug, if the API accepts them on this project (Q23).
- Delete: the GUI shows a confirm modal listing subtasks deleted with the issue. The CLI refuses without `--confirm`, and refuses to cascade to subtasks without `--with-subtasks` (Q9).
- Comments: add, edit and delete your own, in the same editor (Q34).
- Worklogs: add, edit and delete your own, with the remaining estimate auto-adjusting. The issue page lists its worklogs (Q11). A timer is the second way to create one (see Timer).
- Attachments: drop a file anywhere on the issue page to attach it; drop an image into the description or a comment to attach and embed it inline. 100 MB limit (Q34).
- Links: all 21 types. Blocks, Relates, Duplicate, Causes and Clones come first, the rest below a divider (Q19).
- Sprint: move an issue into or out of a sprint. The picker shows the active sprint and dated future sprints, with "Show all" for the rest. The field is hidden on Epics and Subtasks (Q10, Q20).
- Labels: autocomplete from labels used in the project; typing a new one creates it (Q35).
- Assignee: "Me" and recent assignees first, then type-ahead search of assignable users (Q24).
- Other fields: original estimate (editable), remaining estimate (read-only), start date, due date, priority, Time remaining (h) on Stories, Customer, Engagement, parent, status (Q22, Q31).

## CLI

- Binary `jm`, noun-verb commands: `jm issue list/get/create/edit/delete/tree`, `jm comment add/edit/delete`, `jm worklog add/edit/delete`, `jm timer start/stop/status/pause/resume`, `jm link add/remove/types`, `jm attach add/remove`, `jm sprint set/list`, `jm status set`, `jm field options <field>`, `jm auth login` (Q32).
- Output: human tables on a TTY, JSON when piped, `--json` to force (Q12).
- One command schema drives `--help`, `jm help --json` and a generated reference at `docs/reference/cli.md`. The root `AGENTS.md` stays the repo's agent instructions, as in Nisaba. Exit codes: 0 ok, 2 validation, 3 not found, 4 permission, 5 Jira error (Q12).
- Every command is open to agents with no extra guard beyond delete's `--confirm` (Q3). Your kothar rule that only `kothar:project-manager` moves tickets is not enforced for `jm`, because the ticket guard ignores Collibra.

## Timer

A timer logs a worklog from elapsed time. Manual worklogs stay as decided in Q11.

- One timer state file in the app's config folder, shared by the app and `jm timer`. It survives quitting the app, and either side can stop what the other started (Q49).
- One timer at a time. Starting a timer on another issue stops and logs the running one first (Q50). In the app, switching opens the log-work dialog for the running timer, and confirming or discarding it starts the new timer (Q59).
- App: stop opens the log-work dialog prefilled with the elapsed time and the timer's start time, to add a comment, adjust the time or discard. CLI: `jm timer stop` logs straight away with an optional `--comment`, and `--discard` drops the timer (Q51).
- Rounding is a setting in the settings file: none, 5m or 15m, default 5m (Q52). It rounds to the nearest step with one step as the minimum: 7m logs 5m, 8m logs 10m, 2m logs 5m (Q58).
- Pause and resume keep one timer and log one worklog with paused time excluded. The state file records each running segment, so `jm timer pause/resume` works too (Q53).
- `T` starts or stops the timer on the selected issue. Elapsed time shows on the issue row, the issue page and the sidebar. There is no macOS menu bar item (Q54).
- Stopping a timer that ran past the threshold, or across midnight, asks you to confirm or edit the time. Reminder notifications fire while a timer runs past the threshold. The threshold (default 8 hours) and the interval (default every hour) are settings (Q55).
- Reminders come from the app while it runs, including with its window closed. The CLI sends none, and a quit app sends none (Q55).
- Timer and log work apply to Task, Bug, Story and Subtask, not Epics (Q56).

## Repo Scaffold

Modelled on Nisaba (`koinonau/nisaba/Nisaba`), which supplies layout, standards and templates but no code (Q39-Q48, round 5).

- Mirror Nisaba's root files, Diataxis `docs/` with standards and templates, `.github/` templates, and a README index in every docs folder listing planned pages (Q39, Q48).
- Also ship working tooling now: tsconfigs, lint, Vitest, empty apps that build, and CI (Q39).
- Layout: `apps/desktop` (renderer inside), `apps/cli`, `packages/core`, `packages/config-ts`, `packages/config-lint`, `e2e/`, `scripts/` (Q40).
- Tooling: pnpm workspaces without Turbo, electron-vite, tsup, Vitest, Playwright's Electron driver, ESLint flat config and Prettier (Q41).
- Names: `@jira-mgr/*` packages, `JM_` env prefix, `jm <noun> <verb>` (Q42).
- Work tracking: GitHub issues on `shanedolley/jira-mgr`, `Refs #12` in commits and PRs (Q43).
- These records live under `docs/discovery/` (Q44). Licence: proprietary, Shane Dolley, `UNLICENSED` (Q45).
- Tests: `core` runs against an MSW fake fed by recorded PSAPAC responses, committed as recorded with no scrubbing or obfuscation; the repo and app are approved to hold PSAPAC data. Recordings save response bodies only, never request headers, so credentials are never recorded (Q60, which supersedes Q57). Live PSAPAC reads run only when an opt-in env var is set. Tests never write to Jira (Q46).
- ADRs 0001-0005 land in the scaffold branch, before any feature code (Q47).

## Out of v1

Board view, sprint lifecycle, offline edits, a macOS menu bar timer item (Q54), general desktop notifications (timer reminders are in v1, Q55), @mentions, code signing and auto-update, issue restriction, watchers, issue history, story points, flagged, fix versions, Team, Partner, Contacts, reporter (Q22, Q38).
