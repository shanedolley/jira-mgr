# Security

How jira-mgr protects the Jira API token and the data it reads. The token lives in a macOS Keychain item of the app's own. Report a vulnerability as described in [SECURITY.md](../../SECURITY.md).

`.gitignore` excludes `.env` files, and review checks every diff for secrets. Test fixtures hold recorded PSAPAC responses as recorded, with no scrubbing. A recording saves response bodies only, never request headers, so tokens never reach a fixture.

These pages are not written yet; [#101](https://github.com/shanedolley/jira-mgr/issues/101) tracks them.

| Document | Holds | Planned for |
|---|---|---|
| `threat-model.md` | Assets, trust boundaries and threats: a leaked token, a token in a log or fixture, an over-scoped token, Electron renderer isolation, malicious ADF content; each mapped to its control | Core |
