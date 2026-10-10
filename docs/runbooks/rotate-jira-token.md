# Rotate the Jira Token

**Use when:** the API token is due for replacement, or you think it leaked.

**Severity:** `jm` and the app fail with `permission_denied` from the moment the old token is revoked until the new one is stored. No data is lost. A leaked token is urgent: revoke first, then log in.

`jm` below means the linked binary ([Install the CLI](../how-to/install-cli.md)), or `pnpm -s jm --` from the repository root.

## Check

1. Run `jm auth status`. It names the site, project and account the current token belongs to, so you know which Atlassian account to rotate in.
2. Close any other `jm` run or agent session using the token.

## Fix

1. In your Atlassian account's security settings, create a new API token and copy it. Never paste it into a file, a command line or a chat.
2. Run `jm auth login`. The site, project and email come from the settings file, so it asks only for the token, with the input hidden. Paste the new token.
3. The login checks the token against Jira, resolves the field ids again, and overwrites the Keychain item `jira-mgr` for that email ([auth and Keychain](../architecture/auth-and-keychain.md)). The app and the CLI read the same item, so both use the new token.
4. Revoke the old token in the same Atlassian settings.

For a leaked token, do step 4 first. Every call then fails with `permission_denied` until step 2 finishes.

Without a terminal, pipe the token in: `jm auth login --token-stdin`.

## Verify

1. `jm auth status` exits 0 and shows your name.
2. `jm issue list --limit 1` returns an issue.
3. Open the app. It loads its issues without a login screen.

## Follow Up

- For a leaked token, find where it leaked and tell Shane.
- A token is never in a log, fixture or commit. If you find one there, treat it as leaked and rotate again ([threat model](../security/threat-model.md)).
