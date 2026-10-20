---
status: accepted
date: 2026-10-20
deciders: Shane Dolley
---

# Adopt Oxlint, Keep Prettier and Vite

jira-mgr lints with ESLint and formats with Prettier, both configured in `@jira-mgr/config-lint`. [Issue #255](https://github.com/shanedolley/jira-mgr/issues/255) asked whether Vite+ should replace them. The [trial](../discovery/2026-10-19-vite-plus-trial.md) recommends adopting Oxlint alone, as the standalone `oxlint` and `oxlint-tsgolint` packages, and keeping Prettier, Vite, Vitest, electron-vite and tsup as they are. Shane accepted option 2, Oxlint alone, on 2026-10-20, and approved the two new dev dependencies, `oxlint` and `oxlint-tsgolint`.

## Considered Options

1. **Adopt Vite+ in full** - passes build, typecheck, unit tests and the full e2e (911 passed, 1 skipped), but it aliases `vite` and `vitest` through two pnpm overrides pinned to exact versions, adds 107 lockfile entries and about 100 MB, and gains nothing for the build: electron-vite owns dev and build, and tsup owns the CLI. It buys only what Oxlint and Oxfmt buy alone.
2. **Adopt Oxlint alone** - chosen. Type-aware lint falls from 29.2 s to 3.1 s (9.4 times; 21.3 s to 1.7 s, 12.8 times, at a load of 5.1 to 5.7), `pnpm ci:local` from 68.0 s to 41.9 s. It matches 165 of 172 enabled rules, React Hooks 7 included, runs the 7 `eslint-disable` comments unchanged, reports 19 findings ESLint does not and misses none, and removes ESLint, its plugins and the TypeScript `~6.0.0` pin. Standalone it adds 48 lockfile entries and about 51 MB.
3. **Adopt Oxfmt alone** - saves about 3 s (5.0 s to 1.7 s; 4.6 s to 0.37 s at a load of 5.1 to 5.7). It is in beta, reformats 5 TypeScript files (union-type layout) that Prettier would then reject, and cannot share a tree with Prettier. Revisit when it leaves beta.
4. **Reject** - no new dependencies and no triage, but `pnpm lint` stays about 29 s (43 percent of `pnpm ci:local`), the TypeScript pin split stays, and Dependabot PR #235 stays red until ESLint 10 support arrives.

## Consequences

- Seven ESLint rules have no Oxlint counterpart: `no-octal`, `no-unsafe-enum-assignment`, `react/jsx-uses-vars`, `react/no-deprecated`, `react/prop-types`, `react-hooks/config` and `react-hooks/gating`. The repo has no legacy octal literal and no `enum`; `jsx-uses-vars` and `prop-types` are obsolete under the JSX runtime and TypeScript; `config` and `gating` configure the compiler and report no code. Only `react/no-deprecated` is a real loss.
- Rule options do not carry over by themselves. Adoption checks each remaining option in the ESLint config against Oxlint.
- The 19 new findings need a decision in the adopting story: 18 `no-unsafe-optional-chaining` sites on `(a?.b as T).c`, and one `react/purity` finding on `new Date()` in `TimeTracking.tsx`.
- `packages/config-lint` loses its ESLint half. Whether the Prettier half keeps the package is the adopting story's call.
- Oxlint's type-aware rules need `oxlint-tsgolint`, built on the TypeScript 7 toolchain. The `~6.0.0` pin in `config-lint` goes.
- Dependabot PR #235 (`@eslint/js` 10) closes in the story that removes ESLint.
- Oxlint reimplements the React rules, so a future `eslint-plugin-react-hooks` release can reach ESLint before it reaches Oxlint.
