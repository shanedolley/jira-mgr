# Prompt

## Start Here

Measured 2026-10-12 (head: `git log --oneline -1 origin/main`, 5aaa789 when checked, #144 in PR #188; its main CI run 38155381663 succeeded, as did 38150098624 on af9a5e2; confirm a run with `gh run view <id> --json headSha,conclusion`). 6 issues are open (`gh issue list --state open --limit 200`) before this PR merges, 65 closed. Nothing carries `question`; #138, #184 and #144 are in HIL Review, and #150 is in this PR. Shane's answers are under Open Decisions in the handover. Pull requests land one at a time, each branch rebased onto `main` after the one before merges, and the handover update rides in each story's PR. Work in this order:

1. **Keep the documentation current and remove stale references in each story's pull request.** Shane asked for this explicitly. Before opening the PR, grep `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` (except dated discovery records) and each package README for closed issues named as open and features named as planned or not built; check each file name and script a doc names against `git ls-files`; compare the `e2e/README.md` suite table with `e2e/desktop/` and the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src`; run a link and anchor check over all markdown; run `pnpm docs:reference` and confirm `git status` shows no drift. Last swept 2026-10-12 (PR for #150): the Epics and Customers files are in the `apps/desktop/README.md` file table, which now lists every source file in `git ls-files apps/desktop/src` bar `index.html` and `env.d.ts`. The `e2e/README.md` table lists `overviews.test.ts`; generated references show no drift.
2. **Merge the pull requests in flight.** #150 (this PR, builder 150-overviews-build, review PASS) is the only one open; #151 is built in `jira-mgr-151` and rebases onto `main` after it merges.
3. **Then #143 last**, needing Shane present for one live bulk write on a throwaway PSAPAC issue. Open blockers measured 2026-10-12 with `gh api repos/shanedolley/jira-mgr/issues/<n>/dependencies/blocked_by --jq '[.[]|select(.state=="open")|.number]'`: #143 and #150 list #138, which is merged but open in HIL Review until Shane closes it; #151 none. Do not build gap 13 (undecided) or gap 14 (Later).
4. **Check the board.** Run `gh issue list --state open --limit 200`. If a new issue or a `question` answer appears, claim it per Loop. Each user-visible desktop change goes to Shane through `status:hil-review`.

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
