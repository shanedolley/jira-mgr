# Documents and Editor

Jira stores descriptions and comments as ADF, a JSON document tree. The app edits them in TipTap and the CLI reads and writes them as Markdown. Both paths keep every node they cannot represent. [ADR-0005](../adr/0005-tiptap-editor-with-adf-round-trip.md) records the decision, and [design 0003](../design/0003-editor.md) holds the full mapping.

## Converters

All converters live in core and are reachable at `@jira-mgr/core/adf` (`packages/core/src/adf.ts`).

| Function | Direction | Used by |
|---|---|---|
| `adfToEditor`, `editorToAdf` | ADF to and from ProseMirror JSON | The desktop editor |
| `adfToMarkdown`, `markdownToAdf` | ADF to and from Markdown | The CLI (`jm issue get`, `edit`, `create`, comments) |
| `equivalentAdf`, `sameAdf` | Compare two documents, blind to key order | Both |

The editor converters import nothing from TipTap, so core gains no dependency. A document nested past the stack throws `validation_failed` in both directions.

## Round Trip

The editor models headings, lists, code, links, quotes, rules, the basic marks and inline images. Everything else becomes a read-only node that holds the original ADF:

- A block such as a panel, table, macro or expand becomes `adfBlock`.
- An inline node such as a mention, emoji, date or status becomes `adfInline`.
- A mark the editor lacks, such as text colour, becomes `adfMark`.

`editorToAdf` writes these back untouched. Each converted top-level block also converts back and must equal its input (`equivalentAdf`), or the whole block turns into one read-only block. Loading a description and saving it with no edit therefore returns equivalent ADF. `packages/core/src/adf-editor.test.ts` checks this against every description and comment recorded in `packages/core/fixtures/adf-*.json`.

Markdown cannot say everything ADF can. `adfToMarkdown` writes what Markdown lacks as `adf` fences and `<adf-node>` tags, and `markdownToAdf` reads them back, so a Markdown round trip also returns the same document.

## Editor

The editor schema is one extension list, `apps/desktop/src/renderer/src/editor/extensions.ts`. `AdfEditor.tsx` adds the React views and runs one TipTap instance for reading and editing.

- A user can select, move or delete a read-only node, never edit inside it. Paste strips raw ADF unless it came from this editor in this session.
- Save is explicit: `Cmd+Enter` saves and `Esc` cancels. Nothing autosaves.
- A draft survives leaving the issue page and is lost on logout or quit. The app asks before it quits with one (`apps/desktop/src/renderer/src/drafts.ts`).
- If TipTap refuses a document, the section shows it read-only with no Edit button, so the editor never saves a mangled document.

## Saving

`issues:setDescription` carries the edited document and the document the edit began from. Main reads the issue and compares its description with that base (`backend.ts`). A match writes through `editIssue`. A mismatch writes nothing and returns Jira's current description, so the user can reconcile. Jira has no conditional write, so a change landing between the read and the write still loses ([ADR-0002](../adr/0002-live-fetch-without-replica.md)).

## Images

Main handles every image, so the token stays out of the renderer:

- A dropped or pasted PNG, JPEG, GIF or WebP uploads as an attachment on drop, then embeds as an inline `mediaSingle`. Main checks the file's magic bytes against its claimed type. The limit is 100 MB (`IMAGE_LIMIT_BYTES` in `apps/desktop/src/shared/ipc.ts`).
- An embedded image holds a Media Services id, not the attachment id. Core reads the id from the attachment content redirect (`requestMediaId` in `http.ts`), and main shows previews up to 20 MB (`media.ts`).
