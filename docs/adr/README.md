# Architecture Decisions

| Number | Title | Status | Date |
|---|---|---|---|
| [0001](0001-shared-core-monorepo.md) | Shared Core in One TypeScript Monorepo | accepted | 2026-10-07 |
| [0002](0002-live-fetch-without-replica.md) | Live Jira Fetch Without a Local Replica | accepted | 2026-10-07 |
| [0003](0003-token-in-own-keychain-item.md) | API Token in a Keychain Item of Our Own | accepted | 2026-10-07 |
| [0004](0004-custom-fields-resolved-by-name.md) | Custom Fields Resolved by Name | accepted | 2026-10-07 |
| [0005](0005-tiptap-editor-with-adf-round-trip.md) | TipTap Editor With ADF Round-Trip | accepted | 2026-10-07 |
| [0006](0006-adopt-oxlint-keep-prettier-and-vite.md) | Adopt Oxlint, Keep Prettier and Vite | accepted | 2026-10-20 |

## Adding a Record

Copy [template.md](template.md) to the next free number, `NNNN-kebab-case-title.md`, and add a row here. Write one only for a decision that is hard to reverse, surprising without context, and the result of a real trade-off.

## Statuses

| Status | Means |
|---|---|
| `proposed` | Under discussion, not yet binding |
| `accepted` | In force |
| `rejected` | Considered and declined, kept so nobody proposes it again unaware |
| `deprecated` | No longer in force, with nothing replacing it |
| `superseded by ADR-NNNN` | Replaced by a later record |

An accepted record is immutable. To change a decision, write a new record that supersedes it, then change only the old record's `status` line. Both stay in the log, and the index above lists both.
