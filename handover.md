# Handover

## Where Work Stands

Checked 2026-10-07.

- `main` holds the scaffold (#1), roadmap and handover (#7), the `deps-dev` scope fix (#8), three Dependabot bumps (#2, #4, #5) C1 (#38) and C2 (#39). Run `git log --oneline -1 origin/main` for the head commit.
- C2 state files merged in #39: `JiraMgrError` in `@jira-mgr/core`, validated atomic state files in `@jira-mgr/core/state`.
- C3 credentials (#11) is built on `c3-credentials`: `@jira-mgr/core/auth` with Keychain access through `/usr/bin/security`, `login`, `logout`, `getCredentials`. Its pull request carries this handover; find it with `gh pr list --head c3-credentials`.
- No Jira client exists yet. `jm` prints only `--help` and `--version`.

## Board

GitHub issues on `shanedolley/jira-mgr` track the work (Q43). Milestones Core (1), CLI (2) and Desktop (3) hold issues #9-#37, one per roadmap row, with blockers recorded through GitHub's issue dependencies.

| Measure | Value | Command | Date |
|---|---|---|---|
| Open roadmap issues | 29 (Core 12, CLI 7, Desktop 10); issues stay open in AI Review | `gh issue list --state open --limit 200 --json milestone` | 2026-10-07 |
| In progress | #11 (C3) | `gh issue list --label status:in-progress` | 2026-10-07 |
| In AI review | #9 (C1), #10 (C2) | `gh issue list --label status:ai-review` | 2026-10-07 |

## Open Pull Requests

Checked 2026-10-07 with `gh pr list`: only `c3-credentials`, once pushed. Dependabot #2, #4 and #5 merged; #3 and #6 closed after `@dependabot ignore this major version`.

## What Runs

All from the repository root, under Node 24 (see Traps).

| Command | Does | Reaches |
|---|---|---|
| `pnpm test` | Vitest unit tests (79 pass and 1 skipped in `core`, 5 files, checked 2026-10-07) | Nothing external: Jira calls hit the MSW fake, which fails any unhandled request |
| `pnpm test:live` | Same plus `*.live.test.ts` with `JM_LIVE_JIRA=1` | Live PSAPAC, read-only. No live tests exist yet (2026-10-07) |
| `pnpm e2e` | Builds the desktop app and runs the Playwright Electron smoke test | A local Electron window, no network |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` | Checks and builds | Nothing external |
| `pnpm jm -- <args>` | Runs the built CLI | Nothing yet; later the site and project in `settings.json` |

State files live in `~/Library/Application Support/jira-mgr/`; set `JM_STATE_DIR` to point a run or test elsewhere. `JM_LIVE_KEYCHAIN=1` on macOS runs `auth.live.test.ts`, which writes and deletes a throwaway Keychain item (`jira-mgr-test-<uuid>`); unit tests inject a fake `security` runner and never touch the Keychain.
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

Answered 2026-10-07: Keychain access through `/usr/bin/security`; state files in `~/Library/Application Support/jira-mgr/`; Markdown in the CLI; build order Core, CLI, Desktop; roadmap approved and merged (#7); Dependabot majors: merge vite 8, typescript 7 and @types/node 26, ignore plugin-react 6 and eslint 10. zod approved as core's validation library (C2). View filters are multi-value arrays; `internal` errors exit 1.

## Traps

- **Node 22 by default** (2026-10-07). The machine's default `node` is 22.22; the repo needs 24. Prefix commands with `PATH=$HOME/.local/share/mise/installs/node/24.16.0/bin:$PATH`, or run `mise use node@24` in the repo.
- **Dependabot titles fail `pr-title`** - resolved 2026-10-07. Added `deps-dev` to the allowed scopes in `ci.yml` and documented in `docs/standards/git-workflow.md` that Dependabot uses `deps` for runtime and `deps-dev` for dev dependencies.
- **pnpm forwards `--`** (2026-10-07). `pnpm jm -- --help` passes a literal `--`; `scripts/jm.ts` strips it.
- **Pinned toolchain** (2026-10-07). TypeScript stays below 6.1 for `typescript-eslint`, ESLint stays on 9 for `eslint-plugin-react`. See `packages/config-lint/README.md`.
- **Squash merges and `git branch -d`** (2026-10-07). After a squash merge `-d` refuses; confirm `git diff --quiet main <branch>` and then use `KOTHAR_ALLOW_DESTRUCTIVE=1 git branch -D`.
- **`kj` paths** (2026-10-07). The ticket guard rejects shell variables inside a `kj` path and `>|` redirects; write paths literally.
- **Ticket guard reads Bash text** (2026-10-07, hit twice). `guard-ticket-moves.py` refuses Bash commands whose text names Jira (the Collibra host, `JM_JIRA_SITE=`, even the word in a `sed` or commit heredoc) unless the program is one it knows sends no request. Write commit messages to a scratch file with the Write tool and pass `git commit -F`. `gh` refuses `--body-file` from a path; pass PR bodies inline as a `--body "$(cat <<'EOF' ... EOF)"` heredoc in a command of their own. Read Jira through `~/.claude/bin/kj collibra`.
- **msw 3 breaks Vitest's peer range** (2026-10-07). `pnpm add -D msw` resolves 3.x; Vitest wants `^2.4.9`. `@jira-mgr/core` pins `msw@^2`.
- **Auto-merge on green** (2026-10-07). PR #38 merged under Shane's account as soon as CI passed, before its review finished, and a later "ship-it" merge attempt then reported conflicts. Run the review on the local commit before pushing.
- **Node modules in the renderer** (2026-10-07). Re-exporting `node:fs` code from `@jira-mgr/core`'s main entry makes the desktop build warn. Node-only code goes behind a subpath export such as `@jira-mgr/core/state`.
- **`security -i` exits 0 on failure and splits long lines** (2026-10-07). A bad command inside `security -i` still exits 0 and can create a junk item, and stdin past 4095 bytes runs as a second command. `@jira-mgr/core/auth` caps token and email length, refuses commands of 4095 bytes or more, and reads the item back after every write. Probe the Keychain only with throwaway service names and delete what you create.
- **Shell noclobber** (2026-10-07). `>` refuses to overwrite an existing file; a check run redirected to an old log silently did not run. Use a fresh log name per run.
