# Grilling Round 1

Tick one box in the **Pick** column per question (several for Q5), and add anything else under **Notes**. **Rec** marks my recommendation.

Pending: a subagent is reading PSAPAC's metadata (issue types, Customer and Engagement field shapes, link types, workflows, sprints, issue counts). Questions that depend on it come in round 2.

---

## Q1 - Credentials

The app and CLI need a Collibra Jira token.


| Option                                                                                                                  | Rec   | Pick  |
| ----------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Read the existing Keychain item `kothar-jira-collibra` plus `COLLIBRA_JIRA_EMAIL`, the same pair `kj collibra` uses | - [x] | - [ ] |
| (b) The app has its own login screen and stores a separate token with Electron `safeStorage`                            | - [ ] | - [x] |
| (c) OAuth 3LO through an Atlassian app registration                                                                     | - [ ] | - [ ] |


Why (a): one token, one rotation point, nothing to register.

**Notes:**

---

## Q2 - App and CLI Architecture

How should the GUI and the CLI share logic?


| Option                                                                                                                                                                                                            | Rec   | Pick  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) One TypeScript repo with a shared `core` module (Jira client, domain rules such as "Customer and Engagement are required"). The Electron main process and the CLI both import it and each calls Jira directly | - [x] | - [ ] |
| (b) The CLI talks to the running app over a local socket                                                                                                                                                          | - [ ] | - [ ] |
| (c) Two separate codebases                                                                                                                                                                                        | - [ ] | - [ ] |


Why (a): the CLI must work for agents while the app is closed, and domain rules in one place mean both front ends enforce them the same way.

**Notes:**

---

## Q3 - CLI Identity and the Ticket-Move Rule

Your CLAUDE.md says only `kothar:project-manager` moves tickets. The guard ignores Collibra today, but an agent-facing CLI with `status`, `delete` and `edit` commands would let any agent transition or delete PSAPAC issues as you.


| Option                                                                                                                                                              | Rec   | Pick  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) The CLI exposes everything; agent discipline is the only guard                                                                                                  | - [ ] | - [x] |
| (b) Destructive or state-changing commands (`delete`, `transition`) require `--confirm`, and the help file says only the project-manager agent may run `transition` | - [x] | - [ ] |
| (c) An env var puts the CLI in an agent mode that refuses writes beyond comments and worklogs                                                                       | - [ ] | - [ ] |


Why (b): cheap, keeps the CLI fully usable by you, and marks the dangerous edges for agents. Extend the ticket guard to the new binary later if agents misbehave.

**Notes:**

---

## Q4 - "Issue Name" vs "Summary"

In Jira the summary is the issue's name. No separate name field exists.


| Option                                              | Rec   | Pick  |
| --------------------------------------------------- | ----- | ----- |
| (a) Summary and description only                    | - [x] | - [x] |
| (b) "Name" means something else (describe in notes) | - [ ] | - [ ] |


**Notes:**

---

## Q5 - Linear Fidelity

Which Linear behaviours belong in v1? Tick every one you want.


| Feature                                                                                                                       | Rec   | Pick  |
| ----------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| Cmd+K command palette                                                                                                         | - [x] | - [x] |
| Single-key shortcuts (`C` create, `S` status, `A` assignee, `L` labels, `P` priority, `E` edit, `J`/`K` navigate, `Esc` back) | - [x] | - [x] |
| List view grouped by hierarchy, collapsible groups                                                                            | - [x] | - [x] |
| Issue detail as a full page with a properties sidebar on the right                                                            | - [x] | - [x] |
| Peek (space bar opens a side preview)                                                                                         | - [x] | - [x] |
| Filter bar (assignee, status, label, type, sprint)                                                                            | - [x] | - [x] |
| Dark and light theme                                                                                                          | - [x] | - [x] |
| Board (kanban) view                                                                                                           | - [ ] | - [ ] |
| Saved views ("My issues", "Current sprint")                                                                                   | - [ ] | - [x] |


Why: the hierarchy list is the main view. Add the board and saved views once the list feels right.

**Notes:**

---

## Q6 - Default List Scope

"All tickets in PSAPAC" can include other people's work and years of Done issues. What should the main view show by default?


| Option                                                                                       | Rec   | Pick  |
| -------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Every issue, every status                                                                | - [ ] | - [x] |
| (b) Unresolved issues from everyone, Done behind a toggle, "Assignee: me" one keystroke away | - [x] | - [ ] |
| (c) Issues assigned to you, with a toggle for everyone                                       | - [ ] | - [ ] |


**Notes: Add a toggle for "assignee: me" and "hide done". If a parent is not yet done, child items at the done status should be hidden.**

---

## Q7 - Freshness and Offline

Linear feels instant because it keeps a local replica.


| Option                                                                                                  | Rec   | Pick  |
| ------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Live fetch with in-memory caching (TanStack Query), refetch on window focus, optimistic UI on edits | - [x] | - [x] |
| (b) Local SQLite replica with background sync and offline edits                                         | - [ ] | - [ ] |


Why (a): offline sync and conflict resolution are a project of their own, and optimistic updates give most of the speed. I'll revisit if the issue count comes back large.

**Notes:**

---

## Q8 - Description Editor

Jira stores descriptions and comments as ADF (Atlassian Document Format).


| Option                                                                                                                                                                                                                            | Rec   | Pick  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Rich editor (TipTap/ProseMirror) with Linear-style markdown shortcuts, converting to and from ADF: headings, lists, code, links, quotes, inline images. Unsupported content (panels, macros) stays intact as read-only blocks | - [x] | - [x] |
| (b) Plain markdown textarea, converted to ADF on save                                                                                                                                                                             | - [ ] | - [ ] |
| (c) Option (a) plus @mentions and Jira panels                                                                                                                                                                                     | - [ ] | - [ ] |


**Notes:** 

---

## Q9 - Deleting Issues

Jira deletes permanently, and an issue with subtasks needs `deleteSubtasks=true`.


| Option                                                                                                                                                      | Rec   | Pick  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) GUI: confirm modal listing any subtasks deleted with it. CLI: refuses without `--confirm`, and refuses to cascade to subtasks without `--with-subtasks` | - [x] | - [x] |
| (b) A simple confirm in the GUI and `--confirm` in the CLI, cascading automatically                                                                         | - [ ] | - [ ] |
| (c) No confirmation                                                                                                                                         | - [ ] | - [ ] |


**Notes:**

---

## Q10 - Sprint Editing Scope


| Option                                              | Rec   | Pick  |
| --------------------------------------------------- | ----- | ----- |
| (a) Move an issue into or out of a sprint           | - [x] | - [x] |
| (b) Also create, rename, start and complete sprints | - [ ] | - [ ] |


Why (a): sprint lifecycle is board-admin work you probably do rarely.

**Notes:**

---

## Q11 - Work Logging Scope


| Option                                                                                                       | Rec   | Pick  |
| ------------------------------------------------------------------------------------------------------------ | ----- | ----- |
| (a) Add, edit and delete your own worklogs; remaining estimate auto-adjusts; worklog list shown on the issue | - [x] | - [x] |
| (b) Add only, remaining estimate auto-adjusts                                                                | - [ ] | - [ ] |
| (c) Option (a) plus a manual remaining-estimate field on each log                                            | - [ ] | - [ ] |


**Notes:**

---

## Q12 - CLI Shape and Agent Help

### Binary Name


| Option        | Rec   | Pick  |
| ------------- | ----- | ----- |
| `jm`          | - [x] | - [x] |
| `pj`          | - [ ] | - [ ] |
| Other (notes) | - [ ] | - [ ] |


### Output Format


| Option                                                        | Rec   | Pick  |
| ------------------------------------------------------------- | ----- | ----- |
| (a) Human tables on a TTY, JSON when piped, `--json` to force | - [x] | - [x] |
| (b) Always JSON, `--pretty` for humans                        | - [ ] | - [ ] |


### Help System


| Option                                                                                                                                                                                                                                                   | Rec   | Pick  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) One command schema (args, types, required flags, enum values, examples, exit codes) drives `--help`, `jm help --json` and a generated `AGENTS.md`, so the three never drift. Exit codes: 0 ok, 2 validation, 3 not found, 4 permission, 5 Jira error | - [x] | - [x] |
| (b) Hand-written `--help` text plus a separate hand-written `AGENTS.md`                                                                                                                                                                                  | - [ ] | - [ ] |


**Notes:**

---

## Q13 - Stack and Distribution

electron-vite, React, TypeScript, Tailwind, TanStack Query, Commander for the CLI. macOS only, built locally, unsigned, no auto-update, CLI installed with `npm link`.


| Option                                                  | Rec   | Pick  |
| ------------------------------------------------------- | ----- | ----- |
| (a) As listed                                           | - [x] | - [x] |
| (b) Changes (signing, Homebrew, other libraries: notes) | - [ ] | - [ ] |


**Notes:**