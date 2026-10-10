# Prompt

## Start Here

Measured 2026-10-11 (head: `git log --oneline -1 origin/main`, 4fe0ad0 when checked, the #165 merge of #128; main CI run 38078087438 succeeded). 26 issues are open, the filed review stories #126 to #151 (`gh issue list --state open --limit 200`). #147 is in its pull request. Claimed and in progress, so do not claim them again: #130 (worktree `jira-mgr-130`), #140 (worktree `jira-mgr-140`) and #147 (worktree `jira-mgr-147`). #126, #127, #128, #129, #132, #133, #134, #135 and #136 are merged and in HIL Review. #131, #139, #146 and #148 are parked in HIL Review with `question`; do not build them until Shane answers (see Open Decisions in the handover; no answer by 2026-10-11). #128 also awaits his answer on the load-error copy. The docs sweep of 2026-10-11 landed in PR #162: do not repeat it. Work in this order, landing one pull request at a time:

1. **Keep the docs current.** Fix any stale reference you meet in the pull request that changes the code. For a docs-only pass, grep `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` and each package README for closed issues named as open and for features named as planned, and run a link check over all markdown. Last swept 2026-10-11 (merged in PR #162): one stale doc fixed, 0 broken relative links over every tracked `.md`, 76 external URLs unchecked, generated references current.
2. **Build the filed review stories** ([decisions](docs/discovery/2026-10-10-review-decisions.md)). Unblocked now, with no open blocker or only blockers in HIL Review (measured 2026-10-11 for #126 to #151 with `gh api repos/shanedolley/jira-mgr/issues/<n>/dependencies/blocked_by --jq '[.[]|select(.state=="open")|.number]'`): #130, #137, #140, #141, #142 and #147. #130, #140 and #147 are claimed. Next, #142 after #130 (both touch notices); #141 once #147 merges, since both edit the palette (it adds palette actions); #137 is a cross-cutting button and radius system, so build it alone and last. #142's only blocker, #133, is in HIL Review, #130 is a blocker of #143, and #137 unblocks #145. #138 also needs #131, which waits on Shane. Take the rest as their blockers close; each issue names them. A blocker merged and in HIL Review counts as satisfied (see Traps, HIL blockers stay open). Each user-visible desktop change goes to HIL Review for Shane. #143 (bulk select and edit) needs Shane present for one live bulk write on a throwaway PSAPAC issue before it relies on the bulk path. Do not build gap 13 (undecided) or gap 14 (Later).
3. **Parked decisions.** Once Shane answers, #131 unblocks #138, #143, #149 and #151 (alongside their other blockers; #151 also needs #132). #139 is free of open blockers and builds as soon as he answers it. #146 and #148 block nothing. #134, #135 and #136 are built and wait on his answers to their questions. Remove `question` when he answers.
4. **Check the board.** Run `gh issue list --state open`. If a new issue appears, claim it per Loop.

Rebase each pull request onto `main` after the one before it merges, since a green run from before the rebase proves nothing (see Traps in the handover). Run e2e with `pnpm e2e --workers=1`, and never in several worktrees at once.

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
7. Commit with `Refs #n`, push, open the pull request, watch CI with `gh pr checks <n> --watch`, and rerun it until the run for your head finishes (see Traps).
8. On green CI the ship-it automation sometimes merges; do not race it with `gh pr merge`. It left #88 to #95 and #98 alone on 2026-10-10 but merged #154, so if a green PR with a review PASS is still open, merge it with `gh pr merge <n> --squash`. Confirm MERGED, then clean up the branch.
9. Comment on the issue how each criterion is met, ending with `Review verdict: PASS (reviewer <agent>, builder <agent>)`. Then have `kothar:project-manager` close it as Done, unless it needs Shane's judgement: anything he sees or uses (CLI output, Desktop UI), anything touching security or credentials, and live PSAPAC checks. Those go to `status:hil-review` for Shane to close (rule adopted by Shane 2026-10-07).

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
