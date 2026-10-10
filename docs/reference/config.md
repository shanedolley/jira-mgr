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
| `filters.text` | optional string |
| `toggles` | the same three keys and defaults as `settings.json` |

## Environment Variables

| Variable | Effect |
|---|---|
| `JM_STATE_DIR` | Replaces the state folder |
| `JM_DEBUG=1` | Logs each HTTP attempt to stderr and prints stacks for unexpected errors |
| `JM_LIVE_JIRA=1` | Opts in to the read-only live PSAPAC tests; `pnpm test:live` sets it |
| `JM_LIVE_KEYCHAIN=1` | Opts in to `auth.live.test.ts`, which uses the real macOS Keychain |
| `JM_JIRA_SITE`, `JM_JIRA_EMAIL`, `JM_JIRA_TOKEN` | Read only by `pnpm fixture:record` |
| `JM_E2E_*`, `JM_AVATAR_SHOT` | Test-only; see [e2e/README.md](../../e2e/README.md) |
