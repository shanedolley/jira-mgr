# Prompt

## Start Here

Checked 2026-10-19 14:04 AEST. Shane gave the go on 2026-10-19 for #299, #300, #301 and #304 to #310. Ten issues are in progress, each built on a local branch and reviewed by an agent other than its builder (the reviews of #304 and of #307's drag fix were still running); the integrator `batch-1019-integrate` is still rebasing them into the stack order 299, 300, 308, 309, 301, 307, 306, 305, 310, 304, and only 300, 308 and 309 are stacked so far; the full e2e has not run. [handover.md](handover.md) "Where Work Stands" holds the record, the order and each issue's choices for Shane.

0. **Focus (Shane, 2026-10-19): "ensure documentation is up to date and remove any stale references."** Item 1 under "Keep the documentation current" below is the procedure. Docs describe main as it is: #299 to #310 are not merged, so name them as in progress, not built, and write the docs for each story in its own pull request.
1. **Run the tip route once the stack is integrated:** `pnpm ci:local`, the Electron dist check, then `lockf /tmp/jira-mgr-e2e.lock pnpm e2e --workers=1` (AGENTS.md). Read the counts. Check `uptime` first.
2. **Push in stack order and open one pull request per story** with the tip run's head SHA and counts, `Builder: <agent>` in the body and `Refs #n` in each commit. Then run the merge train (Loop step 7 and 8; the method is in the handover Traps).
3. **Move each issue to HIL Review** through `kothar:project-manager` after its merge, with its choices (handover table) in a comment and `question`. The move carries a `Review after` date-time. Shane closes only issues in HIL Review.
4. #278 stays open with no status label until #299 ships.
5. #255, the Vite+ spike, waits for Shane's go: a report and an ADR; the trial runs on a throwaway branch that never merges, and the report and the ADR reach main through their own docs pull request. Adoption work needs his approval of the new dependencies. The Dependabot majors #235 (@eslint/js 10) and #236 (msw 3) are not merged alone (see Not Alone and the handover Open Decisions); #255 may make #235 moot.

State, 2026-10-19 14:04 AEST: main's last code is 291ddf3 (PR #302; later commits change documentation only; run `git rev-parse origin/main` for the head). Twelve issues are open (`gh issue list --state open --limit 300`): the ten in progress, #278 and #255. None is in HIL Review. Two pull requests are open, the Dependabot majors (`gh pr list --state open`). `pnpm ci:local` on 239dd01 (tree equal to 291ddf3): core 1516 passed and 5 skipped, desktop 1346, CLI 603; e2e 796 passed and 1 skipped on one worker (details in the handover "What Runs").

Traps, met 2026-10-17 to 2026-10-19 (the handover Traps hold the full list): run every check in the foreground and tell each agent so, since agents waiting on a background run's notice stalled twice. One agent per worktree. Re-review every fix commit and confirm a builder applied a mid-build decision. Check `uptime` before e2e (load 16.77 at 14:03 AEST on 2026-10-19; 26.67 at 13:41). Dispatch `kothar:project-manager` on sonnet, unnamed. Grep the schema before calling a field a contract change.

Do not run `pnpm e2e` for a story. Shane's rules of 2026-10-15: builders run only their story's e2e files; the full local suite runs once, after a batch is developed (one agent, `lockf`, one worker, read the counts); stories stack and merge after that run; a pull request merges without waiting for Shane once the local CI route and the review verdict pass, as he reviews in the morning. GitHub Actions cannot run (Shane, 2026-10-17), so the full local suite is part of that route. Shane ruled on 2026-10-17 that a documentation-only change skips the e2e run ("if only documentation is being changed, it should skip the e2e run"): the definition is in [Local CI](docs/standards/git-workflow.md#local-ci), and `pnpm ci:local` still runs.

The local CI route replaces GitHub CI (see [Local CI](docs/standards/git-workflow.md#local-ci)): run `pnpm ci:local` on a clean, committed tree under Node 24, then the Electron dist check, then e2e on one worker. The test command is `pnpm test`, plus, for desktop work, only the e2e files the story touches, and `pnpm e2e --workers=1` once per batch (see above). No database exists: Jira is reached live only through `jm` and the app, and tests never write to it. [handover.md](handover.md) holds the state, the decisions and the traps.

1. **Keep the documentation current and remove stale references in every pull request.** Shane asked for this explicitly and restated it on 2026-10-13, 2026-10-18 and 2026-10-19. Check closed issues named as open and features named as planned or not built in `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` (except dated discovery records and accepted ADRs) and each package README; check each file name and script a doc names against `git ls-files` and `package.json`; compare the `e2e/README.md` suite table with `e2e/desktop/` and the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src`; compare the shortcut tables in `docs/reference/shortcuts.md` with `keymap.ts`; run a link and anchor check over every tracked `.md` file (a `python3 -I` script over `git ls-files '*.md'` that skips code spans and fences); run `pnpm docs:reference` and confirm `git status` is clean. Look for text describing Collapse all or Expand all, session-only collapse, the old #209 filter rule, `xvfb-run` instructions, or status-first ordering under Key (changed by #222). Last full sweep 2026-10-19 13:44 AEST on main at aaeae96 (the head then; 291ddf3 is the last code; PR #311 has since changed only the handover files): 91 tracked `.md` files, 79 outside `docs/discovery`, 421 relative links, anchors included, none broken; `pnpm docs:reference` under Node 24.16.0 left `git status` clean; all 46 `e2e/desktop/*.test.ts` files are named in `e2e/README.md` and every test file it names exists; every non-test file under `apps/desktop/src` is named in the file table and every `src/` path it names exists; the shortcut letters match `keymap.ts` (C, T, W, S, A, L, P, E, I, Y, U, F, and Shift+S, D, P, E, C); every `pnpm` script a doc names is in `package.json`, and every backticked file path exists but `docs/reference/core.md` (design 0001 says it is not built). The sweep fixed two stale lines: `docs/design/0002-issue-tree.md` said #273's choices were pending Shane's confirmation (he closed #273 with "Approved" on 2026-10-18), and `docs/product/roadmap.md` named #299 to #301 as filed and not built (now #299 to #301 and #304 to #310, in progress). Earlier sweeps (2026-10-16 at 8fd6c2c, 2026-10-18 at 291ddf3) are in PR #252 and PR #303. A story that changes behaviour a doc describes updates that doc in its own PR.
2. **Each story touching UI goes to HIL Review** after merge, per Loop step 9. Name in the comment the orchestrator's choices Shane has not confirmed and add `question`. Shane closed #219, #223, #224, #237 and #238 on 2026-10-17 on that footing, and closing an issue approves its listed choices.
3. Do not build gap 13 (undecided) or gap 14 (Later).

Run e2e with `pnpm e2e --workers=1`, serialised across worktrees with `lockf /tmp/jira-mgr-e2e.lock pnpm e2e --workers=1`. The lock file `/tmp/jira-mgr-e2e.lock` is a fixed path whose parent always exists; `lockf` creates it on first use, and `pgrep -fl lockf` shows whether a run holds it, and a run waits its turn when another holds it. The old path sat under a dead session's scratchpad, and a session's own scratchpad gives a different path, so two lock files let two runs overlap (see Traps in the handover).

## Reading Order

1. [handover.md](handover.md), then this file.
2. [AGENTS.md](AGENTS.md) and [docs/standards/](docs/standards/README.md).
3. [docs/product/roadmap.md](docs/product/roadmap.md), the [product grilling record](docs/discovery/2026-10-07-product-grilling.md) and the [ADRs](docs/adr/README.md).

## Loop

1. `git fetch` and read what changed in the handover files and `AGENTS.md`.
2. Claim the next unblocked issue: comment the branch, add `status:in-progress` through `kothar:project-manager`.
3. Cut a branch from `origin/main`. When Shane has said to stack a batch, cut from the branch below it. Read the issue and every file it touches.
4. Build the smallest change that meets the criteria, with its test.
5. Run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` (the full `pnpm ci:local` runs with the batch, below), plus, for desktop work, only the e2e files the story touches (`pnpm build`, then `cd e2e && lockf /tmp/jira-mgr-e2e.lock npx playwright test desktop/<file>.test.ts --workers=1`). Put that command in the first dispatch and forbid `pnpm e2e` outright: a builder whose run is killed restarts it. The full `pnpm e2e --workers=1` runs once, after the batch is developed. Read the pass and fail counts. Commit locally and have a reviewer other than the builder pass it before pushing, since a green PR may merge at once.
6. Run `/autonomous:update`, so the handover lands in the story's commit.
7. Commit with `Refs #n`. A stacked batch waits: when every story is developed and reviewed, run the local CI route once on the stack tip (`pnpm ci:local`, the Electron dist check, `lockf <lock file> pnpm e2e --workers=1`; see AGENTS.md), then push in stack order and open each pull request with that run's head SHA and pass and fail counts. GitHub Actions cannot run, so no `gh run` exists to wait for. A documentation-only change skips the Electron dist check and the e2e run (see [Local CI](docs/standards/git-workflow.md#local-ci)). A change after the run needs the route again. After each squash merge, rebase the next branch with `git rebase --onto origin/main <old tip of the branch below>`, using the hash, not the branch name.
8. When the local route passes on the pushed head and a PASS verdict is newer than the head, merge with `gh pr merge <n> --squash` without waiting for Shane. ship-it sometimes merges first and posts a "Merge already in progress" failure after our merge succeeded (#240, #241, #243): check `gh pr view <n> --json state` and ignore the notice. Confirm MERGED, then clean up the branch.
9. Comment on the issue how each criterion is met, ending with `Review verdict: PASS (reviewer <agent>, builder <agent>)`. Put nothing after the verdict line: the merge guard reads a verdict only as the first or last line of a comment (refused #226 once, 2026-10-14). Then have `kothar:project-manager` close it as Done, unless it needs Shane's judgement: anything he sees or uses (CLI output, Desktop UI), anything touching security or credentials, and live PSAPAC checks. Those go to `status:hil-review` for Shane to close (rule adopted by Shane 2026-10-07).

## Decision Format

Comment on the issue: the question, each option with its cost and what it buys, a recommendation with its reason, and what happens on each answer. Add the `question` label, then have `kothar:project-manager` set `status:hil-review`. Remove `question` once Shane answers. Shane finds his work by these two labels and closes only issues carrying `status:hil-review` (Shane, 2026-10-09).

## Not Alone

- Any write to live Jira (PSAPAC): creating, editing, transitioning or deleting issues, comments, worklogs, links or attachments. Tests never write. Re-running the write section of [the L7 runbook](docs/runbooks/l7-smoke-check.md) needs Shane present.
- Running `jm` by hand without `JM_STATE_DIR` set to a scratch folder. The real state folder holds Shane's timer and views.
- Merging a Dependabot major version bump.
- Code signing, notarisation, or anything that costs money.
- Changing an accepted ADR's decision; write a new ADR instead.

## Skills

- `verification-before-completion` before claiming any criterion met.
- `architecture-decisions` for a decision that is hard to reverse, surprising and a real trade-off.
- Design docs for L1, D2 and D4 from `docs/templates/design-doc.md`, before their code.
- `impeccable` and `frontend-design` for Desktop UI work.
- Compare Desktop UI against the Linear screenshots and tokens in [docs/design/linear/](docs/design/linear/README.md), captured 2026-10-09 at Shane's request; name in the pull request which Linear screenshots you compared and what differs (gh cannot upload images).
- `writing-clearly-and-concisely` rules for every doc, commit and comment.
