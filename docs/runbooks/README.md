# Runbooks

Steps to follow under pressure: one file per problem or chore, started from [the template](../templates/runbook.md).

| Runbook | For |
|---|---|
| [`l7-smoke-check.md`](l7-smoke-check.md) | Checking every `jm` command against live PSAPAC, with throwaway issues for the writes |
| [`rotate-jira-token.md`](rotate-jira-token.md) | Replacing the API token: create a new one, log in, then revoke the old one |
| [`token-rejected.md`](token-rejected.md) | Jira answers 401 or 403, or no one is logged in |
| [`rate-limited.md`](rate-limited.md) | Jira answers 429 and the app or CLI stalls |
| [`stale-field-ids.md`](stale-field-ids.md) | Customer, Engagement or Sprint writes fail after a Jira admin changes the project's fields |
