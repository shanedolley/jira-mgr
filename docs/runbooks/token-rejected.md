# Token Rejected

**Use when:** `jm` exits 4 with `permission_denied` (or 2 for a bad site in settings), or the app shows the same message, saying "Log in again" where the CLI says to run `jm auth login`. The message reads `Jira answered 401 to ...`, `Jira answered 403 to ...`, `Jira rejected the email or API token` or `Not logged in`.

**Severity:** the affected user cannot read or write. Other users and Jira are fine.

`jm` below means the linked binary ([Install the CLI](../how-to/install-cli.md)), or `pnpm -s jm --` from the repository root.

## Check

1. Run `jm auth status`. Match the message:

   | Message | Meaning |
   |---|---|
   | `Not logged in` | Settings hold no site or email, or the Keychain holds no token (`getCredentials` in `packages/core/src/auth.ts`) |
   | `Jira answered 401` | Jira does not accept the email and token: the token is expired or revoked, or the email is wrong |
   | `Jira answered 403` | Jira knows the account but refuses this call: it lacks access to the project or the action |
   | `No project is set` | `permission_denied`: settings hold no project key (`assertInProject` in `packages/core/src/state.ts`) |
   | `The site URL in settings is not an https://<name>.atlassian.net site` | `validation_failed`, exit 2: `settings.json` was edited to a bad site |

2. For `Not logged in`, check whether the Keychain item exists. This prints its attributes and never the token:

   ```
   security find-generic-password -s jira-mgr
   ```

   Exit 44 means no item.

## Fix

- **Not logged in, no project, 401, or a bad site:** run `jm auth login --site https://<name>.atlassian.net --project <key> --email <email>`. It prompts for the token, hidden. To create a new token first, follow [Rotate the Jira token](rotate-jira-token.md).
- **403:** ask a Jira admin for access to the project, or confirm the key you used belongs to the configured project. A new token does not help while the account lacks the permission.
- **A project switch:** `jm` manages one project. A key from another project fails with `validation_failed` before any request ([auth and Keychain](../architecture/auth-and-keychain.md)).

## Verify

1. `jm auth status` exits 0.
2. The command that failed now succeeds.

## Follow Up

- A token revoked without your doing it: tell Shane.
- A missing Keychain item that you did not delete: check whether `jm auth logout` or the uninstall steps in [Install the desktop app](../how-to/install-desktop-app.md) ran.
