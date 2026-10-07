---
status: accepted
date: 2026-10-07
deciders: Shane Dolley
---

# Shared Core in One TypeScript Monorepo

jira-mgr has two front ends over one Jira project: an Electron app and the `jm` CLI, which agents run while the app is closed. We keep both in one pnpm monorepo, and both import `@jira-mgr/core` (`packages/core`), which holds the Jira client and the domain rules, such as "Customer and Engagement are required". The Electron main process and the CLI each call Jira directly, so neither depends on the other running, and both enforce the same rules because only one copy exists. Source: [discovery](../discovery/2026-10-07-product-grilling.md) Q2, Q25.

## Considered Options

1. **CLI talks to the running app over a local socket** - one Jira client process and one cache, but `jm` fails whenever the app is closed, which is when agents most often run it.
2. **Two separate codebases** - each front end free to evolve, at the cost of writing every domain rule twice and watching the copies drift.

## Consequences

- `@jira-mgr/core` runs in plain Node. It must never import Electron, the DOM or React.
- The renderer never calls Jira. It reaches `core` through the main process over IPC, so the API token stays out of the renderer.
- The app and an agent's `jm` can edit the same issue at once with no shared cache. The app sees the agent's change only on its next refetch ([ADR-0002](0002-live-fetch-without-replica.md)).
- State both front ends share, such as saved views and field overrides, lives in local files both read, not in either process.
