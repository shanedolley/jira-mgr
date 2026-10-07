# CLI

The `jm` command, used by people and agents alike. Package `@jira-mgr/cli`, built with tsup and Commander. Today it prints help and a version; real commands arrive with the Jira client.

## Run

```
pnpm build
pnpm jm -- --help
pnpm jm --version
```

`pnpm jm` runs `scripts/jm.ts`, which starts the built binary at `dist/index.js`.

## Rules

- Commands read noun then verb: `jm issue get`, `jm filter list`, `jm timer start`.
- `jm timer start/stop/status/pause/resume` shares one timer state file with the app. `jm timer stop` logs a worklog straight away; `--comment` adds a comment and `--discard` drops the timer.
- Every command accepts `--json`. Its output shape is a public contract: change it additively.
- In a terminal, a command prompts for missing values. Without a TTY it exits with a usage error, so scripts and agents never hang.
- The CLI calls `@jira-mgr/core` and nothing else. Business rules live there.
- tsup bundles `@jira-mgr/core` into the binary, because it sits in `devDependencies`. Runtime dependencies stay external.

## Planned Layout

```
src/index.ts                    entry point and command tree
src/commands/<noun>/<verb>.ts   one file per command, from the first real command
```
