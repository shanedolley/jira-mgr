# Data Model

Core reads Jira entities and maps them to plain domain types. Everything else about an issue passes through unread. Terms are defined in [CONTEXT.md](../../CONTEXT.md).

## Issue

`issueSchema` in `packages/core/src/issue.ts` maps a Jira issue to the `Issue` type. The description loads per issue, never in a list.

| Domain field | Jira source |
|---|---|
| `key`, `id`, `summary`, `labels` | Same-named fields |
| `issueType` | `issuetype`: `id`, `name`, `subtask`, `hierarchyLevel` |
| `status` | `status`: `id`, `name`, and `category` from `statusCategory.key` |
| `parentKey` | `parent.key` |
| `assignee`, `priority`, `resolution` | Same-named fields, `null` when empty |
| `originalEstimateSeconds`, `remainingEstimateSeconds` | `timetracking` |
| `dueDate` | `duedate` |
| `customer`, `engagement` | The resolved custom fields, as `{ id, value }` |
| `sprints` | The resolved Sprint field, as `{ id, name, state }`, `[]` when empty |
| `startDate`, `timeRemainingHours` | The resolved Start date and Time remaining (h) fields |
| `created`, `updated` | UTC ISO text, converted from Jira's offset form |

A value that fails the schema throws `jira_error`.

## Issue Types

PSAPAC has five types: Epic, Story, Task, Bug and Subtask. `propertyRules` in `issue.ts` decides what each type shows:

- Sprint: every type but Epic and Subtask.
- Estimates and parent: every type but Epic.
- Type change: Story, Task and Bug only (`assertTypeChangeAllowed`).

The Tree nests Customer, then Epic, then Story, Task or Bug, then Subtask (`packages/core/src/hierarchy.ts`).

## Custom Fields

Four custom fields carry the rules: Customer, Engagement, Sprint and Start date. A fifth, Time remaining (h), joins them. Core finds each id by name at login and never hard-codes one ([ADR-0004](../adr/0004-custom-fields-resolved-by-name.md)). The five names are `FIELD_NAMES` in `packages/core/src/state.ts`. Resolution and the override setting are in [auth and Keychain](auth-and-keychain.md#field-resolution).

`createIssue` requires Customer and Engagement for every issue type (`packages/core/src/write.ts`). Their allowed values come from the create metadata, which also feeds `jm field options` (`packages/core/src/lookups.ts`).

## Statuses

`STATUS_ORDER` in `hierarchy.ts` fixes the display order: Opportunity, To Do, In Progress, Review, Hold, Done, then any other. The `category` (`new`, `indeterminate`, `done`, `undefined`) drives the search phases. Core changes status by transition (`listTransitions` and `transitionIssue` in `write.ts`), not by a field write.

## Search

`searchIssuePages` in `search.ts` posts to `/rest/api/3/search/jql` with `project = <key> AND <condition> ORDER BY key DESC`. It runs two phases in order: `statusCategory != Done`, then `statusCategory = Done`. It follows `nextPageToken` until `isLast`. Jira sends no total, so only a running count exists.

## Links

A link joins two issues with one of the site's link types (`listLinkTypes` in `extras.ts`). A type has an `inward` and an `outward` phrase. `Blocks` reads "blocks" outward and "is blocked by" inward. Jira's create call names the blocking issue `inwardIssue`, and core relies on that.

## Sprints

A sprint belongs to the project's board. `findBoard` in `sprints.ts` picks the first board of type `scrum` or `simple`, since a Kanban board has no sprints. `listSprints` returns active and future sprints, or all with `all`. A sprint has `state` `active`, `future` or `closed`, and dates that may be `null`.

## Other Entities

Comments, worklogs and attachments are in `extras.ts`. Descriptions and comment bodies are ADF, converted in `adf.ts` ([documents and editor](documents-and-editor.md)). The saved view, timer and settings shapes are in `state.ts`.
