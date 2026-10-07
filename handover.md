# Handover

## Where Work Stands

Checked 2026-10-08.

- The Core milestone is complete: C1-C12 merged (#38-#45, #47-#50) and closed. Run `git log --oneline -1 origin/main` for the head commit.
- Core subpaths: `@jira-mgr/core` (errors and the `Issue` type, renderer-safe), `/issue`, `/hierarchy`, `/adf`, `/timer-calc`, `/view-filter` (renderer-safe), `/state`, `/auth`, `/http`, `/fields`, `/search`, `/write`, `/extras`, `/sprints`, `/lookups`, `/timer` (Node-only).
- L1 command schema merged in #51 (78e186d) from the accepted design doc [docs/design/0001-cli-command-schema.md](docs/design/0001-cli-command-schema.md); #21 closed by Shane on 2026-10-08 ("Approved"): every L2-L6 command is specified in `apps/cli/src/schema.ts`; only `help` has a handler, so later stories add handlers only. `pnpm docs:reference` writes `docs/reference/cli.md` and `errors.md`, and CI fails if they drift.
- L2 auth merged in #52 (b1f7b5a); #22 closed by Shane on 2026-10-08 ("Approved"): `jm auth login` (token from `--token-stdin` or a hidden prompt, never a flag), `status`, `logout`. CLI tests share core's MSW fake (`@jira-mgr/core/test/msw`, `/test/setup`) and run behind a backstop that makes spawning `/usr/bin/security` throw.
- L3 reading merged in #53 (43b96e9); #23 closed by Shane on 2026-10-08 ("Approved"): `jm issue list`, `issue tree`, `issue get`, `field options`, `link types`, `sprint list`, `view list`.
- L4 writing merged in #54 (7536ea7); #24 closed by Shane on 2026-10-08 ("Approved"): `jm issue create`, `edit`, `delete` (needs `--confirm`, and `--with-subtasks` to cascade) and `jm status set`. Write commands and `--parent` refuse issue keys outside the configured project (orchestrator decision, 2026-10-07).
- L5 extras merged in #55 (24b91b0); #25 closed by Shane on 2026-10-08 ("Approved"): `jm comment`, `worklog`, `link`, `attach`, `sprint set`; the project guard covers every key they write to, including both ends of `link remove`.
- L6 timer merged in #56 (c29fe9d); #26 closed by Shane on 2026-10-08 ("Approved"): `jm timer start`, `stop`, `status`, `pause`, `resume`. The CLI is feature-complete on `main`.
- L7 live check (#27) ran on 2026-10-08 with Shane present, on branch `l7-live-check`: [docs/runbooks/l7-smoke-check.md](docs/runbooks/l7-smoke-check.md) lists every `jm` command with its result, and its Findings section answers the questions collected on #27. Throwaway issues PSAPAC-3127, PSAPAC-3128 and PSAPAC-3129 were created and deleted; none remain. #27 goes to HIL Review for Shane after the runbook PR merges. Desktop D1 (#28) is blocked by every CLI story #21 to #27 (checked 2026-10-08 with `gh api repos/shanedolley/jira-mgr/issues/28/dependencies/blocked_by`: #21 to #26 closed, #27 open), so D1 waits on Shane closing #27.
- Bugs from the L7 run (both in the CLI milestone, open 2026-10-08): #60, `worklog edit` and `worklog delete` acted on a worklog that belongs to another issue (core; High, data loss), is fixed on branch `fix-foreign-worklog` (2026-10-08): both now GET the worklog through the given key first, and Jira answers a foreign pair with 404 (verified live, read-only, 2026-10-08), which maps to `not_found`, exit 3. The branch is not pushed; it awaits review and a pull request. #61, a doubled full stop in Jira error messages and an empty ADF doc as a worklog `comment` (CLI output), is not started.
- CLI decisions (Shane, 2026-10-07): JSON envelope `{"data"}` / `{"error"}`; extra commands comment, worklog, link, attach and view list plus sprint set backlog; a timer stop needing confirmation exits 2 without `--confirm` or `--time`; JSON carries `descriptionMarkdown` and `bodyMarkdown` beside the ADF.
- Live results (2026-10-08, L7): issue type change between Story, Task and Bug works; setting `originalEstimate` alone sets the remaining estimate to the same value; a Subtask accepts Start date, Time remaining and Priority (no 400); `sprint set` into a future sprint and back to the backlog works on board 1706; worklog add, edit and delete with `adjustEstimate=auto` adjust the remaining estimate correctly; attachment upload works, 5 MB in 4 s; the timer logs a rounded worklog; Jira refuses a comment id from another issue with 404 but applies a worklog write through the wrong issue (#60); it does answer a worklog read through the wrong issue with 404, which is what the #60 fix relies on. Link direction was verified live on 2026-10-07 with Shane's approval (link 642179 created and deleted): the issue named `inwardIssue` in a POST is the blocker, and L7 step 31 confirmed it again.
- Client-side rules core leaves to the CLI and app (C11 findings): label suggestions are site-wide, so filter to project labels if wanted (Q35); hide undated sprints such as "PS TEMPLATES" behind "Show all" (Q20); priorities come from createmeta (11 for PSAPAC), not `/priority` (20 site-wide).

## Board

GitHub issues on `shanedolley/jira-mgr` track the work (Q43). Milestones Core (1), CLI (2) and Desktop (3) hold issues #9-#37, one per roadmap row, plus bugs found later (#60 and #61 in CLI), with blockers recorded through GitHub's issue dependencies.

| Measure | Value | Command | Date |
|---|---|---|---|
| Closed (Done) | #9-#26 (all of Core, and L1-L6) | `gh issue list --state closed --limit 200` | 2026-10-08 |
| Open issues | 13 (CLI 3: #27, #60, #61; Desktop 10: #28-#37) | `gh issue list --state open --limit 200 --json number,milestone` | 2026-10-08 |
| In progress | #27 (L7), claimed on branch `l7-live-check` | `gh issue list --label status:in-progress` | 2026-10-08 |
| In AI or HIL review | none; #27 moves to HIL Review after the runbook PR merges, and the #60 fix on `fix-foreign-worklog` awaits review | `gh issue list --label status:ai-review` and `--label status:hil-review` | 2026-10-08 |

## Open Pull Requests

Checked 2026-10-08 with `gh pr list --state open`: none (the L7 runbook PR is not open yet, and `fix-foreign-worklog` for #60 is not pushed). Dependabot #2, #4 and #5 merged; #3 and #6 closed after `@dependabot ignore this major version`.

## What Runs

All from the repository root, under Node 24 (see Traps).

| Command | Does | Reaches |
|---|---|---|
| `pnpm test` | Vitest unit tests (core 1037 pass and 1 skipped in 18 files; CLI 578 in 34 files, after a `tsup` build; measured on branch `fix-foreign-worklog` 2026-10-08) | Nothing external: Jira calls hit the MSW fake, which fails any unhandled request |
| `pnpm test:live` | Same plus `*.live.test.ts` with `JM_LIVE_JIRA=1` | Live PSAPAC, read-only. No live tests exist yet (2026-10-07) |
| `pnpm e2e` | Builds the desktop app and runs the Playwright Electron smoke test | A local Electron window, no network |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` | Checks and builds | Nothing external |
| `pnpm jm -- <args>` | Runs the built CLI: every command is on `main` (2026-10-08) | Live Jira at the site in `settings.json`, as the logged-in user; writes from L4 on (create, edit, delete, status, comment, worklog, link, attach, sprint, timer) |
| `pnpm docs:reference` | Regenerates `docs/reference/cli.md` and `errors.md` from `jm help --json` | Nothing external |
| `pnpm fixture:record -- <name> <GET\|POST> <path> [body]` | Records one response body to `packages/core/fixtures/` | Live Jira at `JM_JIRA_SITE`, reads only: it refuses every write except the search `POST` |

State files live in `~/Library/Application Support/jira-mgr/`; set `JM_STATE_DIR` to point a run or test elsewhere. `JM_LIVE_KEYCHAIN=1` on macOS runs `auth.live.test.ts`, which writes and deletes a throwaway Keychain item (`jira-mgr-test-<uuid>`); unit tests inject a fake `security` runner and never touch the Keychain.

No database exists or is planned. CI (`.github/workflows/ci.yml`) runs `pr-title`, `checks` and `e2e` on pull requests and on pushes to `main`. Last code merge on `main`: PR #56 (c29fe9d), CI green; the docs-only merges after it (#57, #58, #59) are green too (checked 2026-10-08). For the current head run, use `gh run list --workflow ci.yml --branch main --limit 1`.

## Environments

- Jira: Collibra site `engineering-collibra.atlassian.net`, project PSAPAC. PSAPAC's measured shape (issue types, field ids, statuses, link types, sprints, counts) is in [round 2](docs/discovery/2026-10-07-product-grilling/round-2.md), measured 2026-10-07. Correction from the recorded createmeta fixtures (2026-10-07): Sprint (10600) is on Task, Bug, Story and Subtask, absent only on Epic; Start date (13808) is on Bug, Story and Epic, absent on Task and Subtask in createmeta, though a live Subtask edit accepted it. Field presence comes from createmeta and editmeta, not from round 2. Editmeta (C10 fixtures) lists no Priority for Subtask and `issuetype` with no operations, allowed values Task, Bug and Story, but live edits (L7, 2026-10-08) changed a Subtask's Priority, Start date and Time remaining and changed an issue's type, so metadata does not predict what Jira accepts; transition 3 on Epics is named "REVIEW", so match transitions by target status.
- Credentials: `~/.claude/bin/kj collibra` reads the Keychain item `kothar-jira-collibra` with `COLLIBRA_JIRA_EMAIL`, and the fixture recorder borrows that token through `JM_JIRA_TOKEN`. jira-mgr's own item (service `jira-mgr`, account = the Collibra email) is written by `login` from `@jira-mgr/core/auth`. A real login has run, so `jm` is logged in on this Mac (`security find-generic-password -s jira-mgr` exits 0, checked 2026-10-08).
- Recorded fixtures are committed as recorded, with no scrubbing (Q60). Never record request headers.

## Open Decisions

| Raised | Decision | Owner |
|---|---|---|
| 2026-10-08 | Should `jm issue create` read the new issue back and report fields the PSAPAC automation rule changed? Read back and return the full issue costs one more GET per create and shows the real Customer, parent and sprint; leaving it as is returns only the key and needs a note in the CLI reference. Recommendation: read back. Put to Shane on [#27](https://github.com/shanedolley/jira-mgr/issues/27#issuecomment-6048998036) on 2026-10-08; unanswered. | Shane |

Answered 2026-10-07: with "Hide done" and "Assignee: me" both on, an open issue of yours keeps its Done ancestors visible as dimmed context (orchestrator decision in C7, reported to Shane); internal stories close as Done after a passing agent review, while user-facing, security and live-Jira work goes to Shane in HIL Review (adopted by Shane); Keychain access through `/usr/bin/security`; state files in `~/Library/Application Support/jira-mgr/`; Markdown in the CLI; build order Core, CLI, Desktop; roadmap approved and merged (#7); Dependabot majors: merge vite 8, typescript 7 and @types/node 26, ignore plugin-react 6 and eslint 10. zod approved as core's validation library (C2); `marked` approved as core's Markdown lexer (C9). View filters are multi-value arrays; `internal` errors exit 1.

## Traps

- **Node 22 by default** (re-checked 2026-10-07 after L1: `node -v` gives v22.22.0). The machine's default `node` is 22.22; the repo needs 24. Prefix commands with `PATH=$HOME/.local/share/mise/installs/node/24.16.0/bin:$PATH`, or run `mise use node@24` in the repo.
- **Dependabot titles fail `pr-title`** - resolved 2026-10-07. Added `deps-dev` to the allowed scopes in `ci.yml` and documented in `docs/standards/git-workflow.md` that Dependabot uses `deps` for runtime and `deps-dev` for dev dependencies.
- **pnpm forwards `--`** (2026-10-07). `pnpm jm -- --help` passes a literal `--`; `scripts/jm.ts` strips it.
- **Pinned toolchain** (re-checked 2026-10-07). ESLint stays on 9 for `eslint-plugin-react`. Dependabot #4 moved every package to TypeScript `~7.0.2` except `packages/config-lint`, which keeps `~6.0.0` for `typescript-eslint`; lint and typecheck pass (re-checked 2026-10-07). `packages/config-lint/README.md` still says TypeScript stays on 6.0, which now holds only for that package.
- **Squash merges and `git branch -d`** (2026-10-07). After a squash merge `-d` refuses; confirm `git diff --quiet main <branch>` and then use `KOTHAR_ALLOW_DESTRUCTIVE=1 git branch -D`.
- **`kj` paths** (2026-10-07, hit again 2026-10-08). The ticket guard rejects shell variables inside a `kj` path and `>|` redirects; write paths literally. It also rejects a Bash command that mixes `kj` with other programs or sources a script first; run `kj` alone with a plain `>` redirect to a file, then parse the file in a second command.
- **Ticket guard reads Bash text** (2026-10-07, hit twice). `guard-ticket-moves.py` refuses Bash commands whose text names Jira (the Collibra host, `JM_JIRA_SITE=`, even the word in a `sed` or commit heredoc) unless the program is one it knows sends no request. Write commit messages to a scratch file with the Write tool and pass `git commit -F`. `gh` refuses `--body-file` from a path; pass PR bodies inline as a `--body "$(cat <<'EOF' ... EOF)"` heredoc in a command of their own. Read Jira through `~/.claude/bin/kj collibra`.
- **msw 3 breaks Vitest's peer range** (2026-10-07). `pnpm add -D msw` resolves 3.x; Vitest wants `^2.4.9`. `@jira-mgr/core` pins `msw@^2`.
- **Weak regression tests** (2026-10-07). C4's first abort test passed with the bug still present. Reviewers now revert each fix in a scratch copy and confirm its test fails; ask for that on every bug fix.
- **ship-it merges on green** (2026-10-07, hit on #38, #40, #42, #43; it also merged #44, #45 and #47 unprompted, but left #46, a docs-only PR, open until merged by hand). The ship-it automation merges a PR under Shane's account as soon as CI passes, and a second merge (ship-it or `gh pr merge`) then reports "merge conflicts" or "merge already in progress". Review the local commit before pushing, never run `gh pr merge` yourself, and treat that ship-it failure as noise once `gh pr view <n> --json state` says MERGED.
- **Node modules in the renderer** (2026-10-07). Re-exporting `node:fs` code from `@jira-mgr/core`'s main entry makes the desktop build warn. Node-only code goes behind a subpath export such as `@jira-mgr/core/state`.
- **`security -i` exits 0 on failure and splits long lines** (2026-10-07). A bad command inside `security -i` still exits 0 and can create a junk item, and stdin past 4095 bytes runs as a second command. `@jira-mgr/core/auth` caps token and email length, refuses commands of 4095 bytes or more, and reads the item back after every write. Probe the Keychain only with throwaway service names and delete what you create.
- **Shell noclobber** (2026-10-07). `>` refuses to overwrite an existing file; a check run redirected to an old log silently did not run. Use a fresh log name per run.
- **Recorded search pages never end** (2026-10-07). Fixtures recorded mid-phase all carry `isLast: false`; tests serve page 2 with the token dropped and `isLast: true`. Record from the end of a phase if a test needs a genuine last page.
- **Reviewers can be confidently wrong about Jira semantics** (2026-10-07). C11's reviewer called the link direction reversed, citing a third-party issue; a live check proved the builder right. When builder and reviewer disagree on Jira behaviour and only a write can settle it, ask Shane for one reversible live check rather than picking a side.
- **Timer guard matches keys, not timers** (2026-10-07, accepted). `expectRunning` compares the issue key, so if the CLI stops and restarts the same issue while the app's stop dialog is open, confirming logs the dialog's time against the new timer too (two worklogs). Rare; add an `expectStarted` check if it ever bites.
- **views.json has no lock** (2026-10-07, accepted). View create, rename and delete use atomic writes but no lock, so an app and a CLI editing views at the same moment can lose one edit. Reuse the timer's lock if it ever bites.
- **Eager promises in tests** (2026-10-07). A C8 test built several rejecting promises in an array before awaiting the first, so a later one could reject unhandled and fail the run intermittently. Fixed in L1 by iterating thunks; build each promise only when you await it.
- **HIL blockers stay open** (2026-10-07). A story in HIL Review stays open until Shane closes it, so GitHub still lists it as an open blocker (#28 will show #27 open while #27 sits in HIL Review). Treat a blocker whose code is merged and that sits in HIL Review as satisfied for building; it only waits on Shane's sign-off.
- **Timer known limit** (2026-10-07, accepted). A SIGKILL, power loss or second Ctrl-C between core taking the timer and the worklog finishing can still lose the tracked time; one Ctrl-C restores it paused. Documented in packages/core/README.md.
- **PSAPAC automation rewrites new issues** (2026-10-08, cost: T2 landed in the active sprint under a BHP Epic). An Automation for Jira rule runs after every create: it adds the label `PSAPAC`, sets the original estimate to 14400 with remaining 0, and sets Time remaining (h); on a Task it also replaced the Customer, the parent and the sprint the CLI sent. `issue create` returns only the key, so the caller sees none of it. Read the issue back after a create (see Open Decisions).
- **Estimate edits cascade** (2026-10-08). `--estimate` alone sets the remaining estimate to the same value, even from 0, and the rule above then keeps Time remaining (h) equal to the remaining estimate after estimate edits and worklogs. A direct `--time-remaining` edit stuck in the live run.
- **Foreign worklog ids are not refused** - resolved 2026-10-08 by #60 (fix on branch `fix-foreign-worklog`, pending review and PR). Jira answers 404 for a comment id from another issue but edited or deleted a worklog id from another issue, and the CLI's project guard checks only the key. `editWorklog` and `deleteWorklog` now GET the worklog through the given key first; Jira answers a foreign pair with 404 (verified live, read-only), which maps to `not_found`. Until that branch merges, never run `worklog edit` or `worklog delete` with an id you did not read from that issue's `worklog list`.
- **Runs against the real state folder leave state behind** (2026-10-08, cost: a stale paused timer on PSAPAC-12 and a risk that `timer start` would have logged it). The L6 review run used the real state folder, so `timer.json` held a timer (5400 s on PSAPAC-12) until Shane approved discarding it with `jm timer stop --discard`. Builders and reviewers must set `JM_STATE_DIR` to a scratch folder when running `jm` by hand.
- **Live-run shell habits** (2026-10-08). Start a live run by copying `views.json` and `timer.json` from the state folder, and finish by comparing them; use `timer start <key> --expect <key>`, which refuses when another issue's timer runs.
