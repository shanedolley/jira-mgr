# Errors and Logging

## Errors

- Every error a client can act on carries a stable `code` in `snake_case`, such as `issue_not_found`. Clients branch on the code, never on the message text.
- Core turns every failure into a typed `JiraMgrError` with `code`, `message` and optional `details`. It maps Jira's HTTP failures to codes: 400 to `validation_failed`, 404 to `not_found`, 401 and 403 to `permission_denied`, anything else from Jira to `jira_error`. Unexpected failures get the code `internal`, and keep the original error as `cause`. `docs/reference/errors.md` lists every code.
- Messages say what went wrong and what to do next: "PSAPAC-12 has subtasks. Pass `--with-subtasks` to delete them too."
- Catch an error only to add context, recover, or translate it at a boundary. Never swallow one silently.
- A new code is additive. Renaming or removing one is a breaking change.

## CLI Output

- `stdout` carries the result only, so it pipes cleanly. Progress, warnings and errors go to `stderr`.
- With `--json`, or whenever `stdout` is piped, a failure prints `{"error": {"code": "...", "message": "..."}}` to `stdout`.
- Exit codes:

| Code | Means |
|---|---|
| `0` | Success |
| `2` | Validation: bad flag, missing value, or input that fails its schema |
| `3` | Not found |
| `4` | Permission denied |
| `5` | Jira error: a failure or an unexpected response from Jira |

- `JM_DEBUG=1` prints debug detail to `stderr`, including each request's method, path and status.

## Logs

- Use `error` for failures that need attention, `warn` for recovered problems, `info` for state changes, `debug` for detail.- Never log the API token, an `Authorization` header, the Keychain item's contents, or issue, comment and description text. Log issue keys and request paths instead.
- `JM_DEBUG` output follows the same rule: redact the `Authorization` header before it prints.
