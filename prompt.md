# Prompt

## Start Here

Measured 2026-10-10 from `gh issue list --state open --limit 200` (6 open issues, one page), `gh pr list --state open` and `gh api repos/shanedolley/jira-mgr/issues/<n>/dependencies/blocked_by` for each. D4 is done (#31 closed). Work in order:

1. **#84**: PR #93 merged as e91c265. Have `kothar:project-manager` move it once its criteria proof is on the issue.
2. **Desktop D12 (#85), draft PR #88**: it carries the date double-commit fix (Refs #30), which passed review. Once it is rebased onto `main` and CI is green, mark it ready and merge it by hand.
3. **Desktop D13 (#86), draft PR #94**: the SSRF fix passed re-review; after the small Lows and the rebase, mark it ready, get CI green, merge by hand, then move #86 to `status:hil-review` through `kothar:project-manager`.
4. **Desktop D5 activity (#32)**, In Progress in worktree `jira-mgr-d5` on `d5-activity` (builder 32-d5-build, design doc 0004 first), built to Shane's attachments spec on the issue. Then **D9 timer (#36)**, blocked by #32, and **D11 click-to-edit summary (#83)**, unblocked; D11 touches `IssuePage` and `SummaryEditor.tsx`, so build it in a worktree of its own after D5 merges.
5. **Nothing waits on Shane** (#31 and #33 are closed). Stop and report once the rest is done or blocked.

Run e2e on one worker and never in several worktrees at once (see Traps in the handover).

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
8. On green CI the ship-it automation sometimes merges; do not race it with `gh pr merge`. It did not merge #89, #90 or #91 (2026-10-10), so if a green PR is still open after about 10 minutes, merge it with `gh pr merge <n> --squash`. Confirm MERGED, then clean up the branch.
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
