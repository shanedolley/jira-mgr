# Handover

## Where Work Stands

Checked 2026-10-07.

- The scaffold is on `main` (PR #1, merged). Run `git log --oneline -1 origin/main` for the head commit.
- Branch `plan-roadmap` holds the build plan, [docs/product/roadmap.md](docs/product/roadmap.md), plus an amended [ADR-0003](docs/adr/0003-token-in-own-keychain-item.md) and three new lines in the [product grilling record](docs/discovery/2026-10-07-product-grilling.md). Its pull request waits for Shane to approve the roadmap. Find it with `gh pr list --head plan-roadmap`.
- No feature code exists. `packages/core` exports one constant, and `jm` prints only `--help` and `--version`.

## Board

GitHub issues on `shanedolley/jira-mgr` track the work (Q43).

| Measure | Value | Command | Date |
|---|---|---|---|
| Issues, any state | 0 | `gh issue list --state all --limit 200 --json number \| jq length` | 2026-10-07 |
| Milestones | 0 | `gh api repos/shanedolley/jira-mgr/milestones --jq length` | 2026-10-07 |
| Status labels | none exist | `gh label list` | 2026-10-07 |

The roadmap's 29 rows (C1-C12, L1-L7, D1-D10) become issues under milestones Core, CLI and Desktop once Shane approves it.

## Open Pull Requests

Checked 2026-10-07 with `gh pr list` and `gh pr checks <n>`.

| PR | What | Checks |
|---|---|---|
| #2 | Dependabot: vite 7.3.6 to 8.3.1 | pr-title fail, checks pass, e2e pass |
| #3 | Dependabot: @vitejs/plugin-react 5.2.0 to 6.1.1 | all three fail |
| #4 | Dependabot: typescript 6.0.3 to 7.0.2 | pr-title fail, checks pass, e2e pass |
| #5 | Dependabot: @types/node 24.19.0 to 26.6.3 | pr-title fail, checks pass, e2e pass |
| #6 | Dependabot: eslint 9.39.5 to 10.11.0 | pr-title fail, checks fail, e2e pass |
| `plan-roadmap` | Build plan | not yet run |

## What Runs

All from the repository root, under Node 24 (see Traps).

| Command | Does | Reaches |
|---|---|---|
| `pnpm test` | Vitest unit tests (2 in `core`, checked 2026-10-07) | Nothing external. Jira calls will hit the MSW fake once C1 lands |
| `pnpm test:live` | Same plus `*.live.test.ts` with `JM_LIVE_JIRA=1` | Live PSAPAC, read-only. No live tests exist yet (2026-10-07) |
| `pnpm e2e` | Builds the desktop app and runs the Playwright Electron smoke test | A local Electron window, no network |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` | Checks and builds | Nothing external |
| `pnpm jm -- <args>` | Runs the built CLI | Nothing yet; later the site and project in `settings.json` |

No database exists or is planned. CI (`.github/workflows/ci.yml`) runs `pr-title`, `checks` and `e2e` on pull requests and on pushes to `main`. Last `main` run: success on the PR #1 merge (`gh run list --workflow ci.yml --branch main --limit 1`, 2026-10-07).

## Environments

- Jira: Collibra site `engineering-collibra.atlassian.net`, project PSAPAC. PSAPAC's measured shape (issue types, field ids, statuses, link types, sprints, counts) is in [round 2](docs/discovery/2026-10-07-product-grilling/round-2.md), measured 2026-10-07.
- Credentials today: `~/.claude/bin/kj collibra` reads the Keychain item `kothar-jira-collibra` with `COLLIBRA_JIRA_EMAIL`. jira-mgr's own Keychain item does not exist yet; C3 creates it.
- Recorded fixtures are committed as recorded, with no scrubbing (Q60). Never record request headers.

## Open Decisions

| Raised | Decision | Owner |
|---|---|---|
| 2026-10-07 | Approve the roadmap on `plan-roadmap`, then create milestones and issues | Shane |
| 2026-10-07 | Dependabot majors #2-#6: merge, hold, or ignore. ESLint 10 breaks `eslint-plugin-react` and plugin-react 6 fails checks; TypeScript 7 and Vite 8 pass checks | Shane |
| 2026-10-07 | GitHub status labels for claims (`status:in-progress`, `status:ai-review`, `status:hil-review`) do not exist; create them with the issues | Orchestrator, with the issues |

Answered 2026-10-07: Keychain access through `/usr/bin/security`; state files in `~/Library/Application Support/jira-mgr/`; Markdown in the CLI; build order Core, CLI, Desktop.

## Traps

- **Node 22 by default** (2026-10-07). The machine's default `node` is 22.22; the repo needs 24. Prefix commands with `PATH=$HOME/.local/share/mise/installs/node/24.16.0/bin:$PATH`, or run `mise use node@24` in the repo.
- **Dependabot titles fail `pr-title`** - resolved 2026-10-07. Added `deps-dev` to the allowed scopes in `ci.yml` and documented in `docs/standards/git-workflow.md` that Dependabot uses `deps` for runtime and `deps-dev` for dev dependencies.
- **pnpm forwards `--`** (2026-10-07). `pnpm jm -- --help` passes a literal `--`; `scripts/jm.ts` strips it.
- **Pinned toolchain** (2026-10-07). TypeScript stays below 6.1 for `typescript-eslint`, ESLint stays on 9 for `eslint-plugin-react`. See `packages/config-lint/README.md`.
- **Squash merges and `git branch -d`** (2026-10-07). After a squash merge `-d` refuses; confirm `git diff --quiet main <branch>` and then use `KOTHAR_ALLOW_DESTRUCTIVE=1 git branch -D`.
- **`kj` paths** (2026-10-07). The ticket guard rejects shell variables inside a `kj` path and `>|` redirects; write paths literally.
