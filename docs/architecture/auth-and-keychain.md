# Auth and Keychain

Login verifies the credentials, resolves the custom field ids, then stores the token in a Keychain item of the app's own and everything else in the state folder. Both clients run the same `login` in `packages/core/src/auth.ts` ([ADR-0003](../adr/0003-token-in-own-keychain-item.md)).

## Login

`login` runs these steps in order and stores nothing until the checks pass:

1. Validate the input. The site must be `https://<name>.atlassian.net` with no path, port or credentials (`parseSiteUrl`). The email must be valid and the token non-empty.
2. Refuse a token or email that the Keychain write cannot carry (`assertStorable`).
3. Call `GET /rest/api/3/myself` with Basic auth, no redirects and a 15 second timeout. A 401 or 403 throws `permission_denied`.
4. Resolve the field ids from the project's create metadata ([below](#field-resolution)).
5. Write `fields.json`, then the Keychain item, then `settings.json`. A failed `fields.json` write leaves no token behind.
6. When the email differs from the one in settings, delete the old account's item.

`jm auth login` and the app's login screen both call it. `logout` deletes every item of the `jira-mgr` service and clears the email from settings. `jm auth status` reports the site, project, account and when the fields were resolved (`apps/cli/src/commands/auth/status.ts`).

## Keychain Item

| Part | Value |
|---|---|
| Service | `jira-mgr` |
| Account | The login email |
| Secret | The API token |

Core reaches the Keychain only through `/usr/bin/security` (`createKeychain`):

- A read runs `find-generic-password -s jira-mgr -a <email> -w`. Exit code 44 means no item.
- A write sends `add-generic-password -U ...` to `security -i` on stdin, so the token stays off the command line. `security -i` exits 0 when its command fails, so core reads the item back and removes it when the token differs.
- The token cannot hold a quote, backslash or control character, and holds at most 1024 bytes. The whole command stays under 4095 bytes.

Error messages never carry `security`'s stderr or arguments.

## Credentials

`getCredentials` reads `siteUrl` and `email` from `settings.json`, re-checks the site with `parseSiteUrl`, and reads the token from the Keychain. It throws `permission_denied` ("Not logged in") when either is missing, and `validation_failed` when the site in settings is not a Jira Cloud site, so a hand-edited file cannot send the token elsewhere. The HTTP client calls it on every request, so a new login takes effect at once (`packages/core/src/http.ts`).

## Field Resolution

`resolveFields` in `packages/core/src/fields.ts` lists the project's issue types, reads the create metadata of each, and matches the names Customer, Engagement, Sprint, Start date and Time remaining (h). A name counts as found when any issue type lists it. Sprint is absent from Epic and Subtask screens, so reading one type is not enough ([ADR-0004](../adr/0004-custom-fields-resolved-by-name.md)).

A missing name, or a name that matches several ids, fails login with `validation_failed` naming each field and its candidates. An override replaces name matching, but its id must still appear on one of the project's screens.

`getFieldIds` returns the ids in `fields.json` with the settings overrides applied. It refuses a `fields.json` resolved for another site or project than settings name.

## Settings File

The state folder is `~/Library/Application Support/jira-mgr/`, or the folder `JM_STATE_DIR` names (`stateDir` in `packages/core/src/state.ts`).

| File | Holds | Written by |
|---|---|---|
| `settings.json` | `siteUrl`, `projectKey`, `email`, `fieldOverrides`, `timer` (`rounding`, `reminderThresholdHours`, `reminderIntervalMinutes`) and `toggles` (`hideDone`, `assigneeMe`, `hideEmptyCustomers`) and `display` (`properties`, `order`, `direction`, `manual`) and `treeLevel` | Login, logout and the app's toggles, display and Tree level |
| `fields.json` | The site, project, `resolvedAt` and the five resolved ids | Login |
| `views.json` | The saved views | The app (`jm` only reads it) |
| `timer.json` | The running timer | `jm timer` and the app, through core |
| `inbox.json` | The Inbox's read marks: `version`, `allReadAt` and `reads` | The app (`jm` neither reads nor writes it) |

Every read validates the file with a schema. A file that is not JSON, or fails its schema, throws `validation_failed` naming the file and saying to fix it or delete it. A missing file reads as its default. Writes go through a temporary file and a rename.

`fieldOverrides` takes any of `customer`, `engagement`, `sprint`, `startDate` and `timeRemaining`, each a `customfield_` id.

```json
{ "fieldOverrides": { "sprint": "customfield_10600" } }
```

[Stale field ids](../runbooks/stale-field-ids.md) covers an override after a Jira admin changes the fields.
