---
status: accepted
date: 2026-10-07
deciders: Shane Dolley
---

# API Token in a Keychain Item of Our Own

Both front ends need the same Jira API token, and the CLI must read it without the app running ([ADR-0001](0001-shared-core-monorepo.md)). We store it in a macOS Keychain item owned by jira-mgr. The app's login screen and `jm auth login` both write that item, and both read it. Login asks for site URL, project key, email and API token, and only the token goes in the Keychain. Source: [discovery](../discovery/2026-10-07-product-grilling.md) Q1, Q26.

## Considered Options

1. **Electron `safeStorage`** - the app's natural choice, but it decrypts only inside Electron, so the CLI could not read the token.
2. **Reuse kothar's `kothar-jira-collibra` item** - one token and one rotation point, but it couples jira-mgr to kothar's setup and to Collibra, which a login that asks for site and project should not assume.
3. **OAuth 3LO** - no long-lived token on disk, at the cost of registering an Atlassian app and running a browser flow and token refresh in both front ends.
4. **Token in an environment variable for the CLI** - simple for scripts, but it splits storage in two and leaves the token in shell profiles.

## Consequences

- jira-mgr runs only on macOS, the CLI included. A Linux agent cannot run `jm` without a second store.
- Rotating the token means logging in again in either front end, and the other picks it up from the shared item.
- Both processes reach the Keychain through Apple's signed `/usr/bin/security`, so the item's access rule names a binary that never changes and app rebuilds raise no prompt. Reads use `find-generic-password -w`, which prints the token on stdout. Writes send `add-generic-password -U` to `security -i` on stdin, which keeps the token off the command line and out of the process list. A native Keychain module was rejected: an unsigned Electron binary changes identity on each rebuild, so macOS would ask for access again.
