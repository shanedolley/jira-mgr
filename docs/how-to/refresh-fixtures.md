# Refresh Fixtures

Re-record a PSAPAC response when Jira's shape changes, then point the tests at it. A fixture holds a response body as Jira sent it, with no scrubbing ([Testing](../standards/testing.md#the-fake)).

## Record

1. Set the site, email and token in your shell. Read the token without echo, so it stays out of your shell history, and never write it into a file, a command or a log.

   ```
   export JM_JIRA_SITE=https://engineering-collibra.atlassian.net
   export JM_JIRA_EMAIL=<your email>
   ```

   In zsh:

   ```
   read -rs 'JM_JIRA_TOKEN?Jira API token: ' && export JM_JIRA_TOKEN
   ```

   In bash:

   ```
   read -rsp 'Jira API token: ' JM_JIRA_TOKEN && export JM_JIRA_TOKEN
   ```

2. Record the call. The name uses lowercase letters, digits and hyphens.

   ```
   pnpm fixture:record -- createmeta-story GET /rest/api/3/issue/createmeta/PSAPAC/issuetypes/11502
   ```

   The script writes `packages/core/fixtures/<name>.json`, pretty-printed, and prints the path. It saves the body only, never a header. It allows any `GET`, and `POST` only to `/rest/api/3/search/jql`. It refuses every other write, any path outside `/rest/` and any `JM_JIRA_SITE` that is not `https://<name>.atlassian.net`, before it sends the token (`packages/core/scripts/record-fixture.ts`).

3. Unset the three variables.

Name an ADF fixture `adf-description-psapac-<n>` (`GET /rest/api/3/issue/PSAPAC-<n>?fields=description`) or `adf-comments-psapac-<n>` (`GET /rest/api/3/issue/PSAPAC-<n>/comment`). `packages/core/test/adf-fixtures.ts` loads every file with that prefix, so the round-trip tests pick up a new one at once.

## Update the Fake

A test serves a fixture with `serveFixture(method, path, name)` from `packages/core/test/msw.ts`. The createmeta fixtures are wired by `serveCreatemeta`, which maps the five PSAPAC issue type ids to `createmeta-<type>.json`. After a re-record:

1. Run `pnpm test`. A test fails when the new shape breaks a schema or an assertion on the old data.
2. Fix the schema in core, or the assertion, to match what Jira sends now.
3. Check `git diff packages/core/fixtures` shows only the change you meant.

## Commit

State why the shape changed in the pull request, and keep the fixture change in the same pull request as the code that needs it.

[Run live tests](run-live-tests.md) covers the read-only checks against PSAPAC.
