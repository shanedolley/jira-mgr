# Contributing

1. Clone [shanedolley/jira-mgr](https://github.com/shanedolley/jira-mgr), use Node 24 (`nvm use`), and run `pnpm install`. The CLI exists; [Install the CLI](docs/how-to/install-cli.md) builds it, and `docs/tutorials/getting-started.md` is planned.
2. Branch from `main` as `<type>/<issue>-<slug>`.
3. Make one small change, with its tests and docs, following the [standards](docs/standards/README.md) and the terms in [CONTEXT.md](CONTEXT.md).
4. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test`. Run `pnpm e2e` when the change touches the CLI or the app.
5. Commit in Conventional Commits form, ending with `Refs #<number>`.
6. Open a pull request and fill in the template. A pull request stands on its own: summarise any Jira or chat context rather than only linking it.
7. Meet the [definition of done](docs/standards/code-review.md#definition-of-done). Comments marked `Nit:` are optional.
8. Squash-merge once CI passes and a reviewer other than the builder approves.

Agents start from [AGENTS.md](AGENTS.md).
