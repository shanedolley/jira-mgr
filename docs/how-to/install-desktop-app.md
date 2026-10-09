# Install the Desktop App

Build the app on your Mac, copy it to Applications and open it. The app is unsigned, never downloaded and never updated: rebuild and copy again to upgrade.

## Build

```
pnpm install --frozen-lockfile
pnpm package
```

`pnpm package` builds the desktop app and writes `apps/desktop/dist/jira-mgr.app` (about 290 MB, mostly Electron). The first run downloads Electron if it is not cached. The script fails when the app holds the e2e entry, fake Jira code or a `require` it cannot satisfy.

macOS only. The script uses `ditto`, `PlistBuddy` and `codesign`.

## Install

```
cp -R apps/desktop/dist/jira-mgr.app /Applications/
```

Use `~/Applications/` to install for yourself only. To upgrade, quit the app, run `pnpm package` and copy again over the old one.

## First Launch

Open it from Finder or Spotlight. A locally built app carries no quarantine flag, so Gatekeeper does not check it and no prompt appears. The build signs the app ad hoc, with no identity, which is what lets it run on Apple silicon.

If you copy the app from another Mac or a download, macOS quarantines it and refuses to open it. Right-click the app, choose Open, then Open again; or clear the flag:

```
xattr -dr com.apple.quarantine /Applications/jira-mgr.app
```

The login screen asks for the Jira site, project key, email and API token.

## Where Things Live

| What | Where |
|---|---|
| Settings, saved views and timer | `~/Library/Application Support/jira-mgr/` |
| API token | Keychain item with service `jira-mgr`, written through `/usr/bin/security` ([ADR-0003](../adr/0003-token-in-own-keychain-item.md)) |

The app and the CLI share both. Because the token goes through Apple's `security` tool and not the app's own signature, a rebuilt and reinstalled app raises no Keychain prompt.

## Uninstall

```
rm -rf /Applications/jira-mgr.app
rm -rf "$HOME/Library/Application Support/jira-mgr"
security delete-generic-password -s jira-mgr
```

The last two remove your settings and token. Skip them to keep the CLI working.

## Install the CLI

```
pnpm build
cd apps/cli && npm link
jm --version
```

`npm link` puts `jm` on your PATH from the built `apps/cli/dist/index.js`. Rebuild after pulling changes.
