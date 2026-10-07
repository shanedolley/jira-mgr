---
status: accepted
date: 2026-10-07
deciders: Shane Dolley
---

# Live Jira Fetch Without a Local Replica

Linear feels instant because it keeps a local replica and syncs in the background. jira-mgr instead reads Jira live: TanStack Query caches responses in memory, refetches on window focus, and applies edits optimistically before Jira confirms them. Offline sync and conflict resolution would be a project of their own, and optimistic updates give most of the speed. PSAPAC holds about 2800 issues, about 760 unresolved, small enough to load on each launch: unresolved issues first, then Done issues in the background, paging `/rest/api/3/search/jql` by token. Source: [discovery](../discovery/2026-10-07-product-grilling.md) Q7.

## Considered Options

1. **Local SQLite replica with background sync and offline edits** - instant reads and offline work, at the cost of a sync engine, a schema mirroring Jira's, and conflict rules for edits made in Jira's own UI meanwhile.

## Consequences

- Nothing works offline. A failed write rolls back its optimistic update and reports the error, and nothing queues writes for later.
- Every launch and every `jm` invocation fetches from Jira, since the CLI process holds no cache between runs. Jira Cloud rate limits apply to both, so `core` must honour `429` and `Retry-After`.
- `/rest/api/3/search/jql` returns no total, so the background load cannot show a percentage, only a running count.
- Jira's issue edit has no version check. A write, including an undo that writes the previous value back, silently overwrites a change someone made after the app last fetched.
- If PSAPAC grows far past its current size, revisit with a persistent read cache before a full replica.
