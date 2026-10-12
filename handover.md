# Handover

## Where Work Stands

Checked 2026-10-12. Head `5bc9feb` (`git log --oneline -1 origin/main`, PR [#196](https://github.com/shanedolley/jira-mgr/pull/196), a handover refresh after the desktop bulk bar in #195); main CI run 38196777760 succeeded on it. Every story from #9 to #184 is closed, #143 included (Shane, 2026-10-12). No issue is open.

#143 shipped as two pull requests: core's batch module [#194](https://github.com/shanedolley/jira-mgr/pull/194) and the desktop selection, bulk bar and batch undo [#195](https://github.com/shanedolley/jira-mgr/pull/195). Shane answered the M3 question with option A on 2026-10-12: the selection stays pruned to the rows shown, so a bulk move to Done under Hide done empties it.

Shane closed #138, #150 and #184 and answered #144 ("keep the neutral capsule with a red icon") and #151 ("Approved") on 2026-10-12; the project manager closed those two.

## Stories

Closed stories keep their evidence in the PR and the issue comments. Only carried Lows and facts a fresh session needs sit here.

| Issue | Story | PR | Carried |
|---|---|---|---|
| #126 | Contrast | [#154](https://github.com/shanedolley/jira-mgr/pull/154) | |
| #127 | Keyboard basics | [#159](https://github.com/shanedolley/jira-mgr/pull/159) | Low: the skip link does nothing while the Tree is unmounted |
| #128 | Status glyphs, empty and error copy | [#165](https://github.com/shanedolley/jira-mgr/pull/165), [#175](https://github.com/shanedolley/jira-mgr/pull/175) | The Peek's "Could not load the description." names no cause; a follow-up if Shane wants it |
| #129 | Scrim, drop zone, login | [#164](https://github.com/shanedolley/jira-mgr/pull/164) | |
| #130 | Toasts and pending state | [#169](https://github.com/shanedolley/jira-mgr/pull/169) | |
| #131 | Focus and selection by fill and a bold key | [#155](https://github.com/shanedolley/jira-mgr/pull/155) | |
| #132 | Properties sidebar | [#158](https://github.com/shanedolley/jira-mgr/pull/158) | Lows: the `useIssueDetail` guard does not help when no copy is held yet; an image-only description shows "No description" |
| #133 | Create dialog chip strip | [#163](https://github.com/shanedolley/jira-mgr/pull/163) | |
| #134 | Toolbar pickers | [#160](https://github.com/shanedolley/jira-mgr/pull/160) | Medium, unverified since 2026-10-12: the toolbar wrapped sooner at 1200 wide with the Peek open; #151 changed the toolbar since |
| #135 | Shortcut help | [#162](https://github.com/shanedolley/jira-mgr/pull/162) | |
| #136 | Page type scale | [#161](https://github.com/shanedolley/jira-mgr/pull/161) | |
| #137 | One button and radius system | [#174](https://github.com/shanedolley/jira-mgr/pull/174) | |
| #139 | Filters by creator, links and more | [#178](https://github.com/shanedolley/jira-mgr/pull/178) | |
| #140 | Tree quick actions | [#167](https://github.com/shanedolley/jira-mgr/pull/167) | |
| #141 | Issue actions in the palette | [#173](https://github.com/shanedolley/jira-mgr/pull/173) | Lows: the actions do nothing, silently, when the Sprint picker is absent or create is unavailable |
| #142 | Create dialog description and attachments | [#170](https://github.com/shanedolley/jira-mgr/pull/170), [#180](https://github.com/shanedolley/jira-mgr/pull/180) | Lows: the post-create catch is untested and a throw from `reset` in the `finally` would skip `onCreated`; a null read-back makes the description base the sent text, so the notice can wrongly say "changed in Jira"; Cmd+Z after Create more may restore a swept placeholder (unrun) |
| #145 | Sub-issues from the issue page | [#181](https://github.com/shanedolley/jira-mgr/pull/181), [#185](https://github.com/shanedolley/jira-mgr/pull/185) | Lows: a same-summary Subtask made elsewhere is mistaken for ours; a client timeout can run the confirming read before Jira finishes, so a retry can still duplicate; core already retries a POST on 429 or 503 |
| #146 | Saved views that update, duplicate and reorder | [#183](https://github.com/shanedolley/jira-mgr/pull/183) | Five starter views, where the decision said four, because #139 added "Created by me"; view tabs are 6px ghost buttons, not Linear's full pills |
| #147 | Jira text search | [#166](https://github.com/shanedolley/jira-mgr/pull/166), [#177](https://github.com/shanedolley/jira-mgr/pull/177) | `TEXT_SEARCH_LIMIT` in `packages/core/src/search.ts` is the one cap (50) |
| #148 | Inbox | [#179](https://github.com/shanedolley/jira-mgr/pull/179) | `inbox.json` is not per account, so a second Jira account on one machine shares the read marks; a swallowed 401 on the Inbox query is theoretical |
| #149 | Sprint page | [#182](https://github.com/shanedolley/jira-mgr/pull/182) | Lows: the progress bar rounds each share separately and can read 101% in `aria-valuetext`; status groups sort by key number across projects; every issue re-read refetches an open Sprint page. The burndown is not built |
| #138 | Tree row anatomy, row properties, ordering | [#187](https://github.com/shanedolley/jira-mgr/pull/187) | Closed 2026-10-12. Row properties persist per view in `views.json` (option B). Row properties hide below 700px of Tree width, so a toggle can seem to do nothing while the Peek is open. `jm view list --json` gains an optional `display` field |
| #144 | Blocked and blocking pills | [#188](https://github.com/shanedolley/jira-mgr/pull/188) | Closed 2026-10-12; Shane kept the neutral capsule. The hook wiring is untested |
| #150 | Epic progress, Epics table, Customers page | [#189](https://github.com/shanedolley/jira-mgr/pull/189) | Closed 2026-10-12. Open Lows L4 and L5 (see the #150 review comments). No "No Customer" row; progress counts direct children |
| #151 | Narrow layout | [#190](https://github.com/shanedolley/jira-mgr/pull/190) | Closed 2026-10-12, approved. Lows: L6 (traffic-light padding unverified on a real window) and `useTreeTop` reading layout on every render. At narrow widths the Peek card covers the right edge of rows, pills included |
| #184 | Bug: the palette and sidebar acted on the hidden Tree under the Inbox or a Sprint page | [#186](https://github.com/shanedolley/jira-mgr/pull/186) | Closed 2026-10-12. Found by 149-sprint-review |
| #143 | Select and edit several issues at once | [#194](https://github.com/shanedolley/jira-mgr/pull/194), [#195](https://github.com/shanedolley/jira-mgr/pull/195) | Closed 2026-10-12; M3 settled as option A. Low: the same-tick `inFlight` guard in `BulkBar.tsx` has no unit test (no component-test setup). Selection is pruned to the rows shown. Proven live 2026-10-12: bulk priority, label ADD, status transitions, assignee and unassign, Customer and Engagement. Dates and label removal go one issue at a time by design. Fixtures `packages/core/fixtures/bulk-*.json`; throwaways PSAPAC-3141 to 3144 deleted |

Not built, by decision: gap 13 (Favourites and recents) is undecided and gap 14 (Activity feed) is Later. Do not build either.

## Built Before the Review Stories

All merged and closed. The design docs, `apps/desktop/README.md` and `packages/core/README.md` hold the detail.

- Core C1 to C12 (#38 to #50) and subpaths: see `packages/core/README.md`. Node-only code sits behind a subpath export, never `@jira-mgr/core`'s main entry, which the renderer imports.
- CLI L1 to L6 (#51 to #56): every command in `docs/reference/cli.md` has a handler. L7 live check (#27, PR #62) ran 2026-10-08 with Shane present; [the runbook](docs/runbooks/l7-smoke-check.md) lists each command's result. Its throwaway issues PSAPAC-3127 to 3129 were deleted. Re-running its write section needs Shane present.
- L8 (#67, PR #69): `createIssue` reads the new issue back and `jm issue create` returns what `jm issue get` returns. A failed read-back after a created issue exits 5 with `jira_error`, the key in `details` and "Do not create it again". The read-back does not see the PSAPAC automation (see Traps).
- Bugs #60 (worklog edit and delete acted on another issue's worklog, PR #63) and #61 (doubled full stop, empty ADF worklog comment, PR #64) are fixed.
- Desktop D1 to D13 (#28 to #37, #83 to #86; PRs #68 to #116): shell, Tree, issue page, editor, activity, create and delete, keyboard, saved views, timer, packaging, click-to-edit summary, type icons and profile images. Designs: [0002](docs/design/0002-issue-tree.md), [0003](docs/design/0003-editor.md), [0004](docs/design/0004-activity.md).
- Reference pages `config.md` and `shortcuts.md` (#101, #106). There is no `core.md` and no TypeDoc dependency (Shane, 2026-10-10).
- Linear UI reference (#87): screenshots and measured tokens in [docs/design/linear/](docs/design/linear/README.md). Compare Desktop UI against them.

Live results worth knowing (2026-10-08, L7): issue type change between Story, Task and Bug works; `originalEstimate` alone sets the remaining estimate to the same value; a Subtask accepts Start date, Time remaining and Priority; worklog writes with `adjustEstimate=auto` adjust the remaining estimate; Jira refuses a comment id from another issue with 404 but applied a worklog write through the wrong issue (#60), while a worklog read through the wrong issue answers 404, which the #60 fix relies on. Link direction (2026-10-07): the issue named `inwardIssue` in a POST is the blocker.

Client-side rules core leaves to the CLI and app: label suggestions are site-wide, so filter to project labels if wanted (Q35); hide undated sprints such as "PS TEMPLATES" behind "Show all" (Q20); priorities come from createmeta (11 for PSAPAC), not `/priority` (20 site-wide).

## Board

GitHub issues on `shanedolley/jira-mgr` track the work (Q43). Milestones Core (1), CLI (2) and Desktop (3) hold #9 to #37 and later issues; blockers use GitHub's issue dependencies.

| Measure | Value | Command | Date |
|---|---|---|---|
| Open | 0 | `gh issue list --state open --limit 200` | 2026-10-12 |
| Closed | 71 | `gh issue list --state closed --limit 300` | 2026-10-12 |
| In progress | none | `--label status:in-progress` | 2026-10-12 |
| In HIL Review | none | `--label status:hil-review` | 2026-10-12 |
| With `question` | none | `--label question` | 2026-10-12 |
| Open pull requests | none | `gh pr list --state open` | 2026-10-12 |

`git worktree list` shows the main tree only (2026-10-12). Only `main` exists on origin. Use `gh pr list --state all --limit 200` for history; 50 is the default cap.

## What Runs

From the repository root, under Node 24 (see Traps). No database exists or is planned: no command below reaches one. Jira is reached live only through `jm` and the app's main process.

| Command | Does | Reaches |
|---|---|---|
| `pnpm test` | Vitest unit tests. Core 1354 pass and 5 skip, desktop 1142, CLI 602 (main CI run 38195032090 on 3d1487f; `gh run view 38195032090 --log`, 2026-10-12) | Nothing external: core and CLI Jira calls hit the MSW fake, which fails any unhandled request; desktop tests use fake backends |
| `pnpm test:live` | The same plus `*.live.test.ts`, with `JM_LIVE_JIRA=1` | Live PSAPAC, read-only |
| `pnpm e2e --workers=1` | Builds the app and runs the Playwright Electron suites in `e2e/desktop/` (`e2e/README.md` lists them). CI run 38195032090 on 3d1487f: 522 passed, 4 skipped (`gh run view 38195032090 --log`, 2026-10-12). A local macOS run has 526 tests with 1 skipped. Serialise across worktrees with `lockf <scratchpad>/e2e.lock pnpm e2e --workers=1` | A local Electron window over an in-memory fake Jira and a fake Keychain, state in a temp `JM_STATE_DIR`; no network |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` | Checks and builds | Nothing external |
| `pnpm -s jm -- <args>` | The built CLI. Use `-s`: plain `pnpm jm --` prints pnpm's banner and breaks JSON | Live Jira at the site in `settings.json`, as the logged-in user. Writes from L4 on. Set `JM_STATE_DIR` to a scratch folder first |
| `pnpm package` | Builds `apps/desktop/dist/jira-mgr.app`; macOS only | Nothing external. The packaged app, like `pnpm dev`, uses the real state folder and Keychain item unless `JM_STATE_DIR` is set |
| `pnpm docs:reference` | Regenerates `docs/reference/cli.md` and `errors.md` | Nothing external |
| `pnpm fixture:record -- <name> <GET\|POST> <path> [body]` | Records one response body to `packages/core/fixtures/` | Live Jira at `JM_JIRA_SITE`, reads only |

State files live in `~/Library/Application Support/jira-mgr/`. `JM_LIVE_KEYCHAIN=1` on macOS runs `auth.live.test.ts`, which writes and deletes a throwaway Keychain item.

CI (`.github/workflows/ci.yml`) runs `pr-title`, `checks` and `e2e` on pull requests and on pushes to `main`. Confirm a run with `gh run list --workflow ci.yml --branch main --limit 1` and `gh run view <id> --json headSha,conclusion`.

## Environments

- Jira: Collibra site `engineering-collibra.atlassian.net`, project PSAPAC. Its measured shape (issue types, field ids, statuses, link types, sprints) is in [round 2](docs/discovery/2026-10-07-product-grilling/round-2.md), measured 2026-10-07 and unverified since 2026-10-12. Field presence comes from createmeta and editmeta: Sprint (10600) is on every type but Epic; Start date (13808) is on Bug, Story and Epic in createmeta, though a live Subtask edit accepted it. Metadata does not predict what Jira accepts (editmeta lists no Priority for Subtask, yet a live edit changed it). Transition 3 on Epics is named "REVIEW", so match transitions by target status.
- Credentials: `~/.claude/bin/kj collibra` reads the Keychain item `kothar-jira-collibra` with `COLLIBRA_JIRA_EMAIL` (item present, `security find-generic-password` exit 0, 2026-10-12). The fixture recorder borrows that token through `JM_JIRA_TOKEN`. jira-mgr's own item (service `jira-mgr`, account = the Collibra email) is written by `login` from `@jira-mgr/core/auth`; it exists, so `jm` is logged in on this Mac (exit 0, 2026-10-12).
- Recorded fixtures are committed as recorded, with no scrubbing (Q60). Never record request headers.

## Open Decisions

| Raised | Decision | Owner |
|---|---|---|
| 2026-10-10 | Whether to build Favourites and recents (gap 13) | Shane |

Settled, with the sources for the rest. Accepted answers live in each issue's comments.

- #131: the light-theme fills stay as built, and the active-only row keeps its fill alone.
- #143 (Shane, 2026-10-12): M3 option A, the selection stays pruned to the rows shown. Esc clears the selection before it closes the Peek; the selection stays after an action; bulk calls send `sendBulkNotification: false`; checked rows take the selected fill through `aria-checked` while the peeked row keeps `aria-selected` and its bold key. The bar's primary action is Status.
- #144 (Shane, 2026-10-12): keep the neutral capsule with a red icon. #151 (2026-10-12): approved as built.
- Review decisions: [docs/discovery/2026-10-10-review-decisions.md](docs/discovery/2026-10-10-review-decisions.md). Shane's answers on #128 to #149 (2026-10-11) sit under his login in `gh issue view <n> --json comments`, as agents post through his account. The ones that shape code: #128 option B (branch on not found and server fault); #131 option C (the bold key); #139 option A (sibling keys plus a `not` object); #142 upload a pasted image after the create and patch the description, and drop onto the dialog; #145 the "No subtasks" section always shows, the UI says "sub-issue", and a lost create is read to confirm before a retry; #146 option A; #147 option B (cap 50); #148 option C (keep the reporter clause); #138 option B (row properties and order persist per view).
- 2026-10-07: with "Hide done" and "Assignee: me" both on, an open issue of yours keeps its Done ancestors as dimmed context; internal stories close as Done after a passing agent review, while user-facing, security and live-Jira work goes to Shane in HIL Review; Keychain access through `/usr/bin/security`; state files in `~/Library/Application Support/jira-mgr/`; Markdown in the CLI; build order Core, CLI, Desktop; Dependabot majors: merge vite 8, typescript 7 and @types/node 26, ignore plugin-react 6 and eslint 10; zod is core's validation library and `marked` its Markdown lexer; view filters are multi-value arrays; `internal` errors exit 1.
- CLI (Shane, 2026-10-07): JSON envelope `{"data"}` or `{"error"}`; a timer stop needing confirmation exits 2 without `--confirm` or `--time`; JSON carries `descriptionMarkdown` and `bodyMarkdown` beside the ADF; write commands and `--parent` refuse keys outside the configured project.

## Traps

Each re-read at its source on 2026-10-12 unless it says otherwise.

- **Linux CI differs from macOS** (met on #159, #163 and #190; one red CI round each). Now in [AGENTS.md](AGENTS.md).
- **A release before the write is held is lost** (met after PR #170, fixed by PR #171). The e2e fake's `releaseEdit` is `held.shift()?.()` in `apps/desktop/src/main/e2e-fake.ts`, so releasing before the write is held does nothing and the dialog waits forever. Wait for the write (`settle(n)` or `expect.poll(writes)`) before `releaseEdit`.
- **An edit's read-back must skip while a newer edit of the issue is in flight.** A read that lands late overwrites the newer edit on screen. Any new read-back of an issue uses `applyUnaskedRead` (`optimistic.ts`; fixed by #114).
- **Reproduce CI-only races with CPU throttling.** `throttle()` in `e2e/desktop/keyboard.test.ts`, `palette.test.ts` and `toast.test.ts` sets CDP `Emulation.setCPUThrottlingRate` to 20. Never read derived rows in an event handler right after a state change (#159: Tree rows built from `useDeferredValue(filters)` read a render late).
- **Wait out ProseMirror's focus timer before a caret key in e2e.** `focusSettled()` in `e2e/desktop/editor.test.ts` does it (#103).
- **Single-file e2e runs test stale code.** `npx playwright test desktop/<file>` inside `e2e/` runs the last build in `apps/desktop/out`. Run `pnpm build` first; `pnpm e2e` builds first.
- **Parallel e2e runs starve Electron.** Several worktrees at once make 5 to 25 tests time out in `beforeEach`. Use `--workers=1` and the shared `lockf` lock, and rerun on a quiet machine before treating a `beforeEach` timeout as real. Met again 2026-10-12: a builder without the lock lost two full runs (SIGTERM, exit 137) while another agent held it; name the lock path in every dispatch that runs e2e.
- **Read the failing test's name and assertion before rerunning.** A rerun that passes can hide a real bug (a date committed twice failed 15 of 40 runs before its fix; the caret bug was another).
- **Delete hover colour flake** (once, 2026-10-11): `e2e/desktop/buttons.test.ts` failed once and passed 60 of 60 on rerun. If it recurs, re-hover inside the `expect.poll`.
- **Unanchored row-label locators match Epic progress** (met 2026-10-12 on PR #193, one red CI round). Since #150 an Epic row's label ends "N of M done", so `item(/2 done/)` also matched two Epics and passed only when its poll landed before the Done phase loaded (7 of 8 local runs failed). Match a row label exactly or anchor it (`/^2 done$/`).
- **The Electron dist can be missing in a new worktree** (nine or more times). The check and fix are in [AGENTS.md](AGENTS.md).
- **A conditional `border-danger` never wins over another border colour.** In the built CSS `.border-danger` sorts first. Use `aria-invalid:border-danger`, as `IssueProperties.tsx` does.
- **ship-it** (the merge automation) behaves inconsistently. It merged #38, #40, #42 to #45, #47, #68 and #154 on green, and left #46, #62 to #65, #88 to #95 and #98 alone. It tries to merge a draft and posts "Pull Request is still a draft" failures; the draft is deliberate while a story waits on Shane, so ignore them and do not push. A second merge then reports "merge conflicts" or "already in progress": check `gh pr view <n> --json state` first.
- **The hooks refuse some command shapes.** A `gh pr create` body quoting test counts the session did not run is refused (attribute counts to the builder or reviewer, or omit them). `gh pr create` takes `--body-file -` with a quoted heredoc; a body file on disk is refused. `gh pr edit` takes `--body "$(cat <<'EOF' ... EOF)"` only, and the claim-check refuses any sentence it cannot verify, a restated review verdict included. `gh issue comment --body` refuses `$(...)` except a quoted heredoc. The ticket guard refuses Bash text that names the Collibra host, shell variables inside a `kj` path and `>|` redirects; run `kj` alone with a plain `>` redirect, then parse the file in a second command. Write commit messages to a file and pass `git commit -F`.
- **`gh pr checks <n> --watch` right after a push can pass early.** It prints "no checks reported" before the run registers, or exits with e2e pending. Rerun until the run for the new head finishes, then confirm `gh run view <id> --json headSha,conclusion` shows the head you pushed. Bitten once; move it to AGENTS.md if it bites again.
- **Retitling a PR does not rerun CI**, so `pr-title` keeps its old result; push a new commit after a retitle. PR title scopes (`ci.yml`, 2026-10-12): `cli`, `desktop`, `core`, `config`, `e2e`, `docs`, `repo`, `deps`, `deps-dev`.
- **Two PRs on shared desktop files conflict in sequence.** Merge one, rebase the other onto `main`, and trust only a CI run from after the rebase. Land pull requests one at a time.
- **Squash merges and `git branch -d`.** After a squash merge `-d` refuses. Confirm `git diff <branch-tip> origin/main` is empty, then `KOTHAR_ALLOW_DESTRUCTIVE=1 git branch -D`.
- **A copied worktree folder moves the original's HEAD.** Make scratch copies with `git worktree add` or `git clone`, never `cp`. Give each agent its own worktree; one left the main tree on its own branch and the commit guard then blocked a commit on `main`.
- **Node 22 is the default shell node** (2026-10-12: `node` on PATH resolves `~/.local/share/mise/installs/node/22.22.0`; the mise shim gives v24.16.0 inside the repository, from `.nvmrc`, and v22.22.0 outside it). CI uses `.nvmrc` (24) and `engines` requires `>=24`. Put `~/.local/share/mise/installs/node/24.16.0/bin` first on PATH (v24.16.0 confirmed 2026-10-12).
- **pnpm forwards `--`.** `pnpm jm -- --help` passes a literal `--`; `scripts/jm.ts` strips it.
- **Pinned toolchain** (re-read in the package files, 2026-10-12). ESLint stays on 9 for `eslint-plugin-react`. Every package is on TypeScript `~7.0.2` except `packages/config-lint`, which keeps `~6.0.0` for `typescript-eslint`.
- **msw 3 breaks Vitest's peer range.** `pnpm add -D msw` resolves 3.x; `@jira-mgr/core` pins `msw@^2`.
- **Weak regression tests.** Reviewers revert each fix in a scratch copy and confirm its test fails; ask for that on every bug fix.
- **Eager promises in tests.** Build each promise only when you await it, or a later rejection goes unhandled and fails the run intermittently.
- **Wall-clock test bounds flake on CI.** Size a timing assertion so a slow runner stays well inside it (`timer.test.ts` measured 131 ms against a 50 ms bound; fixed by widening the gap, not the bound).
- **Timer tests cross local midnight.** Resolved 2026-10-11 by #156: the timer e2e launches Electron with `TZ` set to an `Etc/GMT` zone where it is about noon (`e2e/README.md`).
- **`security -i` exits 0 on failure and splits long lines.** A bad command still exits 0 and can create a junk item, and stdin past 4095 bytes runs as a second command. `@jira-mgr/core/auth` caps lengths and reads every write back. Probe the Keychain only with throwaway service names and delete what you create.
- **Recorded search pages never end.** Fixtures recorded mid-phase carry `isLast: false`; tests serve page 2 with the token dropped and `isLast: true`.
- **Reviewers can be confidently wrong about Jira semantics.** When builder and reviewer disagree and only a write can settle it, ask Shane for one reversible live check.
- **HIL blockers stay open.** A story in HIL Review stays open until Shane closes it, so GitHub still lists it as an open blocker. Treat a merged blocker in HIL Review as satisfied for building.
- **Timer guard matches keys, not timers** (accepted). If the CLI stops and restarts the same issue while the app's stop dialog is open, confirming logs the dialog's time against the new timer too. Add an `expectStarted` check if it bites.
- **`views.json` and `inbox.json` have no lock** (accepted). The app serialises its own writes on one promise chain. A CLI command that writes either must lock first, as core's timer does.
- **Timer known limit** (accepted). A SIGKILL, power loss or second Ctrl-C between core taking the timer and the worklog finishing can lose the tracked time; one Ctrl-C restores it paused. See `packages/core/README.md`.
- **PSAPAC automation rewrites new issues** (measured 2026-10-08 and 2026-10-09; unverified since 2026-10-12). An Automation for Jira rule runs after every create: it adds the label `PSAPAC`, sets the original estimate to 14400 with remaining 0, and sets Time remaining (h). On a Task it also replaced the Customer, parent and sprint the CLI sent. Estimates land within about 1 s, the rest within about 10 s, so the read-back inside `issue create` sees none of it. The app's create toast reads once, about 10 s later.
- **Estimate edits cascade** (2026-10-08). `--estimate` alone sets the remaining estimate to the same value, and the automation keeps Time remaining (h) equal to it. A direct `--time-remaining` edit stuck.
- **Runs against the real state folder leave state behind.** An L6 review run left a paused timer on PSAPAC-12. Set `JM_STATE_DIR` to a scratch folder for any hand run of `jm`, and for a live run copy `views.json` and `timer.json` first and compare after. Use `timer start <key> --expect <key>`.
- **e2e windows take OS focus** unless hidden. The e2e entry opens windows with `showInactive()`, at opacity 0 and ignoring the mouse (macOS keeps 40px of any window on a display, so off-screen positioning fails); tests assert both.
- **Ghost Electron icons in the Dock** after an e2e run (`lsappinfo list` shows "exited-with-subordinates"). They hold no process. Quit them from the Dock or log out.
- **Browser tool scope.** `browser-harness` drives only the dedicated automation Chrome on port 9333 (profile `~/.browser-harness-chrome`), not Shane's everyday Chrome. Linear is signed in there.
- **Subagent writes of findings files in the scratchpad were refused by hooks** (2026-10-10). Have review subagents return findings as message text.
