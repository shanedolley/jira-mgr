# Prompt

## Start Here

**Do not begin developing or building any issue yet** (Shane, 2026-10-17). Claim nothing, cut no branch and dispatch no builder until Shane says go. Keep the documentation current meanwhile (item 1 below).

Checked 2026-10-17, 14:56 AEST. Main is at 5f8c85f, whose CI run 38842255821 succeeded (`gh run view 38842255821 --json headSha,conclusion`). Three issues are open, all in To Do with no status label: #217, #254 and #255 (`gh issue list --state open --limit 300`). Two pull requests are open, the Dependabot majors #235 and #236 (`gh pr list --state open`); both fail `checks`. Shane closed #219, #223, #224, #237 and #238 on 2026-10-17, which approved the orchestrator's choices on them. [handover.md](handover.md) "Open Stories" gives each open story's state and the choices Shane has not confirmed.

Once Shane says go, take them in this order. It is the orchestrator's suggestion, not Shane's priority:

- **#217 rework.** Shane's comment of 2026-10-17: reduce the opacity of every field a Hold row can show on the canvas, the issue number and the avatar icon included. It blocks nothing; it is his open ask. Confirm with him which fields "ALL" covers if the issue leaves it open.
- **#254**, the Original estimate, Logged, Remaining and Remaining % Display properties. Read the issue body's Decisions, which Shane has not confirmed. Changing the allowed `display.properties` values is an Ask First item that his request covers.
- **#255**, the Vite+ spike: a report and an ADR; the trial runs on a throwaway branch that never merges, and the report and the ADR reach main through their own docs pull request. Adoption work needs his approval of the new dependencies.
- **The Dependabot majors #235 (@eslint/js 10) and #236 (msw 3)**, not merged alone (see Not Alone and the Open Decisions in the handover). #255 may make #235 moot. #236's e2e failure was the #249 race, and a rebase should clear it (a prediction); its typecheck failure (`onUnhandledRequest`) remains. The minor and patch group landed as #247 (abb3b60) on 2026-10-15.

Do not run `pnpm e2e` for a story. Shane's rules of 2026-10-15: builders run only their story's e2e files; the full local suite runs once, after a batch is developed (one agent, `lockf`, one worker, read the counts); stories stack and merge after that run; a pull request merges without waiting for Shane once CI and the review verdict pass, as he reviews in the morning.

CI runs on 2 workers. The test command is `pnpm test`, plus, for desktop work, only the e2e files the story touches, and `pnpm e2e --workers=1` once per batch (see above). No database exists: Jira is reached live only through `jm` and the app, and tests never write to it. [handover.md](handover.md) holds the state, the decisions and the traps.

1. **Keep the documentation current and remove stale references in every pull request.** Shane asked for this explicitly and restated it on 2026-10-13. Check closed issues named as open and features named as planned or not built in `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` (except dated discovery records) and each package README; check each file name and script a doc names against `git ls-files` and `package.json`; compare the `e2e/README.md` suite table with `e2e/desktop/` and the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src`; run a link and anchor check over every tracked `.md` file; run `pnpm docs:reference` and confirm no drift. Look for text describing Collapse all or Expand all, session-only collapse, the old #209 filter rule, `xvfb-run` instructions, or status-first ordering under Key (changed by #222). Last swept 2026-10-16 at main 8fd6c2c (merged as 1164a6a, #252), over every tracked `.md` file outside `docs/discovery` and accepted ADRs: 91 tracked `.md` files, 79 outside `docs/discovery`, and 274 relative links in those 79 outside code spans and fences (409 over all 91; the links added since make 276 and 411), anchors included, none broken (a `python3 -I` script over `git ls-files '*.md'` in the session scratchpad; the counts match the abb3b60 sweep earlier that day). Every `e2e/desktop/*.test.ts` (32) is named in `e2e/README.md` and every test file it names exists; every non-test file under `apps/desktop/src` is named in the `apps/desktop/README.md` file table, some in grouped rows, and every `src/` path the table names exists; `pnpm docs:reference` under Node 24 left `git status` clean. Every backticked file path in the docs existed, or was runtime state (`settings.json`, `views.json`, `timer.json`, `inbox.json`, `fields.json`), build output, an example, or a file a doc says is not built or not yet needed (`docs/reference/core.md`, `turbo.json`), and every `pnpm` script a doc names is in `package.json`. Searches for Collapse all or Expand all, session-only collapse, `xvfb-run`, a red or dotted Hold ring and status-first ordering found no stale text outside dated records (`CONTEXT.md` line 40 keeps "collapse all" as an alias to avoid; design 0002 line 442 records the replaced session-only collapse; `e2e/README.md` says no `xvfb-run` is needed). The "not built" lines (burndown, a Customer's own page, attachment removal, Jira change history) match the code. The sweep changed three docs: `docs/how-to/install-desktop-app.md` gained the section "Share with Another Mac" (the signing and notarising recipe, used once on 2026-10-16), `docs/how-to/README.md` indexes it, and the handover points to it. Every other doc still says the build is unsigned, which stays true of `pnpm package`. A story that changes behaviour a doc describes updates that doc in its own PR.
2. **Each story touching UI goes to HIL Review** after merge, per Loop step 9. Name in the comment the orchestrator's choices Shane has not confirmed and add `question`. Shane closed #219, #223, #224, #237 and #238 on 2026-10-17 on that footing, and closing an issue approves its listed choices.
3. Do not build gap 13 (undecided) or gap 14 (Later).

Run e2e with `pnpm e2e --workers=1`, serialised across worktrees with `lockf <lock file> pnpm e2e --workers=1`. The lock file is the shared path `/private/tmp/claude-501/-Users-shanedolley-Development-personal-jira-mgr/7bf42498-7df8-4d47-81dd-d0657b1f4070/scratchpad/e2e.lock`; it is free now (the file is absent at 14:56 AEST on 2026-10-17, because `lockf` creates it on first use, and no `lockf` process runs), and a run waits its turn when another holds it. The old path under the scratchpad of session `3039b12d-...` belonged to a finished session. A session's own scratchpad gives a different path, and two lock files let two runs overlap (see Traps in the handover).

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
