# Getting Started

In this lesson you build `jm`, log in to Jira and list your issues. You need a Mac, because the token goes into the macOS Keychain, and a Jira API token for your Atlassian account.

## Check Node and pnpm

jira-mgr needs Node 24. Check your version:

```
node --version
```

If it shows an older release, install Node 24 and switch to it, for example with `nvm install 24 && nvm use 24`. The repository's `.nvmrc` names the version.

Check pnpm:

```
pnpm --version
```

The repository pins pnpm 10 in `package.json`. Install pnpm 10 if the command is missing.

## Build

From the repository root:

```
pnpm install --frozen-lockfile
pnpm build
```

Confirm the CLI runs:

```
pnpm jm -- --version
pnpm jm -- --help
```

`pnpm jm` runs the built binary at `apps/cli/dist/index.js`. The `--` separates pnpm's arguments from `jm`'s. To type `jm` alone, follow [Install the CLI](../how-to/install-cli.md).

## Log In

Create an API token in your Atlassian account's security settings, then run:

```
pnpm jm -- auth login
```

`jm` asks for the site URL (`https://<name>.atlassian.net`), the project key, your email and the token. The token prompt hides what you type. `jm` checks the credentials against Jira and works out the project's custom field ids. Only then does it store anything: the token in a Keychain item named `jira-mgr`, the rest in `~/Library/Application Support/jira-mgr/`.

Check the result:

```
pnpm jm -- auth status
```

It prints the site, project, your name and when the fields were resolved.

## List Issues

```
pnpm jm -- issue list --mine --limit 5
```

On a terminal you get a table of up to five open issues assigned to you. Group the same issues by Customer and Epic:

```
pnpm jm -- issue tree --mine
```

Read one issue in full, using a key from the table:

```
pnpm jm -- issue get <key>
```

## Next

- [First agent session](first-agent-session.md) runs the same commands the way an agent does.
- [CLI reference](../reference/cli.md) lists every command.
- If a command fails, [Token rejected](../runbooks/token-rejected.md) covers the common cause.
