# CLI

The `jm` command, used by people and agents alike. Package `@jira-mgr/cli`, built with tsup and Commander. Today it runs `jm help`, `jm auth login`, `status` and `logout`, and the reads: `jm issue list`, `tree` and `get`, `jm field options`, `jm link types`, `jm sprint list` and `jm view list`, the writes `jm issue create`, `edit` and `delete` and `jm status set`, and the extras: `jm comment`, `jm worklog`, `jm link list`, `add` and `remove`, `jm attach` and `jm sprint set`, and the timer: `jm timer start`, `stop`, `status`, `pause` and `resume`. The design is [0001](../../docs/design/0001-cli-command-schema.md), and every command is documented in [cli.md](../../docs/reference/cli.md).

## Run

```
pnpm build
pnpm -s jm -- --help
pnpm -s jm -- help --json
pnpm -s jm --version
```

`pnpm -s jm` runs `scripts/jm.ts`, which starts the built binary at `dist/index.js`.

## Rules

- Commands read noun then verb: `jm issue get`, `jm view list`, `jm timer start`.
- `jm timer start/stop/status/pause/resume` shares one timer state file with the app. `jm timer stop` logs a worklog straight away; `--comment` adds a comment and `--discard` drops the timer.
- Every command accepts `--json`. Its output shape is a public contract: change it additively.
- Only `jm auth login` prompts, and only on a terminal. Every other command exits 2 naming the missing value, so scripts and agents never hang.
- Markdown is the input format for descriptions. `--description-file` and `--adf` take a path or `-` for stdin, read only a regular file of at most 1 MiB, and `--adf` is validated as ADF before anything is sent. At most one description input is allowed.
- `jm issue delete` needs `--confirm`, and `--with-subtasks` when the issue has subtasks. Both checks run before any delete request.
- The CLI calls `@jira-mgr/core` and nothing else. Business rules live there.
- `src/schema.ts` is the one definition of every command. `--help`, `jm help --json` and `docs/reference/cli.md` all derive from it. A command with no handler in `src/commands/index.ts` stays hidden. Change the schema, then run `pnpm docs:reference`.
- tsup bundles `@jira-mgr/core` and `zod` into the binary, because they sit in `devDependencies`. Runtime dependencies stay external.

## Output

- A terminal gets tables and text. A pipe, or `--json`, gets one JSON value on stdout: `{"data": ...}` or `{"error": {"code", "message", "details"}}`.
- Exit codes are 0, 2, 3, 4 and 5 for the `JiraMgrError` codes, 1 for `internal` and 130 for Ctrl-C. See [errors.md](../../docs/reference/errors.md).

## Layout

```
src/index.ts                    bin entry
src/run.ts                      run(argv, io, deps): parse, dispatch, print, exit code
src/schema.ts                   every command, as data
src/program.ts                  Commander built from the schema
src/help.ts                     the help document and the --help extras
src/values.ts                   one parser per value type
src/output.ts                   envelope, tables, colour, control-character stripping
src/context.ts                  Io, Context (with `me()`) and the Handler type
src/prompt.ts                   one-line terminal prompt, hidden for the token
src/resolve.ts                  names to ids: Customer, Engagement, priority and assignee
src/input.ts                    reads Markdown and ADF from a file or stdin
src/site.ts                     the site in settings, checked, for issue links
src/commands/index.ts           the registry of handlers
src/commands/<noun>/<verb>.ts   one file per command, with `<verb>.int.test.ts` beside it
```
