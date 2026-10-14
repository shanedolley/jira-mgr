# Prompt

## Start Here

**Focus: keep documentation up to date and remove stale references** (Shane's focus for the 2026-10-14 run). Item 1 below says how; do it in every pull request.

Eight issues are open (`gh issue list --state open --limit 200`, 2026-10-14). #217, #220, #221 and #222 are merged and wait on Shane in HIL Review (#220 is PR #231). #216's pull request opens with this handover. #219 is committed on a local branch, nothing pushed, and #223 is in build; [handover.md](handover.md) "Open Stories" gives each branch, commit and next step. No other pull request was open when this was written (`gh pr list --state open`, 2026-10-14). Land the stories one pull request at a time, rebasing each branch onto `origin/main` before pushing:

- #216: pull request open, awaiting CI and merge (branch `216-log-work`, ffd07d8 before this handover). Watch CI on the run for the head, confirm a PASS verdict newer than the head, merge, then comment on the issue and have `kothar:project-manager` move it to HIL Review (Desktop UI).
- #219: committed as b76cc29 and ca735a5 in `../jira-mgr-219`, rebased onto a1d7313. Get the e2e result and a re-review of ca735a5 by a reviewer other than the builder, rebase onto `origin/main`, open the pull request and merge.
- #223: claimed, in build in `../jira-mgr-223` (`223-manual-order`, commit 013d6a6, cut from 142e11c, builder `223-manual-order-build` running its e2e). Rebase onto `origin/main` before the pull request.
- #224 after #219 merges. It is not claimed.

CI runs on 2 workers. The test command is `pnpm test`, plus `pnpm e2e --workers=1` for desktop work. No database exists: Jira is reached live only through `jm` and the app, and tests never write to it. [handover.md](handover.md) holds the state, the decisions and the traps.

1. **Keep the documentation current and remove stale references in every pull request.** Shane asked for this explicitly and restated it on 2026-10-13. Check closed issues named as open and features named as planned or not built in `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` (except dated discovery records) and each package README; check each file name and script a doc names against `git ls-files` and `package.json`; compare the `e2e/README.md` suite table with `e2e/desktop/` and the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src`; run a link and anchor check over every tracked `.md` file; run `pnpm docs:reference` and confirm no drift. Look for text describing Collapse all or Expand all, session-only collapse, the old #209 filter rule, `xvfb-run` instructions, or status-first ordering under Key (changed by #222). Last swept 2026-10-14 at main 70865c6, and again at a1d7313 over the files #216 changes (the orchestrator's focus of that date): 91 tracked `.md` files and 408 relative links outside code, none broken (a `python3 -I` script over `git ls-files`); no drift from `pnpm docs:reference` under Node 24 (`git status` clean after the run); every `e2e/desktop/*.test.ts` named in `e2e/README.md` and every test the README names tracked; every `apps/desktop/src` file named in the `apps/desktop/README.md` file table, once the sweep added a row for `index.html` and `env.d.ts`; every backticked file path and `pnpm` script in the docs exists or is runtime state (`settings.json`, `views.json`, `timer.json`, `inbox.json`, `fields.json`), build output or an example. The sweep added #220 to the README and the roadmap, and replaced "bulk select is not built" in the palette paragraph of `apps/desktop/README.md` (#143 built the bulk bar). It found no text on Collapse all or Expand all outside dated discovery records and `CONTEXT.md` line 40, where "collapse all" is an alias to avoid; session-only collapse appears only as the struck-through row and the replacement note in design 0002 (lines 403 and 424). It found no `xvfb-run` instructions or status-first Key ordering, and no Time left in hours (`Time remaining (h)` is Jira's field name; the CLI keeps `--time-remaining` in hours). At a1d7313, over the files #216 changes, the 408 links in 91 files are still unbroken, `pnpm docs:reference` leaves no drift, every `apps/desktop/src` file is named in the file table (`images.ts`, `fileDrag.ts`, `ImageView.tsx`, `loadErrorCopy.ts`, `ReadOnlyInline.tsx` and `uploads.ts` share cells with other files), and the `index.html` row now states the `style-src` rule. A story that changes behaviour a doc describes updates that doc in its own PR.
2. **Each story touching UI goes to HIL Review** after merge, per Loop step 9. Name in the comment the orchestrator's decisions Shane has not confirmed: #223's Manual ordering rules and #224's hover-wins rule. (#222's per-order default direction is named on its issue already.)
3. Do not build gap 13 (undecided) or gap 14 (Later).

Run e2e with `pnpm e2e --workers=1`, serialised across worktrees with `lockf <lock file> pnpm e2e --workers=1`. The lock file is the one the running agents already use, `/private/tmp/claude-501/-Users-shanedolley-Development-personal-jira-mgr/3039b12d-bdd4-4103-be3c-d6d2847ec132/scratchpad/e2e.lock`. A session's own scratchpad gives a different path, and two lock files let two runs overlap (see Traps in the handover).

## Reading Order

1. [handover.md](handover.md), then this file.
2. [AGENTS.md](AGENTS.md) and [docs/standards/](docs/standards/README.md).
3. [docs/product/roadmap.md](docs/product/roadmap.md), the [product grilling record](docs/discovery/2026-10-07-product-grilling.md) and the [ADRs](docs/adr/README.md).

## Loop

1. `git fetch` and read what changed in the handover files and `AGENTS.md`.
2. Claim the next unblocked issue: comment the branch, add `status:in-progress` through `kothar:project-manager`.
3. Cut a branch from `origin/main`. Read the issue and every file it touches.
4. Build the smallest change that meets the criteria, with its test.
5. Run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus `pnpm e2e` for desktop work. Read the pass and fail counts. Commit locally and have a reviewer other than the builder pass it before pushing, since a green PR may merge at once.
6. Run `/autonomous:update`, so the handover lands in the story's commit.
7. Commit with `Refs #n`, push, open the pull request, and wait for CI with `gh run watch <id> --exit-status` on the run for your head (see AGENTS.md).
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
