# Dependencies

## Adding One

- Check the platform, the standard library and the packages already installed first.
- A new runtime dependency is named in the pull request description with the reason it earns its place.
- Shipped code uses permissive licences only (MIT, Apache-2.0, BSD, ISC). GPL and AGPL code stays out, because jira-mgr is proprietary.
- Prefer packages that are maintained, typed, and free of install scripts.
- Declare a version used by more than one package once, in the pnpm `catalog` in `pnpm-workspace.yaml`, and reference it as `catalog:`.

## Supply Chain

- `pnpm-lock.yaml` is committed, and CI installs with `--frozen-lockfile`.
- pnpm refuses versions published less than seven days ago (`minimumReleaseAge`). Dependabot waits the same seven days.
- pnpm blocks install scripts by default. Allow one package at a time in `onlyBuiltDependencies`, with the reason in the pull request. esbuild has an entry for its binary. Electron has no install script and downloads its binary on first use, so CI runs `pnpm --filter @jira-mgr/e2e exec install-electron` before e2e.

## Updates

Dependabot opens grouped pull requests weekly. A security update merges as soon as CI passes. A major update gets its own pull request and reads the changelog first.

Remove a dependency in the same pull request that stops using it.

## Monorepo Tooling

Workspace tasks run through pnpm: root scripts call `pnpm -r` and `--filter`. Formatting uses Prettier and linting uses ESLint, both configured in `@jira-mgr/config-lint`.

Turborepo joins when CI takes longer than ten minutes. It adds caching and affected-only runs on top of the same pnpm scripts with one `turbo.json`.
