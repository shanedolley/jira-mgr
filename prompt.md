# Prompt

## Start Here

Measured 2026-10-11T08:26Z (head: `git log --oneline -1 origin/main`, 36f8484 when checked, #149 in PR #182; main CI run 38124040687 succeeded). 14 issues are open (`gh issue list --state open --limit 200`), 56 closed. No pull request is open until #146's opens. Shane's 02:00Z answers stand; #131, #138 and #145 carry `question`, and #128, #139, #142, #147, #148 and #149 sit in HIL Review. Pull requests land one at a time, each branch rebased onto `main` after the one before merges, and the handover update rides in each story's PR. Work in this order:

1. **Keep the documentation current and remove stale references in each story's pull request.** Shane asked for this explicitly. Before opening the PR, grep `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` (except dated discovery records) and each package README for closed issues named as open and features named as planned or not built; check each file name and script a doc names against `git ls-files`; compare the `e2e/README.md` suite table with `e2e/desktop/` and the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src`; run a link and anchor check over all markdown; run `pnpm docs:reference` and confirm `git status` shows no drift. Last swept 2026-10-11 (PR for #172): 0 broken relative links or anchors over 90 tracked `.md` files, generated references current.
2. **Merge #146** (this PR; PASS on 3ac4c07, rebased onto 36f8484). A post-merge review of #149's Shell merge is running (149-sprint-review).
3. **Then #151** (narrow windows, cross-cutting layout). #146 carries five starters (keeping "Created by me") and 6px tabs for Shane at HIL.
4. **#138 is parked** for Shane's decision on where row properties persist (`question` and `status:hil-review`, [decision comment](https://github.com/shanedolley/jira-mgr/issues/138#issuecomment-6105719143)); do not build it. #144, #150 and #143 stay behind it. **#143 last**, needing Shane present for one live bulk write on a throwaway PSAPAC issue. Open blockers measured 2026-10-11T08:26Z for all 14 open issues with `gh api repos/shanedolley/jira-mgr/issues/<n>/dependencies/blocked_by --jq '[.[]|select(.state=="open")|.number]'`: #138 by #131; #143 by #131 and #138; #144 and #150 by #138; #149 and #151 by #131 (satisfied under the HIL blockers trap); the rest none. Do not build gap 13 (undecided) or gap 14 (Later).
5. **Check the board.** Run `gh issue list --state open --limit 200`. If a new issue or a `question` answer appears, claim it per Loop. Each user-visible desktop change goes to Shane through `status:hil-review`.

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
