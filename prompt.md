# Prompt

## Start Here

Measured 2026-10-10 from `gh issue list --state open --limit 200` (9 open issues, one page), `gh pr list --state open` (#99, this update, and #104, D5) and `gh api repos/shanedolley/jira-mgr/issues/<n>/dependencies/blocked_by` for each. The focus is documentation: keep it current, and remove every stale reference (branch names that are gone, features listed as planned that exist, wrong counts, dead links) in the pull request that changes the code. Work in order, landing one pull request at a time:

1. **Land D5 activity (#32), PR #104** from `d5-activity` (worktree `jira-mgr-d5`). The delta review passed at 7660685; the builder is rebasing onto `main`. It carries design doc 0004 and the README text for D5, so its docs land with it.
2. **Then, unblocked by D5:** D9 timer (#36) and the D5 follow-ups (#102). **Unblocked now:** D11 click-to-edit summary (#83), built in a worktree of its own after D5 merges since it touches `IssuePage` and `SummaryEditor.tsx`, and the planned docs pages (#101).
3. **Waiting on Shane** (he closes issues carrying `status:hil-review`; check `gh issue list --label status:hil-review`): #84 (late-automation toast), #85 (D12 icons), #86 (D13 profile images) and #96 (ordered edits, fixed by #100). The two D5 live checks need him present: an image embedded in a comment rendering in live Jira, and the real native save dialog.

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
7. Commit with `Refs #n`, push, open the pull request, watch CI with `gh pr checks <n> --watch`.
8. On green CI the ship-it automation sometimes merges; do not race it with `gh pr merge`. It did not merge any pull request on 2026-10-10 (#88 to #95 and #98), so if a green PR with a review PASS is still open, merge it with `gh pr merge <n> --squash`. Confirm MERGED, then clean up the branch.
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
