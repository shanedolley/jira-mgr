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

`fieldOverrides` is described under [Settings File](../architecture/auth-and-keychain.md#settings-file).

## views.json

An array of saved views. The app writes it; `jm` only reads it.

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
