# Reference

Facts to look up. Generate a page from the code where possible, so it cannot drift. Domain terms live in [CONTEXT.md](../../CONTEXT.md).

| Page | Holds | Source | Starts |
|---|---|---|---|
| `cli.md` | Every command: flags, `--json` shape, exit codes | Generated from the CLI command schema by `scripts/gen-reference.ts` | CLI |
| `errors.md` | Every error code, its exit code, its meaning and the fix | Generated from `ERROR_HELP` in `@jira-mgr/core` by `scripts/gen-reference.ts` | CLI |
| `config.md` | Every settings and saved views key with its type and default, and the `JM_` environment variables | Hand-written from `packages/core/src/state.ts` | Core |
| `shortcuts.md` | Every keyboard shortcut and its action | Hand-written from `keymap.ts` and `tree.ts`. The desktop app's `?` overlay reads it at build time | Desktop |

A single script, `scripts/gen-reference.ts`, generates `cli.md` and `errors.md` from the built CLI's `jm help --json`. The root script `pnpm docs:reference` builds the CLI and runs it, and the local CI route fails when the committed pages differ from its output.

The public `@jira-mgr/core` API has no reference page. Read [packages/core/README.md](../../packages/core/README.md) and the source.
