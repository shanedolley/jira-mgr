# Security

## Reporting

Report a suspected vulnerability privately to Shane Dolley (@shanedolley on GitHub), never in an issue, pull request or chat channel. Include what you found, how to reproduce it, and what data it exposes.

## Secrets

- Commit no secrets. `.env` files are ignored; commit `.env.example` with placeholder values.
- The Jira API token lives only in a macOS Keychain item of the app's own. It never appears in a file, a log, an error message, a test fixture or a command line.
- Recorded Jira responses used as test fixtures are committed as recorded, since the repository is approved to hold PSAPAC data. A recording saves response bodies only, never request headers, so tokens never reach a fixture.
- A secret committed by mistake is compromised: revoke the Jira token first, then remove it from history. `docs/runbooks/rotate-jira-token.md` holds the steps once written.

## Supported Versions

Security fixes go into the latest release of the app and the CLI.

The threat model and controls live in [docs/security](docs/security/README.md).
