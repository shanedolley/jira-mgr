# jira-mgr

A Linear-style Electron app and an agent-friendly CLI (`jm`) for one Jira project, PSAPAC on `engineering-collibra.atlassian.net`: a TypeScript pnpm monorepo where `@jira-mgr/core` holds the Jira client and domain rules. [ARCHITECTURE.md](ARCHITECTURE.md) maps the directories, [CONTEXT.md](CONTEXT.md) defines the domain terms, and each folder's `README.md` states what belongs there.

Before changing an area, read its standard from [docs/standards](docs/standards/README.md) and the ADRs in [docs/adr](docs/adr/README.md) that touch it.

## Always

- Put Jira access and domain rules in `@jira-mgr/core`. The desktop app and the CLI import it, and nothing else talks to Jira.
- Resolve Customer, Engagement, Sprint and Start date by name through core. Never hard-code a custom field id.
- Validate every value from Jira, CLI arguments and the settings file with a schema at the boundary ([TypeScript](docs/standards/typescript.md#validation)).
- Keep the CLI command schema as the one source for `--help`, `jm help --json` and `docs/reference/cli.md`.
- Test `core` against the MSW fake. Run live PSAPAC tests only with `JM_LIVE_JIRA=1`, through `pnpm test:live`.
- Use the terms in `CONTEXT.md` in code, commands and docs.
- Branch, commit and merge per [git workflow](docs/standards/git-workflow.md), with `Refs #12` in commits.
- Update docs in the same pull request, per [documentation](docs/standards/documentation.md).
- After `pnpm install` in a new worktree, check the Electron dist with `du -sh node_modules/.pnpm/electron@*/node_modules/electron/dist` (about 307 MB, with `path.txt` beside it). If the dist is missing or truncated, run `node node_modules/.pnpm/electron@*/node_modules/electron/install.js` there, or every e2e test fails to launch.
- Run e2e on one worker with `pnpm e2e --workers=1` and read the worker count in the output. `pnpm e2e -- --workers 1` passes `--` literally and leaves Playwright on 5 workers.
- Finish against the [definition of done](docs/standards/code-review.md#definition-of-done). Merge only on green CI and approval from a reviewer other than the builder.

## Ask First

- Changing a public contract: CLI `--json` output, exit codes, `jm help --json`, the saved views file, the settings file shape or the error codes.
- Adding a runtime dependency, a workspace package or a top-level folder.
- Changing authentication or token handling.
- A decision that is hard to reverse, surprising without context and the result of a real trade-off: it needs an ADR in `docs/adr/`.

## Never

- Write to Jira from a test, or point a test at any project but PSAPAC with read-only calls.
- Commit, print or log the Jira API token. It lives only in the app's own macOS Keychain item.
- Edit an accepted ADR. Supersede it with a new one.
- Commit secrets, or push to `main`.
- Import across packages by relative path; import by package name.

## Generated Files

Regenerate these; never edit them by hand:

| File | Regenerate with |
|---|---|
| `pnpm-lock.yaml` | `pnpm install` |
| `docs/reference/cli.md` | `pnpm docs:reference`, which runs `scripts/gen-reference.ts` |
| `docs/reference/errors.md` | `pnpm docs:reference` |
| `docs/reference/core.md` | Not generated yet: it needs a TypeDoc dev dependency, which a later story adds |

## Commands

Root `package.json` scripts are the source of truth.

| Command | Does |
|---|---|
| `pnpm install` | Installs dependencies from the lockfile |
| `pnpm build` | Builds every package and app |
| `pnpm dev` | Runs the desktop app in development |
| `pnpm typecheck` | Type-checks the workspace |
| `pnpm lint` | Runs ESLint |
| `pnpm format` | Formats with Prettier |
| `pnpm format:check` | Checks formatting without writing |
| `pnpm test` | Runs the Vitest suites against the MSW fake |
| `pnpm test:live` | Runs the read-only PSAPAC tests. Needs `JM_LIVE_JIRA=1` and a stored token |
| `pnpm e2e` | Runs the Playwright Electron tests in `e2e/` |
| `pnpm jm -- <args>` | Runs the built CLI |
| `pnpm docs:reference` | Builds the CLI and regenerates `docs/reference/cli.md` and `errors.md` |
