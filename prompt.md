# Prompt

## Start Here

Measured 2026-10-11 (head: `git log --oneline -1 origin/main`, 91dd70a when checked, the #141 merge; main CI run 38099835278 succeeded). 26 issues are open, the filed review stories #126 to #151 (`gh issue list --state open --limit 200`): 18 in HIL Review, #137 built in PR #174 and awaiting its move out of in progress, 7 not started. Work in this order, landing one pull request at a time:

1. **Keep the docs current and remove stale references.** Shane asked for this explicitly. Fix any stale reference you meet in the pull request that changes the code. For a docs-only pass, grep `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` and each package README for closed issues named as open and for features named as planned, check each file name and script against the code, compare the `e2e/README.md` suite table with `e2e/desktop/`, compare the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src`, and run a link check over all markdown. Last swept 2026-10-11 (this pull request): 0 broken relative links or anchors over 90 tracked `.md` files, generated references current.
2. **#141 and #137 are done** (PRs #173 and #174, review PASS; both wait on Shane, see Open Decisions).
3. **Next is #145 alone** (add sub-issues from the issue page; its only open blocker, #137, is in HIL Review: satisfied). Every other open story is parked or blocked: #131, #139, #146 and #148 wait on a question, and #138, #143, #144, #149, #150 and #151 wait behind #131 or #138 (#151 also needs #132). Open blockers measured 2026-10-11 for all 26 issues with `gh api repos/shanedolley/jira-mgr/issues/<n>/dependencies/blocked_by --jq '[.[]|select(.state=="open")|.number]'`. Each user-visible desktop change goes to HIL Review for Shane. Do not build gap 13 (undecided) or gap 14 (Later). Start the next session by checking for Shane's answers (the `question` label) and new issues.
4. **Parked, do not build.** Waiting on Shane's answers (no answer to any by 2026-10-11, see Open Decisions in the handover): #131, #139, #146 and #148 sit in HIL Review with `question` before any build, because each needs a decision on a public contract or a design. #131 also blocks #138, #143, #149 and #151 (with their other blockers; #151 also needs #132), and #138 blocks #143, #144 and #150, so #144 and #150 wait behind it too. #143 also needs Shane present for one live bulk write on a throwaway PSAPAC issue. #139 builds as soon as he answers; #146 and #148 block nothing. Built and waiting on his sign-off and answers: #128, #134, #135, #136, #137, #140, #141, #142 and #147. Remove `question` when he answers.
5. **Check the board.** Run `gh issue list --state open --limit 200`. If a new issue appears, claim it per Loop.

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
