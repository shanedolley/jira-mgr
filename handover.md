# Handover

## Where Work Stands

Checked 2026-10-07.

- `main` holds the scaffold (#1), the roadmap and handover files (#7) and the `deps-dev` scope fix (#8). Run `git log --oneline -1 origin/main` for the head commit.
- C1 test harness (#9) is built on `c1-test-harness`: MSW in Vitest, `scripts/record-fixture.ts`, three recorded PSAPAC fixtures. Its pull request carries this handover; find it with `gh pr list --head c1-test-harness`.
- No Jira client exists yet. `jm` prints only `--help` and `--version`.

## Board

GitHub issues on `shanedolley/jira-mgr` track the work (Q43). Milestones Core (1), CLI (2) and Desktop (3) hold issues #9-#37, one per roadmap row, with blockers recorded through GitHub's issue dependencies.

| Measure | Value | Command | Date |
|---|---|---|---|
| Open roadmap issues | 29 (Core 12, CLI 7, Desktop 10) | `gh issue list --state open --limit 200 --json milestone` | 2026-10-07 |
| In progress | #9 (C1) | `gh issue list --label status:in-progress` | 2026-10-07 |
| In AI review | none | `gh issue list --label status:ai-review` | 2026-10-07 |

## Open Pull Requests

Checked 2026-10-07 with `gh pr list` and `gh pr checks <n>`.

| PR | What | State |
|---|---|---|
| #2 | Dependabot: vite 7 to 8 | Approved by Shane; rebasing, merges on green |
| #4 | Dependabot: typescript 6.0 to 7.0 | Approved by Shane; rebasing, merges on green |
| `c1-test-harness` | C1 test harness | Open |

Merged: #5 (@types/node 26). Closed by Dependabot after `@dependabot ignore this major version`: #3 (plugin-react 6), #6 (eslint 10).

## What Runs

All from the repository root, under Node 24 (see Traps).

| Command | Does | Reaches |
|---|---|---|
| `pnpm test` | Vitest unit tests (5 in `core`, 2 files, checked 2026-10-07) | Nothing external: Jira calls hit the MSW fake, which fails any unhandled request |
| `pnpm test:live` | Same plus `*.live.test.ts` with `JM_LIVE_JIRA=1` | Live PSAPAC, read-only. No live tests exist yet (2026-10-07) |
| `pnpm e2e` | Builds the desktop app and runs the Playwright Electron smoke test | A local Electron window, no network |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` | Checks and builds | Nothing external |
| `pnpm jm -- <args>` | Runs the built CLI | Nothing yet; later the site and project in `settings.json` |
| `pnpm fixture:record -- <name> <GET\|POST> <path> [body]` | Records one response body to `packages/core/fixtures/` | Live Jira at `JM_JIRA_SITE`, reads only: it refuses every write except the search `POST` |

No database exists or is planned. CI (`.github/workflows/ci.yml`) runs `pr-title`, `checks` and `e2e` on pull requests and on pushes to `main`. Last `main` run: success on the PR #1 merge (`gh run list --workflow ci.yml --branch main --limit 1`, 2026-10-07).

## Environments

- Jira: Collibra site `engineering-collibra.atlassian.net`, project PSAPAC. PSAPAC's measured shape (issue types, field ids, statuses, link types, sprints, counts) is in [round 2](docs/discovery/2026-10-07-product-grilling/round-2.md), measured 2026-10-07.
- Credentials today: `~/.claude/bin/kj collibra` reads the Keychain item `kothar-jira-collibra` with `COLLIBRA_JIRA_EMAIL`. jira-mgr's own Keychain item does not exist yet; C3 creates it.
- Recorded fixtures are committed as recorded, with no scrubbing (Q60). Never record request headers.

## Open Decisions

| Raised | Decision | Owner |
|---|---|---|
| none open | | |

Answered 2026-10-07: Keychain access through `/usr/bin/security`; state files in `~/Library/Application Support/jira-mgr/`; Markdown in the CLI; build order Core, CLI, Desktop; roadmap approved and merged (#7); Dependabot majors: merge vite 8, typescript 7 and @types/node 26, ignore plugin-react 6 and eslint 10.

## Traps

- **Node 22 by default** (2026-10-07). The machine's default `node` is 22.22; the repo needs 24. Prefix commands with `PATH=$HOME/.local/share/mise/installs/node/24.16.0/bin:$PATH`, or run `mise use node@24` in the repo.
- **Dependabot titles fail `pr-title`** - resolved 2026-10-07. Added `deps-dev` to the allowed scopes in `ci.yml` and documented in `docs/standards/git-workflow.md` that Dependabot uses `deps` for runtime and `deps-dev` for dev dependencies.
- **pnpm forwards `--`** (2026-10-07). `pnpm jm -- --help` passes a literal `--`; `scripts/jm.ts` strips it.
- **Pinned toolchain** (2026-10-07). TypeScript stays below 6.1 for `typescript-eslint`, ESLint stays on 9 for `eslint-plugin-react`. See `packages/config-lint/README.md`.
- **Squash merges and `git branch -d`** (2026-10-07). After a squash merge `-d` refuses; confirm `git diff --quiet main <branch>` and then use `KOTHAR_ALLOW_DESTRUCTIVE=1 git branch -D`.
- **`kj` paths** (2026-10-07). The ticket guard rejects shell variables inside a `kj` path and `>|` redirects; write paths literally.
- **Ticket guard reads Bash text** (2026-10-07, hit twice). `guard-ticket-moves.py` refuses Bash commands whose text names Jira (the Collibra host, `JM_JIRA_SITE=`, even the word in a `sed` or commit heredoc) unless the program is one it knows sends no request. Write commit messages to a scratch file with the Write tool and pass `git commit -F`. `gh` refuses `--body-file` from a path; pass PR bodies inline as a `--body "$(cat <<'EOF' ... EOF)"` heredoc in a command of their own. Read Jira through `~/.claude/bin/kj collibra`.
- **msw 3 breaks Vitest's peer range** (2026-10-07). `pnpm add -D msw` resolves 3.x; Vitest wants `^2.4.9`. `@jira-mgr/core` pins `msw@^2`.
