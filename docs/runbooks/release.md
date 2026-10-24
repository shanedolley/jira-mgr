# Release a Version

**Use when:** a set of merged work is ready to ship to end users as a new version.

**Severity:** none until you publish. The draft release is invisible to everyone but you.

Every package carries one version, and a release is a GitHub Release with the notarised app attached as `jira-task-manager-<version>-arm64.zip`, which [Download a Release](../how-to/install-desktop-app.md#download-a-release) tells users to fetch. Shane signs and notarises.

## Check

1. `git switch main && git pull --ff-only`, then `git status --short` prints nothing.
2. Every merged pull request since the last tag carries a type label: `enhancement`, `bug` or `documentation`. [`.github/release.yml`](../../.github/release.yml) groups the generated notes by it. An unlabelled pull request lands under "Other changes".
3. Pick the next version `x.y.z`. After the first release, note the previous tag with `git describe --tags --abbrev=0`. The first release has no previous tag.

## Fix

1. In one pull request, set `"version"` to `x.y.z` in every `package.json` (`apps/cli`, `apps/desktop`, `packages/core`, `packages/config-lint`, `packages/config-ts`, `e2e`) and in the example in `apps/cli/src/schema.ts`. Add the version's section to [`CHANGELOG.md`](../../CHANGELOG.md). Run `pnpm docs:reference`, then merge per [git workflow](../standards/git-workflow.md).
2. On `main` at the merge commit, run `pnpm package`. It writes `apps/desktop/dist/Jira Task Manager.app`, signed ad hoc.
3. Sign and notarise the app, then staple it, per [Share with Another Mac](../how-to/install-desktop-app.md#share-with-another-mac). This step needs Shane's Developer ID identity and the `jira-mgr-notary` Keychain profile.
4. Zip the stapled app: `ditto -c -k --keepParent "Jira Task Manager.app" jira-task-manager-<version>-arm64.zip`.
5. Tag the merge commit and push the tag: `git tag vx.y.z <merge commit>`, then `git push origin vx.y.z`.
6. Create the draft: `gh release create vx.y.z jira-task-manager-<version>-arm64.zip --draft --generate-notes --notes-start-tag <previous tag> --title vx.y.z`. On the first release, omit `--notes-start-tag` and pass `--notes-file <file>` in place of `--generate-notes`. To publish the version's `CHANGELOG.md` section, or hand-written notes, pass `--notes-file <file>` in place of `--generate-notes`; for the changelog, the file holds the section's body without its `## [x.y.z] - date` heading, since the release title already names the version.
7. Shane reviews the draft and publishes it.

## Verify

1. `spctl --assess --type execute -vv "Jira Task Manager.app"` prints `source=Notarized Developer ID`.
2. `/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "Jira Task Manager.app/Contents/Info.plist"` prints `x.y.z`.
3. `pnpm build`, then `pnpm -s jm -- --version` prints `x.y.z`. `pnpm package` builds only the desktop app, so the CLI's `dist` is stale until `pnpm build` runs.
4. The draft release lists the zip and the grouped notes.

## Follow Up

- Delete the local zip and the unzipped app once the release is published.
- A tag that points at the wrong commit: `git push origin --delete vx.y.z`, delete the draft, and tag again.
