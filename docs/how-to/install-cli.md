# Install the CLI

Build `jm` and put it on your PATH with `npm link`. The CLI reads the same state folder and Keychain item as the desktop app.

## Link

```
pnpm install --frozen-lockfile
pnpm build
cd apps/cli && npm link
jm --version
```

`npm link` points `jm` at the built `apps/cli/dist/index.js`. Rebuild with `pnpm build` after pulling changes; the link needs no repeat.

## Unlink

```
cd apps/cli && npm unlink -g @jira-mgr/cli
```

## First Use

`jm auth login` stores the API token in the Keychain. [CLI reference](../reference/cli.md) lists every command.
