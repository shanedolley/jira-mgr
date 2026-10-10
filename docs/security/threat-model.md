# Threat Model

jira-mgr holds one secret, the Atlassian API token, and reads one project's issues. It runs on the user's Mac, calls only Atlassian's cloud and has no server of its own. [SECURITY.md](../../SECURITY.md) says how to report a vulnerability.

## Assets

| Asset | Where it lives |
|---|---|
| API token | Keychain item, service `jira-mgr`, account is the login email ([ADR-0003](../adr/0003-token-in-own-keychain-item.md)) |
| Issue data | The Jira site, and in memory in the app and each CLI run. No replica on disk ([ADR-0002](../adr/0002-live-fetch-without-replica.md)) |
| State files | `settings.json`, `fields.json`, `views.json`, `timer.json` in `~/Library/Application Support/jira-mgr/`. They hold no secret |
| Recorded fixtures | The 61 files in `packages/core/fixtures/` are PSAPAC responses as recorded, with customer text, committed to the repository. The repository must stay private |
| Recorder environment | `JM_JIRA_TOKEN`, `JM_JIRA_EMAIL` and `JM_JIRA_SITE` while `packages/core/scripts/record-fixture.ts` runs |

## Trust Boundaries

| Boundary | Rule |
|---|---|
| Renderer to main | The renderer is untrusted. It reaches the site only through validated IPC and never holds the token |
| App or CLI to the site | Only `https://<name>.atlassian.net`, only paths under `/rest/`, no redirects |
| Process to Keychain | Only through `/usr/bin/security` |
| Site content to the user | Descriptions, comments, filenames, avatar URLs and attachments are untrusted input |
| State folder to core | Any local process can edit the files, so core validates them on every read |

## Threats

| Threat | Control |
|---|---|
| Token on a command line or in the process list | The Keychain write sends `add-generic-password` to `security -i` on stdin (`packages/core/src/auth.ts`). `jm auth login` has no token flag: it prompts with hidden input or reads `--token-stdin`. Commander's echo of an unknown option or extra argument is redacted (`apps/cli/src/run.ts`) |
| Token in a log, error or test fixture | Error messages and `details` carry no request header (`failure` in `http.ts`). `JM_DEBUG` prints the method, path and status, never a query string or header. Keychain errors drop `security`'s stderr. IPC validation errors name the field, never the value. Fixtures save response bodies only (`packages/core/scripts/record-fixture.ts`). `.gitignore` excludes `.env` files and review checks each diff for secrets |
| Token sent to the wrong host | `parseSiteUrl` accepts only `https://<name>.atlassian.net` with no path, port or credentials, at login, in `getCredentials` and again in every request. `assertJiraPath` refuses a path outside `/rest/` or holding `..`. Requests use `redirect: 'error'`. An edited `settings.json` cannot steer the token away |
| Token exposed by the fixture recorder | `packages/core/scripts/record-fixture.ts` reads `JM_JIRA_TOKEN` from the environment, which child processes inherit. It passes `JM_JIRA_SITE` through `parseSiteUrl` before any request, refuses a site that fails, and sends to the normalised origin ([#105](https://github.com/shanedolley/jira-mgr/issues/105)). It also refuses writes and paths outside `/rest/`, uses `redirect: 'error'`, and [Refresh fixtures](../how-to/refresh-fixtures.md) has you read the token without echo and unset it afterwards. `record-fixture.test.ts` checks that a non-Atlassian site is refused before `fetch` |
| Characters that break the `security -i` command | `assertStorable` rejects quotes, backslashes, control characters and oversized values. A write is read back and removed when it differs |
| Over-scoped token | The token has the account's full access. Core limits what the product does: every write passes `assertInProject`, so a key outside the configured project fails before any request, and no test writes to the site. The residual risk is a token that can do more than jira-mgr does. [Rotate the Jira token](../runbooks/rotate-jira-token.md) replaces it |
| Renderer compromise | The window sets `contextIsolation` and `sandbox`, and turns `nodeIntegration` off (`apps/desktop/src/main/app.ts`). The page carries a content security policy of `default-src 'self'` with scripts from `'self'` only (`renderer/index.html`). The preload script exposes the IPC channels and three event subscriptions. Main accepts a call only from the main frame of its own window, showing its own page (`trust.ts`), and validates every argument with zod. Navigation and new windows are denied, and every permission request is refused |
| Malicious link in site content | Links open in the browser only after `externalUrl` accepts them: `http`, `https` or `mailto`, with no ambiguous characters (`apps/desktop/src/shared/links.ts`) |
| Malicious ADF content | Read-only nodes render as React text, never HTML. Pasted HTML keeps raw ADF only when it carries this session's nonce. Image tags have no paste rule, so a pasted page loads no remote image. Core validates every node and refuses deep nesting ([documents and editor](../architecture/documents-and-editor.md)) |
| Hostile image or avatar fetch | Avatars load over https from the site, `*.atl-paas.net` and `secure.gravatar.com` only. Credentials go to the site host alone. A host fetched without credentials may redirect once, to an avatar host or `i0.wp.com`, `i1.wp.com` or `i2.wp.com` (Gravatar's initials image), over https with no userinfo or port and with no credentials; the site host's redirects and any second redirect are refused. Size is capped and the type comes from magic bytes with no SVG (`main/avatars.ts`). Attachment previews are checked by magic bytes and size (`main/images.ts`, `main/media.ts`) |
| Tampered or corrupt state file | Each file has a schema. A file that fails it throws `validation_failed` naming the file. Field overrides must appear on the project's screens |
| Unwanted file write on download | Only a native save dialog supplies the path (`main/save.ts`); the renderer never names one |
| Test code in the shipped app | `pnpm package` fails when the app holds the e2e entry or fake markers (`scripts/package.ts`) |

## Out of Scope

- Malware running as the user. It can run `/usr/bin/security`, as core does, and read the state files.
- An unsigned build. Version 1 has no code signing or auto-update, so a build is as trustworthy as the machine that made it ([Install the desktop app](../how-to/install-desktop-app.md)).
- Another user of the same Atlassian account.
