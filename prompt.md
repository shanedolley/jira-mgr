# Prompt

## Start Here

Measured 2026-10-07: no issues exist, so no story is claimable yet.

1. Get Shane's approval of the roadmap pull request (`gh pr list --head plan-roadmap`), then merge it on green CI.
2. Create milestones Core, CLI and Desktop, the status labels, and one issue per roadmap row, each with the row's "Done when" as acceptance criteria and its "Needs" as blockers.
3. Build, in order: **C1** test harness and **C2** state files (no blockers, can run in parallel), then **C9** ADF and Markdown (needs C1) and **C3** credentials (needs C2).
4. Fix the Dependabot `pr-title` trap in [handover.md](handover.md) in its own small pull request.

## Reading Order

1. [handover.md](handover.md), then this file.
2. [AGENTS.md](AGENTS.md) and [docs/standards/](docs/standards/README.md).
3. [docs/product/roadmap.md](docs/product/roadmap.md), the [product grilling record](docs/discovery/2026-10-07-product-grilling.md) and the [ADRs](docs/adr/README.md).

## Loop

1. `git fetch` and read what changed in the handover files and `AGENTS.md`.
2. Claim the next unblocked issue: comment the branch, add `status:in-progress` through `kothar:project-manager`.
3. Cut a branch from `origin/main`. Read the issue and every file it touches.
4. Build the smallest change that meets the criteria, with its test.
5. Run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus `pnpm e2e` for desktop work. Read the pass and fail counts.
6. Run `/autonomous:update`, so the handover lands in the story's commit.
7. Commit with `Refs #n`, push, open the pull request, watch CI with `gh pr checks <n> --watch`.
8. On green CI, merge (Shane's standing rule in his global instructions), then clean up the branch.
9. Comment on the issue how each criterion is met; have `kothar:project-manager` set `status:ai-review`.

## Decision Format

Comment on the issue: the question, each option with its cost and what it buys, a recommendation with its reason, and what happens on each answer. Then have `kothar:project-manager` set `status:hil-review`.

## Not Alone

- Any write to live Jira (PSAPAC): creating, editing, transitioning or deleting issues, comments, worklogs, links or attachments. Tests never write. L7's live smoke check needs Shane present.
- Merging a Dependabot major version bump.
- Code signing, notarisation, or anything that costs money.
- Changing an accepted ADR's decision; write a new ADR instead.

## Skills

- `verification-before-completion` before claiming any criterion met.
- `architecture-decisions` for a decision that is hard to reverse, surprising and a real trade-off.
- Design docs for L1, D2 and D4 from `docs/templates/design-doc.md`, before their code.
- `impeccable` and `frontend-design` for Desktop UI work.
- `writing-clearly-and-concisely` rules for every doc, commit and comment.
