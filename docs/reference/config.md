# Config

The state folder is `~/Library/Application Support/jira-mgr/`. `JM_STATE_DIR` replaces it. [Settings File](../architecture/auth-and-keychain.md#settings-file) says which file holds what and who writes it. Every file is validated on read (`packages/core/src/state.ts`); a missing file reads as its default.

## settings.json

| Key | Type | Default |
|---|---|---|
| `siteUrl` | URL | unset |
| `projectKey` | non-empty string | unset |
| `email` | email | unset |
| `fieldOverrides` | object, see Settings File | `{}` |
| `timer.rounding` | `none`, `5m` or `15m` | `5m` |
| `timer.reminderThresholdHours` | positive number | `8` |
| `timer.reminderIntervalMinutes` | positive number | `60` |
| `toggles.hideDone` | boolean | `true` |
| `toggles.assigneeMe` | boolean | `false` |
| `toggles.hideEmptyCustomers` | boolean | `true` |
| `display.properties` | array of `labels`, `sprint`, `estimate`, `logged`, `remaining`, `remainingPercent`, `comments`, `start`, `due`, `created`, `updated` | `["updated"]` |
| `display.order` | `key`, `priority`, `updated`, `due`, `status` or `manual` | `key` |
| `display.direction` | `asc` or `desc` | the order's own: `desc` for `key`, `priority` and `updated`, `asc` for `due`, `status` and `manual` |
| `display.manual` | optional array of at most 20000 issue keys | absent |
| `display.priority` | optional boolean | absent: reads as on |
| `display.widths` | optional object of `display.properties` names to whole pixel widths from 1 to 1000 | absent: every column at its default width |
| `treeLevel` | `customers`, `epics`, `stories` or `all` | `stories` |

`fieldOverrides` is described under [Settings File](../architecture/auth-and-keychain.md#settings-file).

`display` is what the Tree shows while no saved view is applied: the row properties after the title, and how issues sort within an Epic, among an Epic's children and in No Epic. `jm` ignores it, as it ignores `toggles`. Every Jira request reads this file, so a value the build does not know never fails it: unknown property names drop, an unknown `order` reads as `key`, an unknown or missing `direction` as the order's default, and a `display` that is not an object reads as the defaults. The properties are kept once each, in the order the file lists them (the order of the Column header, #301): an unknown name or a repeat drops, and a file written before the order was saved holds the old row order, so it reads the same. `direction` was added with #222 and is additive: a file or view without it reads as its order's default direction, so the primary sort is the one every file had before, and loads unchanged. Ties between equal values now break by key in the chosen direction. `asc` is lowest, oldest, soonest or first-listed first; `desc` reverses it. An older build reads a file with `display` without error but drops the key, and its next write loses it, along with `direction`.

`display.manual` and the `manual` order were added with #223 and are additive. `manual` lists issue keys in the order the user dragged them, and the Tree reads it only while `order` is `manual`: each sibling list (the Epics of a Customer, an Epic's children, No Epic, a Story's Subtasks, the Done children behind a chip) follows the list's order, an issue it does not name sits after the named ones by key number ascending, and a key naming no loaded issue is ignored. `direction` does not apply to `manual`, and a `manual` view carries `asc`. The key is absent until the user first moves a row, so a file without it loads unchanged. A value that is not a list of at most 20000 strings reads as no list, and the rest of the display stays. The list is kept when the order changes to another, so choosing Manual again restores it. It never reaches Jira. An older build reads `order: "manual"` as `key`, ignores `manual`, and its next write of the file loses the list.

`display.properties` is also the order of the columns, left to right after the title. The Column header's drag and Alt+Left or Alt+Right rewrite it, and a property turned on in the Display menu goes last. The Tree, the Column header and the Sprint page all draw this order, and a view keeps its own. An older build reads the same file but sorts the properties into its fixed row order.

`display.priority` was added with #306 and is additive. `false` hides the priority slot on every issue row of the Tree and the Sprint page; the slot keeps its place in the row, after the pills and before the properties, and takes no column or header. A missing key, `true` and any other value read as on, so a file without the key loads unchanged and the rest of the display stays. `P`, `Shift+P` and the issue menu still change the priority with it off, and the Peek and the issue page keep their Priority field. An older build ignores the key and shows the slot, and its next write of the file drops the key.

`display.widths` was added with #275 and is additive. It maps a property name to the width in pixels the user dragged its column to on the Tree; a property with no entry draws at its default (Labels 96, Sprint 104, Original estimate, Logged and Remaining 64, Remaining % 48, Start date 96, Due date 96, Created and Updated 72). An entry is kept only for a property in `display.properties` and only as a whole number from 1 to 1000, so a value the build cannot read drops and that column reads as its default, and a `widths` that is not an object, or keeps nothing, reads as none. A column released at 0 is removed from `display.properties` and its entry is dropped, so adding it back starts at the default. The Tree draws a narrower column when the window cannot hold the saved widths and keeps the saved value. The Tree can draw a column at 1px, but the Sprint page floors every column at 16px, since its cells are buttons, so the two can differ. A file without the key loads unchanged. An older build reads a file with `widths` without error, drops the key, and its next write loses the widths.

`treeLevel` is how far the Tree opens, set from the Groups menu or by `Shift+Left` (`customers`) and `Shift+Right` (`all`). `stories` opens Customers, Epics and No Epic and closes each Story, Task and Bug. `jm` ignores it, and a saved view neither carries it nor changes it. A missing key, or a value the build does not know, reads as `stories` and never fails the file. An older build drops the key, and its next write loses it.

## views.json

An array of saved views. The app writes it; `jm` only reads it. The array order is the sidebar and tab order, so a reorder rewrites the array. With no file, the app and `jm` read the starters My issues, Created by me, Current sprint, Active (status In Progress, Review) and Backlog (status Opportunity, To Do, Hold). Once the file exists the starters are ordinary views, and a deleted one does not return.

| Key | Type |
|---|---|
| `id`, `name` | non-empty string |
| `filters.assignee`, `.status`, `.label`, `.type`, `.sprint` | optional array of strings |
| `filters.statusType`, `.priority`, `.customer`, `.engagement`, `.epic`, `.creator`, `.relations` | optional array of strings |
| `filters.dates.due` | optional `overdue`, `today`, `last-7-days`, `last-30-days` or `next-7-days` |
| `filters.dates.created`, `.updated` | optional `today`, `last-7-days`, `last-30-days` or `next-7-days` |
| `filters.not` | optional object holding any of the array keys above (every one but `text` and `dates`), the values to leave out |
| `filters.text` | optional string |
| `toggles` | the same three keys and defaults as `settings.json` |
| `display` | optional, the same `properties`, `order`, `direction`, `priority`, `manual` and `widths` as `settings.json` and read as leniently, so each view keeps its own manual order, column widths and Priority setting. A view without it applies no display |

Values within a key are alternatives, and every key that is set must match. The values:

| Key | Values |
|---|---|
| `assignee` | An account id, `me` or `unassigned` |
| `creator` | An account id or `me` |
| `status`, `type`, `priority` | A name in any case, or an id |
| `statusType` | `new`, `indeterminate` or `done`, Jira's status categories |
| `customer`, `engagement` | An option's name in any case, or its id |
| `epic` | An Epic's key, which matches that Epic and every issue under it, Subtasks included. `jm issue list` and `jm issue tree` load every page of both phases for it, so a Subtask under a Done Story is found |
| `relations` | `blocked` or `blocking`: a "Blocks" link with an issue that is not Done |
| `label` | A label, exactly |
| `sprint` | A sprint id or name, or `current` for any active sprint |
| `dates` | One window per date, in the local time zone: `today`; `last-7-days`, today and the 6 days before it; `last-30-days`, today and the 29 before; `next-7-days`, today and the 6 days after. `overdue` is an open issue due before today |

A view's `display` is not part of what makes it the active view: toggling a property keeps the view lit. Applying a view copies its `display`, when it has one, into `settings.json`, as it copies the toggles. Update view saves the current display into the view, and create and duplicate carry it. `jm view list --json` prints each view as stored, so a view with a display carries the key and one without has none.

A `not` key excludes: `{ "status": ["Done"], "not": { "label": ["etl"] } }` keeps Done issues without the label `etl`. A view file written before these keys existed parses unchanged. An older build that reads a newer file drops the keys it does not know, and its next save loses them.

## inbox.json

The Inbox's read marks. The app writes it; `jm` neither reads nor writes it. A missing file reads as nothing read, so the last 14 days show as unread.

```json
{
  "version": 1,
  "allReadAt": "2026-10-10T22:30:00.000Z",
  "reads": { "PSAPAC-3066": "2026-10-10T23:02:41.517Z" }
}
```

| Key | Type |
|---|---|
| `version` | `1`; any other value fails validation |
| `allReadAt` | ISO date-time. Every issue updated at or before it is read |
| `reads` | Issue key to ISO date-time: the `updated` time of the issue when the user opened it |

An issue's read mark is the later of `allReadAt` and its own `reads` entry, and the issue is unread when Jira's `updated` is later than the mark and someone else made the change. Opening an entry sets its `reads` entry to the `updated` time the user saw. Mark all read sets `allReadAt` to the newest `updated` time in the list. Every write drops the `reads` entries that `allReadAt` covers and those older than 14 days, so the file holds at most the issues read in the last 14 days.

## Environment Variables

| Variable | Effect |
|---|---|
| `JM_STATE_DIR` | Replaces the state folder |
| `JM_DEBUG=1` | Logs each HTTP attempt to stderr and prints stacks for unexpected errors |
| `JM_LIVE_JIRA=1` | Opts in to the read-only live PSAPAC tests; `pnpm test:live` sets it |
| `JM_LIVE_KEYCHAIN=1` | Opts in to `auth.live.test.ts`, which uses the real macOS Keychain |
| `JM_JIRA_SITE`, `JM_JIRA_EMAIL`, `JM_JIRA_TOKEN` | Read only by `pnpm fixture:record` |
| `JM_E2E_*`, `JM_AVATAR_SHOT`, `JM_INBOX_SHOT` | Test-only; see [e2e/README.md](../../e2e/README.md) |
