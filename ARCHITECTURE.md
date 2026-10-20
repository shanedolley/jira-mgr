# Architecture

Two clients share one TypeScript core. The Electron main process and the CLI both import `@jira-mgr/core` and call Jira directly. The full explanation, with diagrams and the reasoning, is in [docs/architecture](docs/architecture/README.md); decisions are in [docs/adr](docs/adr/README.md); domain terms are in [CONTEXT.md](CONTEXT.md). The layout follows the one Nisaba uses.

```
clients:  apps/desktop (main + renderer)      apps/cli (jm)
                      \                         /
                       +---- @jira-mgr/core ---+
                                  |
          Jira Cloud REST API (PSAPAC)      macOS Keychain (API token)
```

## Directory Map

| Path | Purpose |
|---|---|
| `apps/desktop/` | The Electron app: main process, preload script, the shared IPC contract and the React renderer, built with electron-vite |
| `apps/cli/` | The `jm` command, built with tsup |
| `packages/core/` | `@jira-mgr/core`: the Jira client, domain rules, saved views schema, error codes and ADF conversion |
| `packages/config-ts/` | `@jira-mgr/config-ts`: base `tsconfig` files |
| `packages/config-lint/` | `@jira-mgr/config-lint`: the Prettier config |
| `e2e/` | End-to-end tests: the Electron app. CLI tests sit in `apps/cli/src/`, including smoke tests of the built binary |
| `scripts/` | Repository automation |
| `docs/` | Documentation, indexed in [docs/README.md](docs/README.md) |

## Boundaries

- Apps depend on packages. Packages never depend on apps.
- Only `@jira-mgr/core` talks to Jira. The CLI and the desktop main process call core; the renderer reaches Jira through the main process.
- Core fetches live, keeps results in memory and holds no local replica ([ADR](docs/adr/README.md)).
- The API token lives in a macOS Keychain item of the app's own, never in a file, a log or a test fixture.
