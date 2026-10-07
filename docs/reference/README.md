# Reference

Facts to look up. Generate a page from the code where possible, so it cannot drift. Domain terms live in [CONTEXT.md](../../CONTEXT.md).

| Page | Holds | Source | Starts |
|---|---|---|---|
| `cli.md` | Every command: flags, `--json` shape, exit codes | Generated from the CLI command schema by `scripts/gen-reference.ts` | CLI |
| `core.md` | The public `@jira-mgr/core` API | Generated with TypeDoc by `scripts/gen-reference.ts` | Core |
| `errors.md` | Every error code, its exit code, its meaning and the fix | Hand-written, checked against the code in CI | Core |
| `config.md` | The settings file, field id overrides, the saved views file and `JM_` environment variables | Hand-written | Core |
| `shortcuts.md` | Every keyboard shortcut and palette command | Hand-written | Desktop |

A single script, `scripts/gen-reference.ts`, generates `cli.md` and `core.md`. The root script `pnpm docs:reference` runs it. It is written in the CLI milestone.
