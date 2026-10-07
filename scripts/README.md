# Scripts

Repository automation that root `package.json` scripts and CI call.

| Script              | Does                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `jm.ts`             | Runs the built CLI for `pnpm jm`, dropping the `--` that pnpm forwards                          |
| `record-fixture.ts` | Records one read-only Jira response body to `packages/core/fixtures/` for `pnpm fixture:record` |

## Record a Fixture

```
pnpm fixture:record -- <name> <GET|POST> <path> [json-body]
```

The script reads `JM_JIRA_SITE`, `JM_JIRA_EMAIL` and `JM_JIRA_TOKEN` from the environment and saves the response body, pretty-printed, to `packages/core/fixtures/<name>.json`. It never saves headers. It allows any `GET`, and `POST` only to `/rest/api/3/search/jql`, and refuses every other write. The Keychain replaces the environment variables once the token store lands.

Write scripts in TypeScript and run them with `node`, which strips types natively. Each script exits non-zero on failure and prints what to do next. A script that grows options or a test suite becomes a package in `packages/`.
