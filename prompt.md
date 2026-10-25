# Prompt


## Start Here

Checked 2026-10-25 17:33 AEST.

No unblocked story remains, so the standing focus comes first.

**Focus (Shane, in `/autonomous:update`): "also ensure documentation is up to date and remove any stale references".** He gave it on 2026-10-20 and has repeated it every day since, last on 2026-10-25 (03:41, 15:32 and for this refresh). The full sweep of 2026-10-25 17:14 AEST (item 1 below) found no stale line in `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` or the package READMEs, and added one pointer to `docs/product/roadmap.md`; [PR #394](https://github.com/shanedolley/jira-mgr/pull/394) carried it, and nothing else has merged since.

1. **Documentation.** "Keep the documentation current" below is the procedure; run it in every pull request. A story that changes behaviour a doc describes updates that doc in its own PR.
2. **Trunk.** `git rev-parse origin/main` prints 9e83676, the squash of PR #394 (a handover refresh and sweep, merged 2026-10-25T07:31:45Z, 17:31 AEST). `git log -1 --format=%h origin/main -- apps packages` prints 4aaaa00, the squash of [PR #386](https://github.com/shanedolley/jira-mgr/pull/386) (#384), the last behavioural code; later commits change documentation and `pnpm-workspace.yaml` only. History: `gh pr list --state all --limit 500`. After this refresh merges, main's head is its squash.
3. **#384 waits on Shane.** One issue is open, [#384](https://github.com/shanedolley/jira-mgr/issues/384) (`status:hil-review`, `question`), in HIL Review since 2026-10-25 02:43 AEST; its last comment is the move to HIL Review and Shane has not replied (`gh issue view 384 --json comments`, 17:33 AEST). Its [criteria comment](https://github.com/shanedolley/jira-mgr/issues/384#issuecomment-6386837335) names two choices he has not confirmed: the digit queue covers Priority as well as Status, and after a transitions load error a queued digit naming the current status closes the list with no write. Only Shane closes it; do not start work on it. `gh issue list --state all --limit 500 --json number,state` returned 131 issues, 130 closed. Read every page of that query before you conclude otherwise, and do not start feature work on a guess.
4. **Releases 1.0.0 and 1.0.1 are both published.** [v1.0.1](https://github.com/shanedolley/jira-mgr/releases/tag/v1.0.1) (release id 423163356, the latest) carries its zip, and the download answered HTTP 200 at 17:33 AEST. A duplicate draft (id 422796429) still exists; Shane has not said to delete it, so do not touch either release.
5. **No pull request is open** (263 in all: 257 merged, 6 closed unmerged; the highest is #394; `gh pr list --state open`). origin holds only `main`. The Oxfmt revisit has no ticket and no decision from Shane (handover Open Decisions).
6. **This refresh's worktree** is `jira-mgr-handover-1025h` on branch `handover-1025h`; remove both after its pull request merges.

State, 2026-10-25 17:33 AEST: worktrees (`git worktree list`) are the main tree on main and this refresh's `jira-mgr-handover-1025h`. The installed `/Applications/Jira Task Manager.app` and `~/Desktop/Jira Task Manager.app` are the notarised 1.0.1 build. The main tree's `node_modules` predate #351, so a run from the main tree needs `pnpm install` and the Electron dist check first. `pnpm ci:local` on main's head (a clean worktree, 17:35 AEST) printed core 1544 passed and 5 skipped, desktop 1452, CLI 611, EXIT=0. The last full e2e, on 64ed4a1 (non-markdown tree equal to main's), ran 964 tests on one worker, 962 passed, 2 skipped, 19.3m, EXIT=0 (handover Route Evidence). Load averages were 5.79, 5.13 and 4.81 (`uptime`).

Traps that cost a run lately (the handover Traps hold the full list; read them before you dispatch):

- `app.isPackaged` reads false in the packaged bundle: detect `pnpm dev` with `ELECTRON_RENDERER_URL` (`devRendererUrl()` in `apps/desktop/src/main/userData.ts`).
- `e2e/desktop/shortcuthelp.test.ts` hard-codes the shortcut row count (95), as `SHORTCUT_COUNT` does in `shortcuts.test.ts`. A story that adds or removes a `docs/reference/shortcuts.md` row runs it.
- `headerhover.test.ts:284` (fixed by PR #385) and `actions.test.ts:299` (fixed by PR #386) are resolved, so a failure at either is a new regression. Rerun any other full-run failure alone, three times, on the head and on main before you read it as one.
- Never amend, reset or rebase a pushed PR branch, and keep a PR a draft until its route is recorded: ship-it refuses a draft, so mark it ready only after the route, and expect a merge seconds after (AGENTS.md).
- `kothar:project-manager` refuses to close an issue whose merged PR shows "no checks reported" unless the PR carries `Local CI: pnpm ci:local exit 0 at <40-char head sha>` as the last line of the route comment.
- The claim-check hook refuses text citing a count the session did not print: paste `Running N tests using 1 worker`, `N passed (time)`, `N skipped` and `EXIT=` as printed, in a fenced block.
- Publish a release's draft itself (`gh release edit vx.y.z --draft=false`), never a new release, which ships with no download (1.0.1).
- BSD sed ignores `\b`; a PR or issue body must not name an `atlassian.net` host (write "the fake site host"); a UI change that alters a flow the user guide shows means recapturing its images (handover User Guide Images); any story that adds a `<button>` runs `e2e/desktop/buttons.test.ts`.
- Standing: run every check but the full suite in the foreground and tell each agent so (AGENTS.md); the full suite takes 15 to 29 minutes and runs in the background with a log ending in `EXIT=` that you poll. Tell every agent never to delete a file it did not create and to send its report to `main`. One agent per worktree. Confirm a builder applied a mid-build decision. Dispatch `kothar:project-manager` on sonnet, unnamed. Grep the schema before calling a field a contract change. Save `error-context.md` before a full e2e rerun, which wipes `e2e/test-results`. Push from the story worktree with a literal `cd` (AGENTS.md).

Do not run `pnpm e2e` for a story. Shane's rules of 2026-10-15: builders run only their story's e2e files; the full local suite runs once, after a batch is developed (one agent, `lockf`, one worker, read the counts); stories stack and merge after that run; a pull request merges without waiting for Shane once the local CI route and the review verdict pass, as he reviews in the morning. GitHub Actions cannot run (Shane, 2026-10-17), so the full local suite is part of that route. Shane ruled on 2026-10-17 that a documentation-only change skips the e2e run ("if only documentation is being changed, it should skip the e2e run"): the definition is in [Local CI](docs/standards/git-workflow.md#local-ci), and `pnpm ci:local` still runs.

The local CI route replaces GitHub CI (see [Local CI](docs/standards/git-workflow.md#local-ci)): run `pnpm ci:local` on a clean, committed tree under Node 24, then the Electron dist check, then e2e on one worker. The test command is `pnpm test`, plus, for desktop work, only the e2e files the story touches, and `pnpm e2e --workers=1` once per batch (see above). No database exists: Jira is reached live only through `jm` and the app, and tests never write to it. [handover.md](handover.md) holds the state, the decisions and the traps.

### Keep the documentation current

Shane asked for this explicitly on 2026-10-13, 2026-10-18 and 2026-10-19, and again as the standing focus. Run it in every pull request:

- Check closed issues named as open and features named as planned or not built in `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`, `docs/` (except dated discovery records and accepted ADRs) and each package README.
- Check each file name and script a doc names against `git ls-files` and `package.json`.
- Compare the `e2e/README.md` suite table with `e2e/desktop/` (`npx playwright test --list` in `e2e`) and the `apps/desktop/README.md` file table with `git ls-files apps/desktop/src`.
- Compare the shortcut tables in `docs/reference/shortcuts.md` with `keymap.ts` (`shortcuts.test.ts` does it).
- Run a link and anchor check over every tracked `.md` file: a `python3 -I` script over `git ls-files '*.md'` that skips code spans and fences and checks heading anchors.
- Run `pnpm docs:reference` and confirm `git status` is clean.
- Look for text describing Collapse all or Expand all, session-only collapse, the old #209 filter rule, `xvfb-run` instructions, or status-first ordering under Key (changed by #222).

Latest sweep, 2026-10-25 17:34 AEST (this refresh, on 9e83676; #394 is the only change since the full sweep): the link and anchor check (`links.py` in the `handover-1025h-build` scratch folder, which can vanish) found 96 tracked `.md` files and 469 relative links and image paths, none broken; `pnpm docs:reference` left `git status` clean; `npx playwright test --list` printed `Total: 964 tests in 57 files`; `shortcuts.test.ts` passed 15 of 15. The rest carries from the full sweep below, not rerun.

Full sweep, 2026-10-25 17:14 AEST (carried by PR #394): 96 tracked `.md` files; 469 relative links and image paths, none broken (`links.py` in the `handover-1025g-build` scratch folder, which no longer exists at 17:34 AEST); `pnpm docs:reference` left `git status` clean; `npx playwright test --list` printed `Total: 964 tests in 57 files`, all 57 `e2e/desktop/*.test.ts` files are named in `e2e/README.md` and every test file it names exists; all 150 non-test files under `apps/desktop/src` are named in `apps/desktop/README.md`; `shortcuts.test.ts` passed 15 of 15 (95 rows); a path check (`paths.py`, same folder, also gone) over 72 non-record `.md` files left 18 unresolved names, all runtime state files, built outputs, e2e fixture attachments, naming examples, `docs/reference/core.md` (dropped by Shane on 2026-10-10, and the doc says so) and `turbo.json` (named as a future step); every `pnpm` script a doc names exists in `package.json`; the greps for Collapse all, Expand all, session-only collapse, `xvfb-run`, status-first ordering, `jira-mgr.app` and 1.0.0 or 1.0.1 outside the handover files, `docs/discovery`, `docs/adr` and `CHANGELOG.md` found only dated records and correct statements; no doc names #377, #382 or #384 at all. Fixed: `docs/product/roadmap.md` stopped at #340 and now points to `CHANGELOG.md` for the later stories. Earlier sweeps are in the pull requests that carried them (`git log --oneline -- prompt.md`).

- **Each story touching UI goes to HIL Review** after merge, per Loop step 9. Name in the comment the orchestrator's choices Shane has not confirmed and add `question`. Shane closed #219, #223, #224, #237 and #238 on 2026-10-17 on that footing, and closing an issue approves its listed choices.
- Do not build gap 13 (undecided) or gap 14 (Later).

Run e2e with `pnpm e2e --workers=1`, serialised across worktrees with `lockf /tmp/jira-mgr-e2e.lock pnpm e2e --workers=1`. AGENTS.md names the lock; `lockf` creates it on first use, `pgrep -xl lockf` shows whether a run holds it, and a run waits its turn when another holds it.

## Reading Order

1. [handover.md](handover.md), then this file.
2. [AGENTS.md](AGENTS.md) and [docs/standards/](docs/standards/README.md).
3. [docs/product/roadmap.md](docs/product/roadmap.md), the [product grilling record](docs/discovery/2026-10-07-product-grilling.md) and the [ADRs](docs/adr/README.md).

## Loop

1. `git fetch` and read what changed in the handover files and `AGENTS.md`.
2. Claim the next unblocked issue: comment the branch, add `status:in-progress` through `kothar:project-manager`.
3. Cut a branch from `origin/main`. When Shane has said to stack a batch, cut from the branch below it. Read the issue and every file it touches.
4. Build the smallest change that meets the criteria, with its test.
5. Run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` (the full `pnpm ci:local` runs with the batch, below), plus, for desktop work, only the e2e files the story touches (`pnpm build`, then `cd e2e && lockf /tmp/jira-mgr-e2e.lock npx playwright test desktop/<file>.test.ts --workers=1`). Put that command in the first dispatch and forbid `pnpm e2e` outright: a builder whose run is killed restarts it. The full `pnpm e2e --workers=1` runs once, after the batch is developed. Read the pass and fail counts. Commit locally and have a reviewer other than the builder pass it before pushing, since a green PR may merge at once.
6. Run `/autonomous:update`, so the handover lands in the story's commit.
7. Commit with `Refs #n`. A stacked batch waits: when every story is developed and reviewed, run the local CI route once on the stack tip (`pnpm ci:local`, the Electron dist check, `lockf <lock file> pnpm e2e --workers=1`; see AGENTS.md), then push in stack order and open each pull request with that run's head SHA and pass and fail counts. GitHub Actions cannot run, so no `gh run` exists to wait for. A documentation-only change skips the Electron dist check and the e2e run (see [Local CI](docs/standards/git-workflow.md#local-ci)). A change after the run needs the route again. After each squash merge, rebase the next branch (see AGENTS.md).
8. When the local route passes on the pushed head and a PASS verdict is newer than the head, merge with `gh pr merge <n> --squash` without waiting for Shane. ship-it sometimes merges first and posts a "Merge already in progress" failure after our merge succeeded (#240, #241, #243): check `gh pr view <n> --json state` and ignore the notice. Confirm MERGED, then clean up the branch.
9. Comment on the issue how each criterion is met, ending with `Review verdict: PASS (reviewer <agent>, builder <agent>)`. Put nothing after the verdict line: the merge guard reads a verdict only as the first or last line of a comment (refused #226 once, 2026-10-14). Then have `kothar:project-manager` close it as Done, unless it needs Shane's judgement: anything he sees or uses (CLI output, Desktop UI), anything touching security or credentials, and live PSAPAC checks. Those go to `status:hil-review` for Shane to close (rule adopted by Shane 2026-10-07).

## Decision Format

Comment on the issue: the question, each option with its cost and what it buys, a recommendation with its reason, and what happens on each answer. Add the `question` label, then have `kothar:project-manager` set `status:hil-review`. Remove `question` once Shane answers. Shane finds his work by these two labels and closes only issues carrying `status:hil-review` (Shane, 2026-10-09).

## Not Alone

- Any write to live Jira (PSAPAC): creating, editing, transitioning or deleting issues, comments, worklogs, links or attachments. Tests never write. Re-running the write section of [the L7 runbook](docs/runbooks/l7-smoke-check.md) needs Shane present.
- Running `jm` by hand without `JM_STATE_DIR` set to a scratch folder. The real state folder holds Shane's timer and views.
- Merging a Dependabot major version bump.
- Code signing, notarisation and publishing a release, or anything that costs money. Shane signs and notarises (see [the release runbook](docs/runbooks/release.md)). One-time grant, 2026-10-24: Shane authorised runbook steps 2 to 6 (package, sign, notarise, staple, zip, tag, draft) for 1.0.1 only, and replacing the installed app. It does not extend to any later release: signing still needs his word each time. He publishes the release; publish the draft itself (`gh release edit vx.y.z --draft=false`), never a new release.
- Changing an accepted ADR's decision; write a new ADR instead.

## Skills

- `verification-before-completion` before claiming any criterion met.
- `architecture-decisions` for a decision that is hard to reverse, surprising and a real trade-off.
- Design docs for L1, D2 and D4 from `docs/templates/design-doc.md`, before their code.
- `impeccable` and `frontend-design` for Desktop UI work.
- Compare Desktop UI against the Linear screenshots and tokens in [docs/design/linear/](docs/design/linear/README.md), captured 2026-10-09 at Shane's request; name in the pull request which Linear screenshots you compared and what differs (gh cannot upload images).
- `writing-clearly-and-concisely` rules for every doc, commit and comment.
