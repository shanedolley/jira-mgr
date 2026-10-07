# Naming

| Thing | Convention | Example |
|---|---|---|
| Files and folders | `kebab-case` | `issue-tree.ts`, `issue-card.tsx` |
| Test files | Source name plus `.test`, `.int.test` or `.live.test` | `issue-tree.test.ts` |
| Types, interfaces, React components | `PascalCase` | `IssueCard`, `SavedView` |
| Functions and variables | `camelCase` | `resolveFields` |
| Constants that never change | `SCREAMING_SNAKE_CASE` | `MAX_ATTACHMENT_BYTES` |
| Workspace packages | `@jira-mgr/<name>` | `@jira-mgr/core` |
| Environment variables | `JM_` prefix | `JM_DEBUG`, `JM_LIVE_JIRA` |
| Error codes | `snake_case` | `issue_not_found` |
| CLI binary | `jm` | `jm` |
| CLI commands | `jm <noun> <verb>`, singular nouns | `jm issue create` |
| CLI flags | `--kebab-case` | `--with-subtasks` |
| Branches | `<type>/<issue>-<slug>` | `feat/12-issue-tree` |

Use the domain's words everywhere: the type, the command and the docs all say `issue`, never `ticket` in one place and `task` in another. [CONTEXT.md](../../CONTEXT.md) lists the terms and the words to avoid.
