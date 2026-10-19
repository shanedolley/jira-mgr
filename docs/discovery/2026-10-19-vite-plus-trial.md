# Vite+ Trial

**Date:** 2026-10-19
**Feeds:** Issue #255, [ADR-0006](../adr/0006-adopt-oxlint-keep-prettier-and-vite.md)

## Question

Should jira-mgr replace ESLint and Prettier with Vite+, and what does each part of it cost and buy? The five questions are in [#255](https://github.com/shanedolley/jira-mgr/issues/255).

## Summary

- Oxlint matches 165 of the 172 ESLint rules the repo enables, React Hooks 7 included, and runs the repo about 9 times faster (3.1 s against 29.2 s). Run side by side it reports 19 findings that ESLint does not and misses none.
- Oxfmt differs from Prettier in 5 TypeScript files (21 lines added, 7 removed), all union-type layout. It formats Markdown, JSON and YAML as Prettier does on the probes run, and it honours `.prettierignore`. It saves about 3 s and is in beta.
- Build, typecheck, unit tests, `pnpm dev` and the full e2e pass under the Vite+ overrides with the same counts as main (911 passed, 1 skipped of 912).
- Vite+ in full adds 107 lockfile packages and about 100 MB of binaries and buys nothing the repo uses beyond Oxlint and Oxfmt: electron-vite owns dev and build, and tsup owns the CLI bundle.
- Standalone `oxlint`, `oxlint-tsgolint` and `oxfmt`, with no Vite+ and no overrides, give the identical 19 findings and 5 format differences.

## Trial Setup

| Item | Value |
|---|---|
| Date | 2026-10-19 |
| Base | `79ea7c0` on `main` (the baseline of 911 passed was measured on `421ab8c`; the two commits since are documentation only) |
| Trial branch | `255-vite-plus-trial` at `6e45a61`, never pushed, never merged |
| Machine | macOS arm64, Node 24.16.0, pnpm 10.33.0, Electron 44.7.0 |
| `vite-plus` | 1.3.0 (published 2026-10-16) |
| Bundled | vite 8.3.4 (as `@voidzero-dev/vite-plus-core` 1.3.0), rolldown 1.2.14, vitest 5.0.5, tsdown 0.23.1 |
| `oxlint` | 1.88.0 |
| `oxlint-tsgolint` | 7.0.2004 |
| `oxfmt` | 0.73.0 |

Setup followed the [Vite+ migration rules](https://viteplus.dev/guide/migrate-rules) by hand, so ESLint and Prettier kept working beside it. `pnpm-workspace.yaml` gained two overrides, `vite@*: npm:@voidzero-dev/vite-plus-core@1.3.0` and `vitest@*: 5.0.5`, and the root `package.json` gained `vite-plus` 1.3.0. A root `vite.config.ts` holds the `lint` and `fmt` blocks. `vp` ran as `pnpm exec vp`; no global install.

Setup friction:

- **Release age.** The repo's `minimumReleaseAge` of seven days refused `vite-plus` 1.3.0, `vitest` 5.0.5 and the `@oxfmt/*` bindings, all under seven days old. The trial added them to `minimumReleaseAgeExclude`. A real adoption waits for the age instead.
- **ESLint on the new config.** The root `vite.config.ts` sits outside every `tsconfig`, so ESLint's project service failed on it. The trial added `vite.config.ts` to the ESLint ignores.
- **Peer warnings.** pnpm prints unmet-peer warnings for `vite` on `electron-vite`, `@vitejs/plugin-react`, `@tailwindcss/vite` and `vitest`, because the alias reports its own version, 1.3.0. Nothing fails. `electron-vite` 5 already declared `vite@^7` against the repo's Vite 8.

## Rule Parity

ESLint enables 172 rules on a `.tsx` file (137 on a `.ts` file), read with `eslint --print-config` on `http.ts`, `http.int.test.ts` and `IssuePage.tsx`. Oxlint covers 165.

| Family | ESLint rules | Oxlint equivalent | None |
|---|---|---|---|
| ESLint core (recommended) | 46 | 45 | `no-octal` |
| typescript-eslint (strict and stylistic, type-aware) | 91 | 90 | `no-unsafe-enum-assignment` |
| `eslint-plugin-react` | 19 | 16 | `jsx-uses-vars`, `no-deprecated`, `prop-types` |
| `eslint-plugin-react-hooks` 7 | 16 | 14 | `config`, `gating` |
| Total | 172 | 165 | 7 |

Notes on the table:

- Oxlint ships the React Hooks 7 compiler rules natively (`static-components`, `use-memo`, `preserve-manual-memoization`, `immutability`, `globals`, `refs`, `set-state-in-effect`, `error-boundaries`, `purity`, `set-state-in-render`, `incompatible-library`, `unsupported-syntax`) beside `rules-of-hooks` and `exhaustive-deps`. `exhaustive-deps`, `incompatible-library` and `unsupported-syntax` keep their warning severity.
- Five typescript-eslint rules (`no-array-constructor`, `no-unused-expressions`, `no-unused-vars`, `no-useless-constructor`, `no-empty-function`) are core rules in Oxlint and need no `typescript/` prefix.
- `jsx-uses-vars` and `config` and `gating` do not report code. `prop-types` is moot in TypeScript. `react/no-deprecated` and `no-octal` have no counterpart; `no-octal` flags legacy octal literals, which the repo does not use.
- `no-unsafe-enum-assignment` is the one type-aware rule missing; the repo declares no `enum`. The [Oxc post](https://oxc.rs/blog/2026-07-22-type-aware-linting-stable) counts 59 of 61.
- 49 of the 165 rules are type-aware and run through `oxlint-tsgolint` 7.0.2004 on the repo's TypeScript 7.
- Options carry over only where tested. The trial set `ban-ts-comment`, `restrict-plus-operands`, `restrict-template-expressions` and `return-await`. Before the two `restrict-*` options were set, Oxlint missed an `any` operand that ESLint's strict preset reports, so each remaining option in the ESLint config needs the same check in a real adoption: `no-unused-expressions`, `no-empty-function`, `dot-notation` and `consistent-type-assertions`.

### Side by Side

| | ESLint 9.39.5 | Oxlint 1.88.0 |
|---|---|---|
| Files linted | 428 | 429 |
| Rules run | 172 on `.tsx` | 165 |
| Findings | 0 | 19 |

Findings only Oxlint reports:

| Rule | Count | Where |
|---|---|---|
| `no-unsafe-optional-chaining` | 18 | `(requests[0]?.body as FormData).get(...)` in 17 test files and once in `apps/desktop/src/main/e2e-fake.ts:1485`. ESLint's rule does not see through the `as` cast |
| `react/purity` | 1 | `new Date()` during render at `apps/desktop/src/renderer/src/TimeTracking.tsx:106`. ESLint's `react-hooks/purity` does not flag it |

ESLint reports nothing that Oxlint misses. A probe file with eight violations (floating promise, `any` use, unsafe member access, base-to-string, plus-operand and others) drew 8 findings from ESLint and 7 from Oxlint, which missed the `any` plus-operand until the `restrict-*` options were set. A second probe, covering a plus-operand and a template expression, then drew 3 findings from each tool.

### Disable Comments

All 7 `eslint-disable-next-line` comments work unchanged in Oxlint, including `@typescript-eslint/no-deprecated` and `react-hooks/exhaustive-deps`. With the 7 comments removed, Oxlint reports exactly those 7 sites, plus the `purity` finding and the 18 optional-chaining findings, so each comment suppresses a real diagnostic in both tools.

## Format Diff

Config: `fmt: { singleQuote: true, semi: false, printWidth: 100, sortPackageJson: false }`. Oxfmt read `.prettierignore` without extra config.

Oxfmt over a clean tree of 456 files changed:

| Extension | Files changed | Lines added | Lines removed |
|---|---|---|---|
| TS | 5 | 21 | 7 |
| TSX | 0 | 0 | 0 |
| JSON | 0 | 0 | 0 |
| YAML | 0 | 0 | 0 |
| Markdown | 0 | 0 | 0 |
| Others | 0 | 0 | 0 |

- **`sortPackageJson`.** On by default, it reordered keys in 3 `package.json` files (12 lines moved). The setting above turns it off.
- **Union types.** All 5 files differ in one place: a multi-line union. Prettier 3.9 writes `type A =` then an indented first member; Oxfmt writes a leading `|` on every member.

```diff
 export type SessionState =
-  { loggedIn: true; session: Session } | { loggedIn: false; prefill: Partial<Session> }
+  | { loggedIn: true; session: Session }
+  | { loggedIn: false; prefill: Partial<Session> }
```

- **Markdown, JSON and YAML.** Probe files in `packages/core/` formatted the same under both tools: a pipe table was padded to column width, `*   item` became `- item`, a YAML list was re-indented to two spaces, and a short JSON object collapsed to one line. A copy in `docs/` stayed untouched under Oxfmt, so `.prettierignore` holds.
- **Coverage.** The tracked tree holds no Markdown, JSON or YAML outside the ignore list that Prettier changes today, so the clean-tree count shows no Markdown diff. The probes cover that gap.

The two tools disagree on those 5 files, so the repo cannot run both on a shared tree.

## Build and Tests

All runs used the trial branch with the Vite+ overrides in place.

| Check | Result |
|---|---|
| `pnpm build` | Pass. electron-vite builds main, preload and renderer on Vite 8.3.4; tsup builds the CLI |
| `pnpm typecheck` | Pass, five projects |
| `pnpm test` core | 27 files passed, 3 skipped; 1530 tests passed, 5 skipped |
| `pnpm test` desktop | 62 files passed; 1416 tests passed |
| `pnpm test` cli | 35 files passed; 604 tests passed |
| `pnpm dev` | Dev server up at `localhost:5173`, main and preload built, Electron launched; stopped after 25 s |
| Electron dist | 307 MB, `path.txt` present |
| `pnpm e2e --workers=1` | "Running 912 tests using 1 worker": 911 passed, 1 skipped, 0 failed, 27.6 min |

The e2e ran once, under machine load of 10 to 60 from other sessions, and matches the main baseline (911 passed, 1 skipped). `pnpm dev` was not driven past launch.

## Timings

Median of three runs, in seconds, with the one-minute load average at the end of the runs. Other sessions shared the machine, so absolute times run above the issue's idle figures (`eslint` 17.7, `prettier` 3.5).

| Command | Run A | Load | Run B | Load |
|---|---|---|---|---|
| `eslint .` (`pnpm lint`) | 30.6 | 11.5 | 29.2 | 10.3 |
| `oxlint`, type-aware (`vp lint`) | 4.6 | 20.8 | 3.1 | 10.1 |
| `oxlint`, without type-aware rules | 1.2 | 20.8 | 1.9 | 18.6 |
| `prettier --check .` (`pnpm format:check`) | 6.0 | 11.0 | 5.0 | 10.3 |
| `oxfmt --check` (`vp fmt --check`) | 1.6 | 28.8 | 1.7 | 14.7 |

Type-aware Oxlint is 9.4 times faster than ESLint in run B, Oxfmt 3.0 times faster than Prettier.

A quieter set, measured by the trial (`255-vite-plus-trial`) after PR #327 merged, on 2026-10-19 (median of three, load average 5.1 to 5.7; [issue comment](https://github.com/shanedolley/jira-mgr/issues/255#issuecomment-6263403629)):

| Command | Seconds | Against |
|---|---|---|
| `eslint .` | 21.3 | |
| `oxlint`, type-aware | 1.7 | 12.8 times faster than ESLint |
| `oxlint`, without type-aware rules | 0.37 | |
| `prettier --check .` | 4.6 | |
| `oxfmt --check` | 0.37 | 12 times faster than Prettier |

Stage times for the rest of `pnpm ci:local`, one run each at load 22 to 30: install 3.2 s, typecheck 5.3 s, test 22.4 s, build 1.7 s, `docs:reference` 1.2 s. Adding the lint and format medians of run B:

| Route | Format | Lint | Rest | Total |
|---|---|---|---|---|
| ESLint and Prettier (today) | 5.0 | 29.2 | 33.8 | 68.0 |
| Oxlint and Prettier | 5.0 | 3.1 | 33.8 | 41.9 |
| Oxlint and Oxfmt | 1.7 | 3.1 | 33.8 | 38.6 |

Totals add stage medians; they are not one timed run. The e2e run (27.6 min) dwarfs all of them and does not change.

## Dependency Weight

| Measure | Today | Full Vite+ beside ESLint | Standalone Oxlint and Oxfmt |
|---|---|---|---|
| Lockfile lines | 6336 | 7593 (+1257) | 6846 (+510) |
| Lockfile package entries | 646 | 748 (+107, -5) | 694 (+48) |
| Packages added by `pnpm install` | | +49 | +7 |
| Disk on macOS arm64 | | about 102 MB | about 51 MB |

Removing ESLint, Prettier and `@jira-mgr/config-lint` (measured on a throwaway edit in the report worktree) takes the lockfile to 4212 lines and 428 entries, so replacing the tools nets a smaller lockfile. Adding the measured deltas gives about 4720 lines for standalone Oxlint and Oxfmt and about 5470 for full Vite+. These sums are estimates, not a built lockfile.

Most new entries are per-platform optional bindings that pnpm lists but installs only for the host. Vite+ also pulls `@vitest/ui`, `@vitest/browser`, `@testing-library/dom` and `ws`, which the repo does not use. Licences: the 48 new installed packages are MIT (47) and Apache-2.0 (1). All of `vite-plus`, `oxlint`, `oxfmt` and `oxlint-tsgolint` are MIT, which [dependencies.md](../standards/dependencies.md) permits.

## Effect on the Repo

| Item | Under adoption |
|---|---|
| `packages/config-lint` | Goes. Its ESLint config becomes the `rules` block of an Oxlint config. Its Prettier config stays only if Prettier stays. Standalone Oxlint reads a JSON config, so the package has no reason to remain |
| TypeScript `~6.0.0` pin | Goes with ESLint. It exists for typescript-eslint's peer range. `oxlint-tsgolint` is built on the TypeScript 7 toolchain and has no TypeScript 6 peer, so the whole repo sits on `~7.0.2`; the lockfile loses TypeScript 6.0.3 |
| `tsup` | Stays. Vite+ bundles tsdown (`vp pack`), a possible later replacement, but nothing in this trial required it and `pnpm build` passes with tsup. Replacing it is a separate story |
| `.github/dependabot.yml` | The `npm` entry keeps working. Under full Vite+ the exact versions in the `vite@*` and `vitest@*` overrides in `pnpm-workspace.yaml` need a manual bump for each Vite+ release, because no automatic bump of a pnpm override is known, and the direct `vite` and `vitest` entries in `package.json` need an ignore rule. Standalone Oxlint adds three ordinary dev dependencies that Dependabot updates |
| Dependabot PR #235 | Moot under any adoption of Oxlint: it bumps `@eslint/js` to 10.0.1, a package that leaves. Close it in the story that removes ESLint |
| CI `checks` job | `format:check` and `lint` scripts keep their names and change their commands. `vp check` can merge format, lint and type-check, but it needs the Vite+ install |

## Options

| Option | For | Against |
|---|---|---|
| Adopt Vite+ in full | One CLI; Oxlint and Oxfmt speed; `vp check` | Overrides alias `vite` and `vitest` across the monorepo and need a manual bump each release; 107 more lockfile entries and about 100 MB; electron-vite and tsup keep the build, so the build side gains nothing; peer warnings; 3 days old at trial time |
| Adopt Oxlint alone | 9 times faster lint; 165 of 172 rules; React Hooks 7 included; 7 disables unchanged; drops ESLint, its plugins and the TypeScript 6 pin; no overrides | 19 findings to triage; 7 rules without a counterpart; options need a rule-by-rule check; Oxlint is a rewrite of the plugins, so its React rules can differ from the originals |
| Adopt Oxfmt alone | 3.0 times faster, about 3 s per run | Beta; 5 files reformat; cannot share a tree with Prettier; no Prettier plugin support; saves little |
| Reject | No change, no new dependencies | `pnpm lint` stays about 29 s, 43 percent of `pnpm ci:local`; the TypeScript pin split stays; #235 stays red |

## Recommendation

Adopt Oxlint alone, as standalone `oxlint` and `oxlint-tsgolint` dev dependencies with no Vite+. Keep Prettier and the Vite and Vitest versions the repo has. Record it in [ADR-0006](../adr/0006-adopt-oxlint-keep-prettier-and-vite.md). Shane decides; adoption needs his approval of the new dependencies (AGENTS.md, Ask First).

### Follow-Up Stories

If Shane approves, file these. None is filed yet.

1. **Config.** Add `oxlint` and `oxlint-tsgolint`; write the Oxlint config from the trial's `vite.config.ts` `lint` block as `oxlint.config.ts` or `.oxlintrc.json`; check every remaining ESLint rule option; set `pnpm lint` to `oxlint --type-aware`.
2. **Triage.** Fix or justify the 18 `no-unsafe-optional-chaining` sites and the `purity` finding, then remove ESLint, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `globals`, `eslint.config.js` and the TypeScript `~6.0.0` pin.
3. **Local CI route.** Update `pnpm ci:local` and `.github/workflows/ci.yml` for the new `lint` command; run the route on the pushed head.
4. **Docs.** Update `AGENTS.md` Commands, `ARCHITECTURE.md`, `docs/standards/dependencies.md` (Monorepo Tooling) and `packages/config-lint/README.md`, or delete the package and its README with it.
5. **Close #235.** Close the `@eslint/js` 10 Dependabot pull request with a comment naming the story.
6. **Revisit Oxfmt.** Reopen the question when Oxfmt leaves beta and matches Prettier on union types.

## Open Questions

- The trial did not run Oxlint's JS plugin route for `eslint-plugin-react-hooks`; the native rules covered every enabled rule but `config` and `gating`.
- Oxfmt Markdown behaviour was probed on one table and one list, not across every Markdown construct the repo uses.
- The 18 optional-chaining findings and the `purity` finding were not triaged for real defects.
- `vp check` with `typeCheck: true` was not tried as a replacement for `tsc`.
- Timings ran under load from other sessions. Rerun on an idle machine before quoting absolute figures.

## Sources

- [Announcing Vite+](https://voidzero.dev/posts/announcing-vite-plus)
- [Vite+ repository](https://github.com/voidzero-dev/vite-plus) and its [migration rules](https://viteplus.dev/guide/migrate-rules)
- [Oxlint type-aware linting, stable](https://oxc.rs/blog/2026-07-22-type-aware-linting-stable)
- [Oxfmt beta](https://oxc.rs/blog/2026-02-24-oxfmt-beta)
- [Biome rejection](2026-10-07-product-grilling/round-5.md) (question 41)
