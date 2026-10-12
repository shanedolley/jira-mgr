# Prompt

## Start Here

Measured 2026-10-12 (head `e595ef0`: `git log --oneline -1 origin/main`; main CI run 38187354069 succeeded). The one open issue is #143 (`gh issue list --state open --limit 200`). The test command is `pnpm test`, plus `pnpm e2e --workers=1` for desktop work. No database exists: Jira is reached live only through `jm` and the app, and tests never write to it. [handover.md](handover.md) holds the state, the decisions and the traps. Pull requests land one at a time.

1. **Keep the documentation current and remove stale references in every pull request.** Shane asked for this explicitly and restated it on 2026-10-12. Before opening the PR, grep `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` (except dated discovery records) and each package README for closed issues named as open and features named as planned or not built. Check each file name and script a doc names against `git ls-files` and `package.json`. Compare the `e2e/README.md` suite table with `e2e/desktop/` and the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src` (the table names files by basename). Run a link and anchor check over every tracked `.md` file (a script that resolves each relative link and each `#anchor` against the target's headings). Run `pnpm docs:reference` and confirm `git status` shows no drift. Never edit an accepted ADR; flag a stale one in the PR. Last swept 2026-10-12 ([#192](https://github.com/shanedolley/jira-mgr/pull/192)): 90 tracked `.md` files and 402 relative links, 0 broken.
2. **#143 PR 2, desktop,** on `143-bulk-desktop` (PR 1 merged as #194). Built, docs swept, reviewed PASS by 143-desktop-review (fixes in the follow-up commit re-reviewed PASS), 2026-10-12. Push, open the pull request, watch CI, and merge on green with the PASS verdict. Then post the M3 question on #143 (a bulk move to Done under Hide done empties the selection, against Shane's "the selection stays" answer), add `question`, and have `kothar:project-manager` move #143 to `status:hil-review`. If the PR is already merged, start from the question.
3. **Check the board.** Run `gh issue list --state open --limit 200`. If a new issue or a `question` answer appears, claim it per Loop. Each user-visible desktop change goes to Shane through `status:hil-review`. Do not build gap 13 (undecided) or gap 14 (Later).

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
