# Install the Desktop App

Download a signed release, or build the app on your Mac. The app never updates itself: install a newer release, or rebuild and copy again, to upgrade.

## Download a Release

Needs an Apple silicon Mac on macOS 13 or later.

1. Download `jira-mgr-<version>-arm64.zip` from the [releases page](https://github.com/shanedolley/jira-mgr/releases).
2. Unzip it and move `jira-mgr.app` to `/Applications/` (or `~/Applications/` for yourself only).
3. Open it from Finder or Spotlight. The release is signed and notarised, so Gatekeeper opens it with no prompt.

To upgrade, quit the app and move a newer release over the old one.

## Build

```
pnpm install --frozen-lockfile
pnpm package
```

`pnpm package` builds the desktop app and writes `apps/desktop/dist/jira-mgr.app` (about 290 MB, mostly Electron). The first run downloads Electron if it is not cached. The script fails when the app holds the e2e entry, fake Jira code or a `require` it cannot satisfy.

macOS only. The script uses `ditto`, `PlistBuddy` and `codesign`.

The app's icon is `apps/desktop/build/icon.icns`, built from `apps/desktop/build/icon.svg`. After editing the SVG, run `pnpm icon` and commit the SVG, `icon.png` and `icon.icns` together.

## Install

```
cp -R apps/desktop/dist/jira-mgr.app /Applications/
```

Use `~/Applications/` to install for yourself only. To upgrade, quit the app, run `pnpm package` and copy again over the old one.

## First Launch

Open it from Finder or Spotlight. A downloaded release is notarised and opens with no prompt. A locally built app carries no quarantine flag, so Gatekeeper does not check it and no prompt appears. The build signs the app ad hoc, with no identity, which is what lets it run on Apple silicon.

If you copy an ad hoc build from another Mac, macOS quarantines it and refuses to open it. Right-click the app, choose Open, then Open again; or clear the flag:

```
xattr -dr com.apple.quarantine /Applications/jira-mgr.app
```

The login screen asks for the Jira site, project key, email and API token. The site starts as `https://engineering-collibra.atlassian.net` unless the app already saved one, and you can change it. **Create new token →** under the token field opens Atlassian's API token page in your default browser.

## Share with Another Mac

`pnpm package` signs ad hoc, so a copy opens on another Mac only through the quarantine steps above. For a copy that opens without a prompt, sign and notarise it by hand. This needs an Apple silicon Mac on macOS 13 or later, a "Developer ID Application" identity in your Keychain and an app-specific password for your Apple ID.

1. Save the entitlements as `entitlements.plist`:

   ```
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>com.apple.security.cs.allow-jit</key><true/>
     <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
     <key>com.apple.security.cs.disable-library-validation</key><true/>
   </dict>
   </plist>
   ```

2. Sign inside-out, every time with `codesign --force --options runtime --timestamp --sign "<identity>"`: the dylibs under `Electron Framework.framework/Libraries`, `chrome_crashpad_handler`, Squirrel's `ShipIt`, each `.framework`, then each helper `.app` and the main app, those with `--entitlements entitlements.plist`.
3. Zip the signed app: `ditto -c -k --keepParent jira-mgr.app submit.zip`.
4. Store the credentials once: `xcrun notarytool store-credentials <profile> --apple-id <Apple ID> --team-id <team id>`, with the app-specific password when it asks.
5. Submit: `xcrun notarytool submit submit.zip --keychain-profile <profile> --wait`. A 403 "A required agreement is missing or has expired" means the Account Holder must accept the updated Developer Program License Agreement at developer.apple.com/account.
6. Staple and check: `xcrun stapler staple jira-mgr.app`, then `spctl --assess --type execute -vv jira-mgr.app`, which prints `source=Notarized Developer ID`.
7. Zip the stapled app again with `ditto` and send that zip.

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

See [Install the CLI](install-cli.md).
