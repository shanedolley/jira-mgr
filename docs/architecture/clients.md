# Clients

Core owns every Jira call and domain rule. Each client owns how a person or an agent reaches them. A rule both clients need goes in core ([ADR-0001](../adr/0001-shared-core-monorepo.md)); a client adds only input, output and presentation.

## Core

`@jira-mgr/core` (`packages/core/src`) runs in plain Node and imports no Electron, DOM or React. It owns:

- The HTTP client: Basic auth, retries of `429` and `503`, status-to-code mapping (`http.ts`).
- Credentials, the Keychain wrapper and field resolution ([auth and Keychain](auth-and-keychain.md)).
- Reads and writes of issues, comments, worklogs, links, attachments and sprints.
- The Tree builder, view filters, timer engine and ADF conversion.
- Typed errors: `JiraMgrError` and the five codes in `errors.ts`.
- The state files in `state.ts`.

Core exposes subpath entries such as `@jira-mgr/core/state` and `@jira-mgr/core/adf`, so the renderer bundle pulls in no `node:` module.

## CLI

`jm` (`apps/cli/src`) is a thin layer over core for people and agents.

| Concern | Where |
|---|---|
| Command definitions, flags, help text, examples and example output | `schema.ts`, the one source for `--help`, `jm help --json` and [the reference](../reference/cli.md) |
| One handler per command: parse input, call core, return data and a terminal rendering | `commands/<noun>/<verb>.ts` |
| Value parsing for flags | `values.ts` |
| Output: tables on a terminal, one JSON envelope when piped or given `--json` | `output.ts`, `run.ts` |
| Exit codes, from the error code | `run.ts` with `EXIT_CODES` from core |
| Prompts, only in `jm auth login` and only on a terminal | `prompt.ts`, `commands/auth/login.ts` |
| Ctrl-C handling | `run.ts`, `context.ts` |

A command that needs no Jira call, such as `jm view list`, never creates a client or reads the Keychain.

## Desktop

The desktop app (`apps/desktop/src`) has three sides ([system overview](system-overview.md#desktop-path)).

| Side | Owns |
|---|---|
| `main/` | Window creation and hardening, IPC handlers with zod validation, `backend.ts` as the only caller of core, avatar and image fetching under strict rules, the quit prompt for unsaved drafts |
| `preload/` | The `window.jm` bridge, one function per channel in `shared/ipc.ts` |
| `renderer/` | The Tree, Peek, issue page, pickers, the TipTap editor, the Cmd+K palette, shortcuts, optimistic updates, the issue selection with its bulk bar and undo |

`shared/ipc.ts` is the contract all three sides import. The renderer never calls Jira and never holds the token.

## Shared Behaviour

Both clients call the same core functions for the rules that must not drift:

- `assertInProject` refuses a key outside the configured project.
- `assertTypeChangeAllowed` limits type changes to Story, Task and Bug.
- `buildHierarchy` and the view filters build the same Tree the CLI prints.
- The state files carry saved views and settings between them.
