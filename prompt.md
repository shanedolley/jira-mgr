# Prompt

## Start Here

**Focus: keep documentation up to date and remove stale references** (Shane's focus for the 2026-10-14 run). Item 1 below says how; do it in every pull request.

Six issues are open (`gh issue list --state open --limit 200`, 2026-10-15): #217, #219, #223, #224, #237 and #238. #217 is merged and waits on Shane in HIL Review with `question` (whether "On Hold" also matches); #216, #220, #221 and #222 are approved and closed. #219 and #223 are In Progress in `../jira-mgr-219` and `../jira-mgr-223`, rebased onto `origin/main` with clean trees at 22:15 AEST on 2026-10-15, nothing pushed, and builders `219-create-dates-finish` and `223-manual-order-finish` are finishing them; [handover.md](handover.md) "Open Stories" gives each branch and next step. Three Dependabot pull requests are the only open ones (`gh pr list --state open`, 2026-10-15). Land the stories one pull request at a time, rebasing each branch onto `origin/main` before pushing, in this order:

- #219 first, in `../jira-mgr-219` (`219-create-dates`). It blocks #224, #237 and #238 (issue bodies only). Next: its gates and the e2e files it touches, a re-review of the finished fix (Cmd+Enter with a half-typed date) by a reviewer other than the builder. Do not push.
- #223 in parallel, on its own branch from main in `../jira-mgr-223`. Next: rebase, gates, targeted e2e, review. Do not push.
- Then the stack, one story at a time (Shane, 2026-10-15: "stack them, merge after the final e2e run"): #224 branches from `219-create-dates`, #237 from #224's branch, #238 from #237's. Claim each when the one below it is built and reviewed.
- Full local e2e runs once, after #219, #223, #224, #237 and #238 are all developed and reviewed, on an integration of all five (Shane: "please wait to run the e2e test suites until all issues are developed. the tests take a long time"). Until then builders run only the e2e files their story touches: `pnpm build`, then `cd e2e && lockf /private/tmp/claude-501/-Users-shanedolley-Development-personal-jira-mgr/7bf42498-7df8-4d47-81dd-d0657b1f4070/scratchpad/e2e.lock npx playwright test desktop/<file>.test.ts --workers=1`. Put that command in the first dispatch: builders restarted a killed `pnpm e2e` twice before reading the change on 2026-10-15.
- Nothing is pushed or merged until the full suite passes on the integration. Then push, open the pull requests and merge in stack order (#219, #224, #237, #238; #223 anywhere), each on its own green CI and a PASS verdict newer than its head, rebasing the next branch onto `origin/main` after each merge.
- Dependabot: #234 (the minor and patch group, green) may merge once a review verdict is posted. #235 (@eslint/js 10) and #236 (msw 3) are major bumps and fail CI; do not merge either alone (see Not Alone and the Open Decisions in the handover).

CI runs on 2 workers. The test command is `pnpm test`, plus, for desktop work, only the e2e files the story touches until the final run (see above), and `pnpm e2e --workers=1` for the final run. No database exists: Jira is reached live only through `jm` and the app, and tests never write to it. [handover.md](handover.md) holds the state, the decisions and the traps.

1. **Keep the documentation current and remove stale references in every pull request.** Shane asked for this explicitly and restated it on 2026-10-13. Check closed issues named as open and features named as planned or not built in `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` (except dated discovery records) and each package README; check each file name and script a doc names against `git ls-files` and `package.json`; compare the `e2e/README.md` suite table with `e2e/desktop/` and the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src`; run a link and anchor check over every tracked `.md` file; run `pnpm docs:reference` and confirm no drift. Look for text describing Collapse all or Expand all, session-only collapse, the old #209 filter rule, `xvfb-run` instructions, or status-first ordering under Key (changed by #222). Last swept 2026-10-14 at main 70865c6 and a1d7313 (the orchestrator's focus of that date), and re-measured in part on 2026-10-15 at main 83b6819: 91 tracked `.md` files and 407 relative links outside code, none broken (a `python3 -I` script over `git ls-files`; the 408 of 2026-10-14 came from a different pattern); every `e2e/desktop/*.test.ts` is named in `e2e/README.md`; every non-test file under `apps/desktop/src` is named in the `apps/desktop/README.md` file table. `pnpm docs:reference` drift was last checked under Node 24 on 2026-10-14 at a1d7313 (`git status` clean after the run) and is unverified since then at 83b6819; run it. Every backticked file path and `pnpm` script in the docs existed or was runtime state (`settings.json`, `views.json`, `timer.json`, `inbox.json`, `fields.json`), build output or an example on 2026-10-14. The sweep added #220 to the README and the roadmap, and replaced "bulk select is not built" in the palette paragraph of `apps/desktop/README.md` (#143 built the bulk bar). It found no text on Collapse all or Expand all outside dated discovery records and `CONTEXT.md` line 40, where "collapse all" is an alias to avoid; session-only collapse appears only as the struck-through row and the replacement note in design 0002 (lines 403 and 424). It found no `xvfb-run` instructions or status-first Key ordering, and no Time left in hours (`Time remaining (h)` is Jira's field name; the CLI keeps `--time-remaining` in hours). A story that changes behaviour a doc describes updates that doc in its own PR.
2. **Each story touching UI goes to HIL Review** after merge, per Loop step 9. Name in the comment the orchestrator's decisions Shane has not confirmed: #223's Manual ordering rules, #224's hover-wins rule, #237's desktop-only default and late-loading user, and #238's menu scope and Copy seeding.
3. Do not build gap 13 (undecided) or gap 14 (Later).

Run e2e with `pnpm e2e --workers=1`, serialised across worktrees with `lockf <lock file> pnpm e2e --workers=1`. The lock file is the one the running agents already use, `/private/tmp/claude-501/-Users-shanedolley-Development-personal-jira-mgr/7bf42498-7df8-4d47-81dd-d0657b1f4070/scratchpad/e2e.lock` (checked 2026-10-15). The old path under the scratchpad of session `3039b12d-...` belonged to a finished session. A session's own scratchpad gives a different path, and two lock files let two runs overlap (see Traps in the handover).

## Reading Order

1. [handover.md](handover.md), then this file.
2. [AGENTS.md](AGENTS.md) and [docs/standards/](docs/standards/README.md).
3. [docs/product/roadmap.md](docs/product/roadmap.md), the [product grilling record](docs/discovery/2026-10-07-product-grilling.md) and the [ADRs](docs/adr/README.md).

## Loop

1. `git fetch` and read what changed in the handover files and `AGENTS.md`.
2. Claim the next unblocked issue: comment the branch, add `status:in-progress` through `kothar:project-manager`.
3. Cut a branch from `origin/main`, or from the branch below it in the stack (#224, #237, #238). Read the issue and every file it touches.
4. Build the smallest change that meets the criteria, with its test.
5. Run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus, for desktop work, only the e2e files the story touches (`pnpm build`, then `cd e2e && lockf /private/tmp/claude-501/-Users-shanedolley-Development-personal-jira-mgr/7bf42498-7df8-4d47-81dd-d0657b1f4070/scratchpad/e2e.lock npx playwright test desktop/<file>.test.ts --workers=1`); the full `pnpm e2e --workers=1` runs once, on the integration of the five stories. Read the pass and fail counts. Commit locally and have a reviewer other than the builder pass it before pushing, since a green PR may merge at once.
6. Run `/autonomous:update`, so the handover lands in the story's commit.
7. Commit with `Refs #n` and stop: nothing is pushed until the final full e2e run passes on the integration of #219, #223, #224, #237 and #238. Then push in stack order, open each pull request, and wait for CI with `gh run watch <id> --exit-status` on the run for the head (see AGENTS.md).
8. On green CI the ship-it automation sometimes merges; do not race it with `gh pr merge`. It left #88 to #95 and #98 alone on 2026-10-10 but merged #154, so if a green PR with a review PASS is still open, merge it with `gh pr merge <n> --squash`. Confirm MERGED, then clean up the branch.
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
