# jira-mgr

A Linear-style Electron app and an agent-friendly CLI (`jm`) for one Jira project, PSAPAC on `engineering-collibra.atlassian.net`: a TypeScript pnpm monorepo where `@jira-mgr/core` holds the Jira client and domain rules. [ARCHITECTURE.md](ARCHITECTURE.md) maps the directories, [CONTEXT.md](CONTEXT.md) defines the domain terms, and each folder's `README.md` states what belongs there.

Before changing an area, read its standard from [docs/standards](docs/standards/README.md) and the ADRs in [docs/adr](docs/adr/README.md) that touch it.

## Always

- Put Jira access and domain rules in `@jira-mgr/core`. The desktop app and the CLI import it, and nothing else talks to Jira.
- Resolve Customer, Engagement, Sprint and Start date by name through core. Never hard-code a custom field id.
- Validate every value from Jira, CLI arguments and the settings file with a schema at the boundary ([TypeScript](docs/standards/typescript.md#validation)).
- Keep the CLI command schema as the one source for `--help`, `jm help --json` and `docs/reference/cli.md`.
- Test `core` against the MSW fake. Run live PSAPAC tests only with `JM_LIVE_JIRA=1`, through `pnpm test:live`.
- Use the terms in `CONTEXT.md` in code, commands and docs.
- Branch, commit and merge per [git workflow](docs/standards/git-workflow.md), with `Refs #12` in commits.
- Update docs in the same pull request, per [documentation](docs/standards/documentation.md).
- After `pnpm install` in a new worktree, check the Electron dist with `du -sh node_modules/.pnpm/electron@*/node_modules/electron/dist` (about 307 MB, with `path.txt` beside it). If the dist is missing or truncated, run `pnpm --filter @jira-mgr/e2e exec install-electron`, or every e2e test fails to launch.
- Run e2e on one worker with `pnpm e2e --workers=1` and read the worker count in the output. `pnpm e2e -- --workers 1` passes `--` literally and leaves Playwright on 5 workers.
- Expect Linux to differ from macOS in layout (GitHub's Linux runs no longer happen, but a Linux checkout or a later CI still meets it): its fonts are wider (the create dialog's chips wrapped under xvfb), its scrollbars take 15px where macOS overlay scrollbars take none (measure `offsetWidth - clientWidth`), and a race such as a Tree row read a render late can fail only there. Add a Verdana variant to layout tests and reproduce races with CDP `Emulation.setCPUThrottlingRate` at 20, as `throttle()` in `e2e/desktop/keyboard.test.ts` does.
- Shell noclobber is on, so `>` onto an existing file fails silently. Overwrite with `>|` or `tee`, and confirm the file changed before trusting a before-and-after run. It has cost a revert proof four times (2026-10-07, 127-keyboard-review and 133-create-build, 2026-10-11, 301-column-order-review's re-check, 2026-10-19).
- Check `uptime` before a full e2e run. Load averages of 15 to 32 made timing tests fail on 2026-10-19 (`columns.test.ts:306`, `headerhover.test.ts:284`), and each passed on rerun. Wait for a quiet machine, or rerun a lone timing failure alone, before you treat it as real.
- Run `pnpm build` before a single-file e2e run (`cd e2e && npx playwright test desktop/<file>.test.ts --workers=1`): it tests the last build in `apps/desktop/out` (met 2026-10-10). Run it with `--list` first to see the file match; a builder once saw 0 matches and the cause stayed unknown.
- Rebase the next branch of a stack after each squash merge with `git rebase --onto origin/main <old tip hash>`, never the branch name, since a rebased local ref has moved (one aborted rebase on 2026-10-15, met again on #263 and #264 on 2026-10-17). Push only when the new head's tree equals the tested tip's (`git rev-parse <head>^{tree}`).
- Re-review every fix commit, not only the first build. Review fixes regressed #305 (172a4a1 ate the first hover swap) and #307 (a CSS specificity clash lost #301's 50% drag dim) on 2026-10-19.
- Run every check, build and Playwright run in the foreground, and read its output. An agent that waits on a background run's notice stalls: it happened four times by 2026-10-19, and the notice never came. Put this in every dispatch. The one exception is the full e2e suite, which takes 20 to 29 minutes and passes the Bash tool's 10-minute foreground limit (2026-10-20): start it in the background with its log ending in the `EXIT=` line, then poll the log for that line (`grep EXIT= <log>` with a sleep between tries) and never wait on the notice.
- Run CI locally, because GitHub Actions cannot run (Shane, 2026-10-17). The route is `pnpm ci:local`, the Electron dist check, then `lockf /tmp/jira-mgr-e2e.lock pnpm e2e --workers=1`, as in [git workflow](docs/standards/git-workflow.md#local-ci). Take that one shared path for every e2e run in every worktree and name it in each dispatch: parallel runs starve Electron and time out 5 to 25 tests in `beforeEach`, and a builder without the lock lost two full runs on 2026-10-12. Run it on the head you push, read the pass and fail counts, and record them in the pull request. End each logged check with its exit code, `<command> 2>&1 | tee <log>; echo "EXIT=${pipestatus[1]}" | tee -a <log>`: a `tee` log holds none, and the claim-check hook refuses PR and comment text that cites a result the log does not show (met twice, differently: a count the session had not printed on 2026-10-16, "exit 0" against a log with no exit code on 2026-10-19). A documentation-only change skips the dist check and e2e ([definition](docs/standards/git-workflow.md#local-ci)). Do not wait on `gh run` or `gh pr checks`: the workflow runs by manual dispatch only.
- Write each `gh issue create|edit|comment` and `gh pr create|edit|comment` `--body` as a literal string or a quoted heredoc. The guard refuses a shell variable or a `$(...)` such as `$(git rev-parse ...)` inside it (met 2026-10-19 in a loop and 2026-10-20 with one command, a retry each): resolve the value first and paste it.
- Push from the story's worktree with a literal path, `cd /abs/worktree && git push`. The commit guard reads the session's working directory and refuses a push made from the main tree while `main` is checked out (met 2026-10-16 and 2026-10-19).
- Check `gh api repos/{owner}/{repo}/issues/<n>/comments` and `git log origin/<branch>` before you act on an agent's report or resend a message. A report and an instruction cross (2026-10-19, and twice on 2026-10-21, a verdict comment among them), and a reviewer's "posted" can precede the claim-check hook's refusal.
- Finish against the [definition of done](docs/standards/code-review.md#definition-of-done). Merge only when the local route passes on the pushed head, with its counts in the pull request, and a reviewer other than the builder approves.

## Ask First

- Changing a public contract: CLI `--json` output, exit codes, `jm help --json`, the saved views file, the settings file shape or the error codes.
- Adding a runtime dependency, a workspace package or a top-level folder.
- Changing authentication or token handling.
- A decision that is hard to reverse, surprising without context and the result of a real trade-off: it needs an ADR in `docs/adr/`.

## Never

- Write to Jira from a test, or point a test at any project but PSAPAC with read-only calls.
- Commit, print or log the Jira API token. It lives only in the app's own macOS Keychain item.
- Edit an accepted ADR. Supersede it with a new one.
- Commit secrets, or push to `main`.
- Delete a file you did not create. Keep temporary files in your own scratch folder (a reviewer deleted `/tmp/x` on 2026-10-19).
- Import across packages by relative path; import by package name.

## Generated Files

Regenerate these; never edit them by hand:

| File | Regenerate with |
|---|---|
| `pnpm-lock.yaml` | `pnpm install` |
| `docs/reference/cli.md` | `pnpm docs:reference`, which runs `scripts/gen-reference.ts` |
| `docs/reference/errors.md` | `pnpm docs:reference` |

## Commands

Root `package.json` scripts are the source of truth.

| Command | Does |
|---|---|
| `pnpm install` | Installs dependencies from the lockfile |
| `pnpm build` | Builds every package and app |
| `pnpm dev` | Runs the desktop app in development |
| `pnpm typecheck` | Type-checks the workspace |
| `pnpm lint` | Runs Oxlint with type-aware rules |
| `pnpm format` | Formats with Prettier |
| `pnpm format:check` | Checks formatting without writing |
| `pnpm test` | Runs the Vitest suites against the MSW fake |
| `pnpm test:live` | Runs the read-only PSAPAC tests. Needs `JM_LIVE_JIRA=1` and a stored token |
| `pnpm e2e` | Runs the Playwright Electron tests in `e2e/` |
| `pnpm -s jm -- <args>` | Runs the built CLI |
| `pnpm docs:reference` | Builds the CLI and regenerates `docs/reference/cli.md` and `errors.md` |
