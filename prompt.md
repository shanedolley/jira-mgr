# Prompt

## Start Here

**Focus: keep documentation current and remove stale references.** Item 1 below says how; do it in every pull request.

Eight issues are open (`gh issue list --state open --limit 200`, 2026-10-14). #217 and #221 are merged and wait on Shane in HIL Review. Four stories are built and committed on local branches, one worktree each, nothing pushed; [handover.md](handover.md) "Open Stories" gives each branch, commit and next step. Resume in this order, one pull request at a time, rebasing each branch onto `origin/main` before pushing:

- #216: the builder is fixing the review's M1, L1, L3 and L4 in `../jira-mgr-216`. Then commit, rebase, open the pull request and merge.
- #219, #220 and #222: as their reviews land (all under review, 2026-10-14).
- #224 after #219 merges.
- #223 after #222 merges.

Neither #223 nor #224 is claimed. CI runs on 2 workers. The test command is `pnpm test`, plus `pnpm e2e --workers=1` for desktop work. No database exists: Jira is reached live only through `jm` and the app, and tests never write to it. [handover.md](handover.md) holds the state, the decisions and the traps.

1. **Keep the documentation current and remove stale references in every pull request.** Shane asked for this explicitly and restated it on 2026-10-13. Check closed issues named as open and features named as planned or not built in `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` (except dated discovery records) and each package README; check each file name and script a doc names against `git ls-files` and `package.json`; compare the `e2e/README.md` suite table with `e2e/desktop/` and the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src`; run a link and anchor check over every tracked `.md` file; run `pnpm docs:reference` and confirm no drift. Look for text describing Collapse all or Expand all, session-only collapse, the old #209 filter rule, or `xvfb-run` instructions. Last swept 2026-10-14 at main e26b81f: 91 tracked `.md` files and 408 relative links outside code, none broken; no drift from `pnpm docs:reference` under Node 24; the sweep fixed two design docs' Open Questions (0003, 0004) and the closed #27 references in the L7 runbook. A story that changes behaviour a doc describes updates that doc in its own PR.
2. **Each story touching UI goes to HIL Review** after merge, per Loop step 9. Name in the comment the orchestrator's decisions Shane has not confirmed: #223's Manual ordering rules, #224's hover-wins rule, and #222's per-order default direction.
3. Do not build gap 13 (undecided) or gap 14 (Later).

Run e2e with `pnpm e2e --workers=1`, serialised across worktrees with `lockf <scratchpad>/e2e.lock pnpm e2e --workers=1` (see Traps in the handover).

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
