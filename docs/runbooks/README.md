# Runbooks

Steps to follow under pressure: one file per problem or chore, started from [the template](../templates/runbook.md).

Written:

| Runbook | For |
|---|---|
| [`l7-smoke-check.md`](l7-smoke-check.md) | Checking every `jm` command against live PSAPAC, with throwaway issues for the writes |

These pages are not written yet; [#101](https://github.com/shanedolley/jira-mgr/issues/101) tracks them.

| Runbook | For | Planned for |
|---|---|---|
| `rotate-jira-token.md` | Replacing the API token: revoke it in Atlassian, then update the Keychain item | Core |
| `token-rejected.md` | Jira answers 401 or 403: an expired, revoked or under-scoped token | Core |
| `rate-limited.md` | Jira answers 429 and the app or CLI stalls | Core |
| `stale-field-ids.md` | Customer, Engagement or Sprint writes fail after a Jira admin changes the project's fields | Core |
