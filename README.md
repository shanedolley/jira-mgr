# jira-mgr

jira-mgr is a Linear-style desktop app and an agent-friendly command line for one Jira project, PSAPAC on `engineering-collibra.atlassian.net`. The app groups issues by Customer and Epic, opens issues as full pages, and answers to single-key shortcuts. A timer logs worklogs from elapsed time, started with `T` in the app or `jm timer start`. The `jm` command offers the same operations to people and agents, with JSON output when piped.

The Electron app and the CLI share one TypeScript core that holds the Jira client and the domain rules. Both call Jira directly: there is no server and no local replica.

## Status

The Core, CLI and Desktop milestones are built: every `jm` command works, and the app covers the shell, issue tree, issue page, create and delete, keyboard, saved views, packaging, the description editor, activity, the timer, click-to-edit summary, issue type icons and profile images (see the [roadmap](docs/product/roadmap.md)). The decisions are in the [product grilling](docs/discovery/2026-10-07-product-grilling.md) and the [ADRs](docs/adr/README.md). A UX review and a Linear gap analysis filed the follow-up stories #126 to #151 ([review decisions](docs/discovery/2026-10-10-review-decisions.md)). The app has since gained field contrast, keyboard basics, toolbar pickers, the `?` shortcut list, a page type scale, status glyphs, the dialog scrim and login screen, the create chip strip with a description and attachments, toasts with pending edits, the properties sidebar, one button system, Jira text search and issue actions in the palette, quick actions in the Tree, more filters, Tree row properties and ordering, blocked and blocking pills, sub-issues from the issue page, saved views that update, duplicate and reorder, an Inbox, a Sprint page, Epic progress with an Epics table and a Customers page, and a layout that fits narrow windows. Selecting and editing several issues at once (#143) is the one story still to build. Work is tracked in GitHub issues on [shanedolley/jira-mgr](https://github.com/shanedolley/jira-mgr).

## Stack

TypeScript on Node 24 in a pnpm monorepo. Electron with electron-vite, React, Tailwind and TanStack Query for the app. Commander and tsup for the CLI. Vitest and Playwright for tests. macOS only, built locally and unsigned.

## Commands

```
pnpm install
pnpm dev          # desktop app in development
pnpm build
pnpm test
pnpm -s jm -- --help # the built CLI
```

[AGENTS.md](AGENTS.md) lists every root script.

## Repository Map

| Path | Holds |
|---|---|
| `apps/desktop/` | The Electron app, renderer included |
| `apps/cli/` | The `jm` command |
| `packages/` | Shared code: `core`, `config-ts`, `config-lint` |
| `e2e/` | End-to-end tests |
| `scripts/` | Repository automation |
| `docs/` | Architecture, ADRs, standards, tutorials, how-to guides, reference |

[ARCHITECTURE.md](ARCHITECTURE.md) maps every folder to its purpose.

## Documentation

- [Documentation index](docs/README.md)
- [Standards](docs/standards/README.md), starting with the [git workflow](docs/standards/git-workflow.md) and [code review](docs/standards/code-review.md)
- [Domain terms](CONTEXT.md)
- [Contributing](CONTRIBUTING.md), and [AGENTS.md](AGENTS.md) for agent contributors
- [Security](SECURITY.md)

## Licence

Proprietary. Copyright 2026 Shane Dolley. All rights reserved. See [LICENSE](LICENSE).
