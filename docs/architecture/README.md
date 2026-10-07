# Architecture

jira-mgr is a Linear-style desktop app and an agent-friendly CLI over one Jira project. One shared TypeScript core holds the Jira client and the domain rules, and both clients call Jira directly with live fetches.

Planned pages:

| File | Covers | Written in |
|---|---|---|
| `system-overview.md` | Components, request paths and the monorepo layout | Core |
| `data-model.md` | The Jira entities as core consumes them: issue types, custom fields, links, sprints | Core |
| `clients.md` | Core, the CLI and the desktop app: what each owns | CLI |
| `auth-and-keychain.md` | Login, the Keychain item, field resolution and the settings file | Core |
| `documents-and-editor.md` | The TipTap editor and the ADF round trip | Desktop |

Decisions sit in [docs/adr](../adr/README.md), and the grilling that produced them sits in [docs/discovery](../discovery/README.md). Each file here links the ADRs it rests on. Domain terms live in [CONTEXT.md](../../CONTEXT.md).

## Principles

- **One core, two clients.** Anything the app can do, the CLI can do too, through the same `@jira-mgr/core`.
- **Jira is the store.** Clients fetch live, cache in memory and keep no local replica.
- **Resolve fields by name.** Customer, Engagement, Sprint and Start date have different ids per site, so core looks them up and caches the ids.
- **One timer, one state file.** The app and `jm timer` share a state file in the app's config folder, so either can stop what the other started.
- **The token stays in the Keychain.** One item of the app's own, read by both clients.
- **Round-trip Jira's rich text.** The editor converts to and from ADF, and keeps what it cannot represent as read-only blocks.

## Out of Scope

These stay out of version 1: board view, sprint lifecycle, offline edits, a macOS menu bar timer item, general desktop notifications (timer reminders are in v1), @mentions, code signing and auto-update, issue restriction, watchers, issue history, story points, flagged, fix versions, Team, Partner, Contacts and reporter. The grilling record lists the reasons.

## Open Questions

Each file marks its open questions in place with **Open:**. Run `grep -rn "Open:" docs/architecture` to list them.
