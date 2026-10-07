# Handover

## Where Work Stands

Checked 2026-10-07.

- `main` holds the scaffold (#1), roadmap and handover (#7), the `deps-dev` scope fix (#8), three Dependabot bumps (#2, #4, #5), C1 (#38), C2 (#39) and C3 (#40). Run `git log --oneline -1 origin/main` for the head commit.
- C4 HTTP client (#12) is on `c4-http-client`: `@jira-mgr/core/http` with Basic auth, JSON and multipart, abortable `Retry-After` retries, status mapping and redacted `JM_DEBUG` lines. Its security review passed on the third round, with mutation checks proving each regression test. Its pull request carries this handover; find it with `gh pr list --head c4-http-client`.
- Core subpaths: `@jira-mgr/core` (errors, renderer-safe), `/state`, `/auth`, `/http` (Node-only). `jm` still prints only `--help` and `--version`.

## Board

GitHub issues on `shanedolley/jira-mgr` track the work (Q43). Milestones Core (1), CLI (2) and Desktop (3) hold issues #9-#37, one per roadmap row, with blockers recorded through GitHub's issue dependencies.

| Measure | Value | Command | Date |
|---|---|---|---|
| Closed (Done) | #9 C1, #10 C2, #11 C3 | `gh issue list --state closed --limit 200` | 2026-10-07 |
| Open roadmap issues | 26 (Core 9, CLI 7, Desktop 10) | `gh issue list --state open --limit 200 --json milestone` | 2026-10-07 |
| In progress | #12 (C4) | `gh issue list --label status:in-progress` | 2026-10-07 |
| In AI or HIL review | none | `gh issue list --label status:ai-review` and `--label status:hil-review` | 2026-10-07 |

## Open Pull Requests

Checked 2026-10-07 with `gh pr list --state open`: only `c4-http-client`, pushed after its review passed. Dependabot #2, #4 and #5 merged; #3 and #6 closed after `@dependabot ignore this major version`.

## What Runs

All from the repository root, under Node 24 (see Traps).

| Command | Does | Reaches |
|---|---|---|
| `pnpm test` | Vitest unit tests (130 pass and 1 skipped in `core`, 6 files, measured on `c4-http-client` 2026-10-07) | Nothing external: Jira calls hit the MSW fake, which fails any unhandled request |
| `pnpm test:live` | Same plus `*.live.test.ts` with `JM_LIVE_JIRA=1` | Live PSAPAC, read-only. No live tests exist yet (2026-10-07) |
| `pnpm e2e` | Builds the desktop app and runs the Playwright Electron smoke test | A local Electron window, no network |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` | Checks and builds | Nothing external |
| `pnpm jm -- <args>` | Runs the built CLI | Nothing yet; later the site and project in `settings.json` |
| `pnpm fixture:record -- <name> <GET\|POST> <path> [body]` | Records one response body to `packages/core/fixtures/` | Live Jira at `JM_JIRA_SITE`, reads only: it refuses every write except the search `POST` |

State files live in `~/Library/Application Support/jira-mgr/`; set `JM_STATE_DIR` to point a run or test elsewhere. `JM_LIVE_KEYCHAIN=1` on macOS runs `auth.live.test.ts`, which writes and deletes a throwaway Keychain item (`jira-mgr-test-<uuid>`); unit tests inject a fake `security` runner and never touch the Keychain.

No database exists or is planned. CI (`.github/workflows/ci.yml`) runs `pr-title`, `checks` and `e2e` on pull requests and on pushes to `main`. Last `main` run: success on the PR #40 merge, 0355d37 (`gh run list --workflow ci.yml --branch main --limit 1`, 2026-10-07).

## Environments

- Jira: Collibra site `engineering-collibra.atlassian.net`, project PSAPAC. PSAPAC's measured shape (issue types, field ids, statuses, link types, sprints, counts) is in [round 2](docs/discovery/2026-10-07-product-grilling/round-2.md), measured 2026-10-07.
- Credentials: `~/.claude/bin/kj collibra` reads the Keychain item `kothar-jira-collibra` with `COLLIBRA_JIRA_EMAIL`, and the fixture recorder borrows that token through `JM_JIRA_TOKEN`. jira-mgr's own item (service `jira-mgr`, account = email) is written by `login` from `@jira-mgr/core/auth`, but no real login has run, so it does not exist (`security find-generic-password -s jira-mgr` exits 44, 2026-10-07).
- Recorded fixtures are committed as recorded, with no scrubbing (Q60). Never record request headers.

## Open Decisions

| Raised | Decision | Owner |
|---|---|---|
| none open | | |

Answered 2026-10-07: internal stories close as Done after a passing agent review, while user-facing, security and live-Jira work goes to Shane in HIL Review (adopted by Shane); Keychain access through `/usr/bin/security`; state files in `~/Library/Application Support/jira-mgr/`; Markdown in the CLI; build order Core, CLI, Desktop; roadmap approved and merged (#7); Dependabot majors: merge vite 8, typescript 7 and @types/node 26, ignore plugin-react 6 and eslint 10. zod approved as core's validation library (C2). View filters are multi-value arrays; `internal` errors exit 1.

## Traps

- **Node 22 by default** (re-checked 2026-10-07: `node -v` gives v22.22.0). The machine's default `node` is 22.22; the repo needs 24. Prefix commands with `PATH=$HOME/.local/share/mise/installs/node/24.16.0/bin:$PATH`, or run `mise use node@24` in the repo.
- **Dependabot titles fail `pr-title`** - resolved 2026-10-07. Added `deps-dev` to the allowed scopes in `ci.yml` and documented in `docs/standards/git-workflow.md` that Dependabot uses `deps` for runtime and `deps-dev` for dev dependencies.
- **pnpm forwards `--`** (2026-10-07). `pnpm jm -- --help` passes a literal `--`; `scripts/jm.ts` strips it.
- **Pinned toolchain** (re-checked 2026-10-07). ESLint stays on 9 for `eslint-plugin-react`. Dependabot #4 moved every package to TypeScript `~7.0.2` except `packages/config-lint`, which keeps `~6.0.0` for `typescript-eslint`; lint and typecheck pass. `packages/config-lint/README.md` still says TypeScript stays on 6.0, which now holds only for that package.
- **Squash merges and `git branch -d`** (2026-10-07). After a squash merge `-d` refuses; confirm `git diff --quiet main <branch>` and then use `KOTHAR_ALLOW_DESTRUCTIVE=1 git branch -D`.
- **`kj` paths** (2026-10-07). The ticket guard rejects shell variables inside a `kj` path and `>|` redirects; write paths literally.
- **Ticket guard reads Bash text** (2026-10-07, hit twice). `guard-ticket-moves.py` refuses Bash commands whose text names Jira (the Collibra host, `JM_JIRA_SITE=`, even the word in a `sed` or commit heredoc) unless the program is one it knows sends no request. Write commit messages to a scratch file with the Write tool and pass `git commit -F`. `gh` refuses `--body-file` from a path; pass PR bodies inline as a `--body "$(cat <<'EOF' ... EOF)"` heredoc in a command of their own. Read Jira through `~/.claude/bin/kj collibra`.
- **msw 3 breaks Vitest's peer range** (2026-10-07). `pnpm add -D msw` resolves 3.x; Vitest wants `^2.4.9`. `@jira-mgr/core` pins `msw@^2`.
- **Weak regression tests** (2026-10-07). C4's first abort test passed with the bug still present. Reviewers now revert each fix in a scratch copy and confirm its test fails; ask for that on every bug fix.
- **Auto-merge on green** (2026-10-07). PR #38 merged under Shane's account as soon as CI passed, before its review finished, and a later "ship-it" merge attempt then reported conflicts. Run the review on the local commit before pushing.
- **Node modules in the renderer** (2026-10-07). Re-exporting `node:fs` code from `@jira-mgr/core`'s main entry makes the desktop build warn. Node-only code goes behind a subpath export such as `@jira-mgr/core/state`.
- **`security -i` exits 0 on failure and splits long lines** (2026-10-07). A bad command inside `security -i` still exits 0 and can create a junk item, and stdin past 4095 bytes runs as a second command. `@jira-mgr/core/auth` caps token and email length, refuses commands of 4095 bytes or more, and reads the item back after every write. Probe the Keychain only with throwaway service names and delete what you create.
- **Shell noclobber** (2026-10-07). `>` refuses to overwrite an existing file; a check run redirected to an old log silently did not run. Use a fresh log name per run.
