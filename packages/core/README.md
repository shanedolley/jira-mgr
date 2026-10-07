# Core

`@jira-mgr/core`, the package every client imports: the CLI and the desktop app. It will own the Jira client, domain rules, the saved view schema and typed errors with stable codes. It exports `JiraMgrError`, plus `APP_NAME` and `appTitle`. The Node-only state file readers and writers live at `@jira-mgr/core/state`, and the credential functions at `@jira-mgr/core/auth`, so the renderer bundle never pulls in `node:` modules.

Its exported API is public to the other packages, so change it additively.

## Use

Other packages import it by name:

```ts
import { appTitle } from '@jira-mgr/core'
```

The `exports` map points at `src/index.ts`. The package has no build step: tsup and electron-vite bundle the source into each client.

## State Files

`readSettings`, `readViews`, `readTimer` and `readFields` (with matching `write` functions) own the non-secret state in `~/Library/Application Support/jira-mgr/`. Set `JM_STATE_DIR` to use another folder, as the tests do.

- A missing file yields defaults: starter views for `views.json`, `null` for `timer.json` and `fields.json`.
- A file that is not valid JSON or fails its schema throws `JiraMgrError` with code `validation_failed`, and the message names the file. Writes validate first, then write a temp file and rename it.

## Credentials

`@jira-mgr/core/auth` exports `login`, `logout` and `getCredentials`.

- `login({ siteUrl, projectKey, email, token })` accepts only an `https://<name>.atlassian.net` site with no path, port or userinfo. It checks the token with `GET /rest/api/3/myself` (no redirects), then stores the token in the Keychain and `siteUrl`, `projectKey` and `email` in `settings.json`. A 401 or 403 throws `permission_denied` and stores nothing.
- `logout()` deletes every `jira-mgr` Keychain item, even when `settings.json` is corrupt, and clears `email` from settings. A missing item is not an error. `login` deletes the previous account's item when the email changes.
- `getCredentials()` returns `{ siteUrl, email, token }`, or throws `permission_denied` ("Not logged in") when settings hold no email or the Keychain holds no token. A `siteUrl` in settings that fails the login site check throws `validation_failed`, so the token never goes to a tampered site.

The Keychain item has service `jira-mgr` and the email as account. Every call goes through `/usr/bin/security`: reads use `find-generic-password -w`, and writes send `add-generic-password -U` to `security -i` on stdin, so the token never reaches a command line. A token or email holding a quote, backslash or control character is refused, since `security -i` has no safe encoding for it. A token over 1024 bytes or an email over 254 bytes is refused too, because `security -i` reads stdin in 4095-byte chunks and runs any overflow as a new command. `security -i` exits 0 even when its command fails, so a write reads the item back.

## Test

```
pnpm --filter @jira-mgr/core test
```

Vitest runs `<file>.test.ts` beside the source. `pnpm test:live` sets `JM_LIVE_JIRA=1`, the opt-in for tests that read the live PSAPAC Jira. Tests never write to Jira. Integration tests run against an MSW fake fed by the recorded PSAPAC responses in `fixtures/`, served through `test/msw.ts`.

Set `JM_LIVE_KEYCHAIN=1` on macOS to run `auth.live.test.ts`, one test against the real `security` binary, using a throwaway service name it deletes afterwards.
