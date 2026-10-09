# Prompt

## Start Here

Measured 2026-10-10 from `gh issue list --state open --limit 200` (6 open issues, one page), `gh pr list --state open` and `gh api repos/shanedolley/jira-mgr/issues/<n>/dependencies/blocked_by` for each. The focus is documentation: keep it current, and remove every stale reference (branch names that are gone, features listed as planned that exist, wrong counts, dead links) in the pull request that changes the code. Work in order:

1. **Land #94 (D13 profile images, #86)**: ready, security review and delta review passed, rebased onto the D12 merge. Wait for CI on the rebased head, merge by hand, then have `kothar:project-manager` move #86 to `status:hil-review`. Leave `apps/desktop/README.md` avatar text to this pull request.
2. **Review and open the pull request for D5 activity (#32)** from `d5-activity` (worktree `jira-mgr-d5`, pushed, no pull request; review by 32-d5-review). Rebase it onto `main` first. It carries design doc 0004 and the README text for D5, so its docs land with it. Two criteria stay unproven until Shane is present: an image embedded in a comment rendering in live Jira (one reversible live write) and the real native save dialog (one manual `pnpm dev` check).
3. **Land the e2e flake fixes** from `fix-e2e-flakes-1010` (local only, worktree `jira-mgr-flakes`; review by flakes-review): the `views.test.ts` ENOENT race and the `AdfEditor` caret bug at `editor.test.ts:562`. Push, open the pull request, merge on green. Then fix `shell.test.ts:101` once its cause is known, and update the "Flaky e2e tests" trap.
4. **The out-of-order edit bug**: two quick edits to one field can reach Jira out of order (`optimistic.ts`). Find it with `gh issue list --label bug --state open`; it had no issue number at the last check.
5. **D9 timer (#36)**, blocked by #32: start it once D5 merges.
6. **D11 click-to-edit summary (#83)**, unblocked: build it in a worktree of its own after D5 merges, since it touches `IssuePage` and `SummaryEditor.tsx`.
7. **Waiting on Shane** (he closes issues carrying `status:hil-review`; check `gh issue list --label status:hil-review`): #84, the late-automation toast, is there now; #85 (D12, merged in #88) goes there once its criteria proof is posted; #86 follows #94. The two D5 live checks need him present.

Merge one pull request at a time and rebase the next onto `main` before its CI result counts (see Traps in the handover). Run e2e on one worker and never in several worktrees at once.

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
8. On green CI the ship-it automation sometimes merges; do not race it with `gh pr merge`. It did not merge any pull request on 2026-10-10 (#88 to #95), so if a green PR is still open after about 10 minutes, merge it with `gh pr merge <n> --squash`. Confirm MERGED, then clean up the branch.
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
