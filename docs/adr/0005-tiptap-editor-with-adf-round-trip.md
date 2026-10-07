---
status: accepted
date: 2026-10-07
deciders: Shane Dolley
---

# TipTap Editor With ADF Round-Trip

Jira stores descriptions and comments as ADF (Atlassian Document Format), a JSON document tree. We edit them in a TipTap (ProseMirror) editor with Linear-style markdown shortcuts, converting ADF to the editor's document on load and back on save. The editor supports headings, lists, code, links, quotes and inline images. Every ADF node outside that set, such as panels, macros and tables, loads as a read-only block that keeps the original ADF and writes it back unchanged, so editing one paragraph never destroys content the editor cannot show. Source: [discovery](../discovery/2026-10-07-product-grilling.md) Q8.

## Considered Options

1. **Markdown textarea converted to ADF on save** - the smallest build, but markdown cannot express panels or macros, so the first save would strip them from the issue.
2. **Full ADF parity, @mentions and panels included** - edits everything Jira can, at the cost of rebuilding a large part of Jira's own editor, and macros render server-side anyway.

## Consequences

- The ADF converter is the riskiest code in the editor. Test it against descriptions and comments recorded from PSAPAC, asserting that a load and save with no edits returns the same ADF.
- Users cannot edit inside a read-only block. They can delete or move it, or edit it in Jira.
- Existing @mentions in Jira content load as read-only inline nodes, since writing mentions stays out of v1.
- Each node type promoted from read-only to editable needs both directions of the converter and its own round-trip test.
