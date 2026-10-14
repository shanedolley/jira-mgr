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

Merge only when every CI check passes and a reviewer other than the builder has approved. Find the run for the head you pushed with `gh run list --commit <full sha> --json databaseId,status` (a short SHA returns nothing, and the run can lag the push), then wait for it with `gh run watch <id> --exit-status`. Delete the branch after the merge.

## Versioning

Nothing is published, and every package stays at `0.0.0`. These are public contracts from the first release of the CLI: the `--json` output, the exit codes, `jm help --json`, the saved views file and the settings file shape. Change them additively; a break needs a `BREAKING CHANGE:` footer and a migration note.

The exports of `@jira-mgr/core` are internal to the repository and may change with their callers in the same pull request.
