# Prompt

## Start Here

**Focus: keep the documentation up to date and remove stale references** (Shane, 2026-10-16; item 1 below says how, and the sweep of that date is recorded there). **No unblocked story remains** (2026-10-16). The 2026-10-15 batch is merged, and every open issue waits on Shane in HIL Review. Shane has not answered any of them since the HIL moves of 2026-10-15 15:28 to 15:37 UTC (`gh issue view <n> --json comments,updatedAt`: the last comment on each is the move comment; checked 2026-10-16). Keeping the documentation current (item 1 below) still applies to every pull request.

Six issues are open, all in HIL Review (`gh issue list --state open --limit 200`, 2026-10-16): #217, #219, #223, #224, #237 and #238. Two Dependabot pull requests are the only open ones, #235 and #236 (`gh pr list --state open`, 2026-10-16). [handover.md](handover.md) "Open Stories" gives each story's merge, review verdict and the choices Shane has not confirmed. Do these in order:

- Shane's HIL answers on #217, #219, #223, #224, #237 and #238 come first. He closes an issue he approves. On an answer that asks for a change, claim the issue again, build it and return it to HIL Review. `question` stands on #223, #224, #237 and #238 for the orchestrator's choices (each issue's last comment); remove it once he answers.
- Then any follow-up he raises.
- Then the Dependabot majors: #235 (@eslint/js 10) and #236 (msw 3) fail `checks`; do not merge either alone (see Not Alone and the Open Decisions in the handover). The minor and patch group landed as #247 (abb3b60) on 2026-10-15.
- Do not run `pnpm e2e` for a story. Shane's rules of 2026-10-15: builders run only their story's e2e files; the full local suite runs once, after a batch is developed (one agent, `lockf`, one worker, read the counts); stories stack and merge after that run; a pull request merges without waiting for Shane once CI and the review verdict pass, as he reviews in the morning.

CI runs on 2 workers. The test command is `pnpm test`, plus, for desktop work, only the e2e files the story touches, and `pnpm e2e --workers=1` once per batch (see above). No database exists: Jira is reached live only through `jm` and the app, and tests never write to it. [handover.md](handover.md) holds the state, the decisions and the traps.

1. **Keep the documentation current and remove stale references in every pull request.** Shane asked for this explicitly and restated it on 2026-10-13. Check closed issues named as open and features named as planned or not built in `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` (except dated discovery records) and each package README; check each file name and script a doc names against `git ls-files` and `package.json`; compare the `e2e/README.md` suite table with `e2e/desktop/` and the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src`; run a link and anchor check over every tracked `.md` file; run `pnpm docs:reference` and confirm no drift. Look for text describing Collapse all or Expand all, session-only collapse, the old #209 filter rule, `xvfb-run` instructions, or status-first ordering under Key (changed by #222). Last swept 2026-10-16 at main abb3b60, over every tracked `.md` file outside `docs/discovery` and accepted ADRs (Shane's focus of that date): 79 tracked `.md` files and 274 relative links outside code spans and fences, anchors included, none broken (a `python3 -I` script over `git ls-files '*.md'` in the session scratchpad; its counts differ from the 2026-10-16 sweep at a3c4df9, which counted 91 files and 409 links, because this script skips code spans and the earlier one covered a wider file set); every `e2e/desktop/*.test.ts` named in `e2e/README.md` and every test file it names present; every non-test file under `apps/desktop/src` named in the `apps/desktop/README.md` file table, some in grouped rows, and every `src/` path the table names present; `pnpm docs:reference` under Node 24 left `git status` clean apart from the handover files. Every backticked file path in the docs existed, or was runtime state (`settings.json`, `views.json`, `timer.json`, `inbox.json`, `fields.json`), build output, an example, or a file a doc says is not built or not yet needed (`docs/reference/core.md`, `turbo.json`). #247 (Electron 44.7.0, Playwright 1.64.0, vite 8.3.4, vitest 5.0.3, marked 18.1.0) changed no version a doc names: no doc outside the handover pins those versions or names #234. Searches for a Hold ring described as red or dotted, a faded ring or a half-opacity ring, Collapse all or Expand all, session-only collapse and `xvfb-run` found no stale text outside dated records (`CONTEXT.md` line 40 keeps "collapse all" as an alias to avoid; design 0002 line 442 records the replaced session-only collapse; `e2e/README.md` says no `xvfb-run` is needed). The sweep found nothing stale and changed no file but the handover. The earlier a3c4df9 sweep's fixes (`manual.test.ts` in `e2e/README.md`, six Ordering choices, Hold and the 2026-10-15 stories in the root `README.md` and `docs/product/roadmap.md`) are on main. A story that changes behaviour a doc describes updates that doc in its own PR.
2. **Each story touching UI goes to HIL Review** after merge, per Loop step 9. Name in the comment the orchestrator's choices Shane has not confirmed and add `question`, as the comments on #223, #224, #237 and #238 do.
3. Do not build gap 13 (undecided) or gap 14 (Later).

Run e2e with `pnpm e2e --workers=1`, serialised across worktrees with `lockf <lock file> pnpm e2e --workers=1`. The lock file is the shared path `/private/tmp/claude-501/-Users-shanedolley-Development-personal-jira-mgr/7bf42498-7df8-4d47-81dd-d0657b1f4070/scratchpad/e2e.lock`; no agent holds it (every teammate of the prior session was idle, and the file was absent at 01:57 AEST on 2026-10-16, because `lockf` creates it on first use). The old path under the scratchpad of session `3039b12d-...` belonged to a finished session. A session's own scratchpad gives a different path, and two lock files let two runs overlap (see Traps in the handover).

## Reading Order

1. [handover.md](handover.md), then this file.
2. [AGENTS.md](AGENTS.md) and [docs/standards/](docs/standards/README.md).
3. [docs/product/roadmap.md](docs/product/roadmap.md), the [product grilling record](docs/discovery/2026-10-07-product-grilling.md) and the [ADRs](docs/adr/README.md).

## Loop

1. `git fetch` and read what changed in the handover files and `AGENTS.md`.
2. Claim the next unblocked issue: comment the branch, add `status:in-progress` through `kothar:project-manager`.
3. Cut a branch from `origin/main`. When Shane has said to stack a batch, cut from the branch below it. Read the issue and every file it touches.
4. Build the smallest change that meets the criteria, with its test.
5. Run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus, for desktop work, only the e2e files the story touches (`pnpm build`, then `cd e2e && lockf /private/tmp/claude-501/-Users-shanedolley-Development-personal-jira-mgr/7bf42498-7df8-4d47-81dd-d0657b1f4070/scratchpad/e2e.lock npx playwright test desktop/<file>.test.ts --workers=1`). Put that command in the first dispatch and forbid `pnpm e2e` outright: a builder whose run is killed restarts it. The full `pnpm e2e --workers=1` runs once, after the batch is developed. Read the pass and fail counts. Commit locally and have a reviewer other than the builder pass it before pushing, since a green PR may merge at once.
6. Run `/autonomous:update`, so the handover lands in the story's commit.
7. Commit with `Refs #n`. A stacked batch waits: when every story is developed and reviewed, run the full suite once on the stack tip, then push in stack order, open each pull request, and wait for CI with `gh run watch <id> --exit-status` on the run for the head (see AGENTS.md). After each squash merge, rebase the next branch with `git rebase --onto origin/main <old tip of the branch below>`, using the hash, not the branch name.
8. On green CI with a PASS verdict newer than the head, merge with `gh pr merge <n> --squash` without waiting for Shane. ship-it sometimes merges first and posts a "Merge already in progress" failure after our merge succeeded (#240, #241, #243): check `gh pr view <n> --json state` and ignore the notice. Confirm MERGED, then clean up the branch.
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
