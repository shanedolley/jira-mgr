# Git Workflow

## Trunk

`main` is the trunk and is always buildable.

- Branch from `main`, and merge back within two days. Split larger work into pull requests that each leave `main` working.
- Hide unfinished work behind a feature flag, or leave it unwired: a command out of the command tree, a screen out of the router. Remove the flag once the feature ships.
- Rebase a branch on `main` to update it. Force-push your own branch only with `--force-with-lease`.
- Nobody commits or pushes to `main` directly. A pull request carries every change, and the local commit guards block commits and pushes to `main`.

## Branch Names

`<type>/<issue>-<slug>`, using the commit types below, for example `feat/12-issue-tree`. Drop the issue number when there is none: `docs/architecture-foundation`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <summary>

<body: why, not what>

Refs #12
```

- **Types:** `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes:** the area changed, and `deps` for dependency updates: `cli`, `desktop`, `core`, `config`, `e2e`, `docs`, `repo`, `deps`, `deps-dev`. Dependabot uses `deps` for runtime dependencies and `deps-dev` for dev dependencies.
- **Summary:** imperative, lower case, no full stop, 72 characters at most.
- **Breaking change:** add `!` after the scope, and a `BREAKING CHANGE:` footer saying what breaks and how to migrate.
- **Issues:** reference them with `Refs #12`. Never write `closes`, `fixes` or `resolves`: the issue closes by hand, not by a commit.
- **Agents:** an agent commit ends with a `Claude-Session:` trailer, or its tool's equivalent, and names Shane Dolley as the author.

Work is tracked in GitHub issues on [shanedolley/jira-mgr](https://github.com/shanedolley/jira-mgr). The app manages PSAPAC issues in Jira; it does not track its own work there.

## Merging

Squash-merge every pull request. The pull request title becomes the commit on `main`, so it follows the commit format above, and the description carries the `Refs` line. `main` keeps a linear history of one commit per pull request.

Merge only when the local CI route passes on the head you push and a reviewer other than the builder has approved. Delete the branch after the merge.

## Local CI

GitHub Actions cannot run for this repository (Shane, 2026-10-17). `.github/workflows/ci.yml` triggers by `workflow_dispatch` only, and the route below replaces it. Run it from the repository root, under Node 24, on the head you push:

```
pnpm ci:local
du -sh node_modules/.pnpm/electron@*/node_modules/electron/dist
lockf /tmp/jira-mgr-e2e.lock pnpm e2e --workers=1
```

- Run the route on a clean, committed tree (`git status --short` prints nothing) under Node 24 (`node -v`): `pnpm ci:local` checks neither.
- `pnpm ci:local` runs `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm docs:reference` with no diff under `docs/reference`. It stops at the first failure. (`pnpm ci` is pnpm's own clean install, so the script has another name.)
- The Electron dist is about 307 MB with `path.txt` beside it. If it is missing or truncated, run `pnpm --filter @jira-mgr/e2e exec install-electron` first.
- `lockf` serialises e2e across worktrees on the shared lock file. Run it on one worker and never in parallel with another e2e run.
- Read the pass, fail and skip counts of `pnpm test` and `pnpm e2e` from the output, not from the exit status of a pipeline.
- The pull request title uses the commit types and scopes above (the `pr-title` job enforced them).
- The pull request description records the head SHA and the pass and fail counts of the run. A push makes the record stale: run the route again.
- A story's builder runs only that story's e2e files (`cd e2e && lockf <lock file> npx playwright test desktop/<file>.test.ts --workers=1`, after `pnpm build`). The full route runs once on the tip of a batch before the pull requests merge.

## Versioning

Nothing is published, and every package stays at `0.0.0`. These are public contracts from the first release of the CLI: the `--json` output, the exit codes, `jm help --json`, the saved views file and the settings file shape. Change them additively; a break needs a `BREAKING CHANGE:` footer and a migration note.

The exports of `@jira-mgr/core` are internal to the repository and may change with their callers in the same pull request.
