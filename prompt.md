# Prompt

## Start Here

Measured 2026-10-08 by reading open issues' blockers (`gh api repos/shanedolley/jira-mgr/issues/<n>/dependencies/blocked_by`) and `gh issue list --state open --limit 200`. #21 to #26 are closed. L7 (#27) ran with Shane on 2026-10-08. Work in order:

1. **Shane's HIL review of #27, #60 and #61, and his open decision on #27.** #27 is in HIL Review (runbook merged in #62). #60 is merged in PR #63 (516669f) and in HIL Review. #61 is fixed on branch `fix-cli-output-polish` (one full stop after Jira's quoted message; an empty worklog comment reads `null`) and awaits review. The decision is whether `jm issue create` reads the new issue back ([comment on #27](https://github.com/shanedolley/jira-mgr/issues/27#issuecomment-6048998036)). Nothing else to build on these.
2. **Desktop D1 (#28)** once Shane closes #27. Write D2's and D4's design docs before their code.

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
8. On green CI the ship-it automation usually merges; do not race it with `gh pr merge`. If a green PR is still open after about 10 minutes, merge it with `gh pr merge <n> --squash`. Confirm MERGED, then clean up the branch.
9. Comment on the issue how each criterion is met, ending with `Review verdict: PASS (reviewer <agent>, builder <agent>)`. Then have `kothar:project-manager` close it as Done, unless it needs Shane's judgement: anything he sees or uses (CLI output, Desktop UI), anything touching security or credentials, and live PSAPAC checks. Those go to `status:hil-review` for Shane to close (rule adopted by Shane 2026-10-07).

## Decision Format

Comment on the issue: the question, each option with its cost and what it buys, a recommendation with its reason, and what happens on each answer. Then have `kothar:project-manager` set `status:hil-review`.

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
- `writing-clearly-and-concisely` rules for every doc, commit and comment.
