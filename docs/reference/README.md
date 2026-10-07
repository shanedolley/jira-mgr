# Reference

Facts to look up. Generate a page from the code where possible, so it cannot drift. Domain terms live in [CONTEXT.md](../../CONTEXT.md).

| Page | Holds | Source | Starts |
|---|---|---|---|
| `cli.md` | Every command: flags, `--json` shape, exit codes | Generated from the CLI command schema by `scripts/gen-reference.ts` | CLI |
| `errors.md` | Every error code, its exit code, its meaning and the fix | Generated from `ERROR_HELP` in `@jira-mgr/core` by `scripts/gen-reference.ts` | CLI |
| `core.md` | The public `@jira-mgr/core` API | Generated with TypeDoc by `scripts/gen-reference.ts`; not written yet, because it needs a TypeDoc dev dependency | Later |
| `config.md` | The settings file, field id overrides, the saved views file and `JM_` environment variables | Hand-written | Core |
| `shortcuts.md` | Every keyboard shortcut and palette command | Hand-written | Desktop |

A single script, `scripts/gen-reference.ts`, generates `cli.md` and `errors.md` from the built CLI's `jm help --json`. The root script `pnpm docs:reference` builds the CLI and runs it, and CI fails when the committed pages differ from its output.
