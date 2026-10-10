# Stale Field IDs

**Use when:** a write that sets Customer, Engagement, Sprint, Start date or Time remaining (h) fails with `validation_failed` (exit 2), usually naming a `customfield_` id, or those fields read as empty everywhere. A Jira admin has renamed, replaced or moved one of the fields.

**Severity:** the affected writes fail for every user of the project. Reads of other fields still work.

`jm` below means the linked binary ([Install the CLI](../how-to/install-cli.md)), or `pnpm -s jm --` from the repository root.

## Check

1. Run `jm auth status`. Note the `Fields resolved` time. Core resolved the ids then and has not looked since ([ADR-0004](../adr/0004-custom-fields-resolved-by-name.md)).
2. Read the ids core uses:

   ```
   cat "$HOME/Library/Application Support/jira-mgr/fields.json"
   ```

   If `JM_STATE_DIR` is set, read the file in that folder. The file holds ids and no secret.
3. Ask the Jira admin which field ids now carry the five names, and whether two fields share a name on the project's screens.

## Fix

1. Have your API token ready, or create one as in [Rotate the Jira token](rotate-jira-token.md). Run `jm auth login`. The site, project and email come from settings, so it asks only for the token, hidden. Login resolves every field again from the project's create metadata and rewrites `fields.json`.
2. If login fails with `Cannot resolve these fields ... (missing)` or `(ambiguous: customfield_..., customfield_...)`, set the right id in the settings file, `~/Library/Application Support/jira-mgr/settings.json`:

   ```json
   {
     "fieldOverrides": { "sprint": "customfield_10600" }
   }
   ```

   Keep every other key in the file. The names are `customer`, `engagement`, `sprint`, `startDate` and `timeRemaining`. An override must appear on one of the project's screens, or login fails and names the field. Run `jm auth login` again.
3. Quit and reopen the app.

## Verify

1. `jm auth status` shows a new `Fields resolved` time.
2. `jm issue get <key>` for an issue you know shows its Customer and Engagement.

## Follow Up

- Remove an override when the admin fixes the duplicate field, so core goes back to resolving by name.
- Ask the admin to announce field changes. See [auth and Keychain](../architecture/auth-and-keychain.md#field-resolution) for how resolution works.
