# 0003: Editor

**Status:** accepted
**Owner:** @shanedolley
**Refs:** #31

## Problem

D3 (#30, merged in #75) shows the description as Markdown text from `adfToMarkdown`, read-only, in `IssuePage.tsx`. Q4 and Q8 ask for an editable description in a TipTap editor with Linear-style markdown shortcuts, converting to and from ADF, with panels, macros and tables kept intact as read-only blocks ([ADR-0005](../adr/0005-tiptap-editor-with-adf-round-trip.md)). Q34 adds that an image dropped into the description is attached to the issue and embedded inline. D5 reuses the same editor for comments, so it must not be tied to the description.

Two facts from the recorded fixtures shape the design. Jira embeds an image as `mediaSingle > media` whose `id` is a Media Services file UUID, not the numeric attachment id (`adf-description-psapac-19.json`, `-1219`, `-550`, `-3017`). The attachment REST responses carry no media id (`issue-attachments-psapac-3017.json`), so neither showing an existing image nor embedding a new one works from the attachment list alone.

## Goals

- Loading a description into the editor and saving it with no edit sends ADF equivalent to what Jira holds, for every ADF document recorded in `packages/core/fixtures`.
- Every node outside the supported set loads as a read-only block or read-only inline node holding the original ADF, and saves byte for byte.
- An image dropped or pasted into the editor uploads as an attachment and saves as an inline `mediaSingle` that Jira renders.
- Existing images in a description show in the app, fetched by the main process. The API token never reaches the renderer.
- A save never overwrites a description someone changed in Jira since the edit began, without asking.
- No unsaved text is lost to a failed save, to opening another issue, or to quitting.
- The editor works fully by keyboard and adds no single-letter shortcut.
- The editor component takes an ADF document and an issue key, nothing description-specific, so D5's comments reuse it.

## Design

### Layout

```
packages/core/src/
  adf-editor.ts           pure: adfToEditor, editorToAdf, equivalentAdf, imageNode
  adf.ts                  re-exports adf-editor.ts and `same` as sameAdf
  http.ts                 RequestOptions.as: 'bytes' | 'mediaId', with maxBytes
  extras.ts               attachmentMediaId, attachmentContent; addAttachments takes a content type
packages/core/fixtures/
  attachment-content-redirect.json   a recorded content redirect, token stripped
packages/core/test/
  adf-fixtures.ts         every recorded ADF document, exported as @jira-mgr/core/test/adf-fixtures
apps/desktop/src/
  shared/ipc.ts           three channels; IMAGE_TYPES, IMAGE_LIMIT_BYTES, PREVIEW_LIMIT_BYTES
  shared/links.ts         pure: which URLs open in the browser, and the URL to open
  main/images.ts          pure: image type by magic bytes; safe upload filenames
  main/backend.ts         setDescription, addImage, image, and the per-issue media index
  main/handlers.ts        schemas for the three channels
  main/app.ts             external links; the quit prompt for unsaved drafts
  main/e2e-fake.ts        attachments, content redirects, held and failing uploads
  renderer/index.html     img-src adds blob:
  renderer/src/
    editor/extensions.ts  the schema-only TipTap extension list, configured to ADF's rules
    editor/readOnly.ts    pure: labels and plain text for read-only nodes
    AdfEditor.tsx         the editor in read and edit modes, node views attached; D5 reuses it
    ReadOnlyBlock.tsx     node view of a read-only block
    ReadOnlyInline.tsx    node view of a read-only inline node
    ImageView.tsx         node view of an image: loading, uploading, failed
    DescriptionEditor.tsx the Description section: Edit, Save, Cancel, conflict
    DiscardDialog.tsx     the in-page alertdialog for discarding a draft
    drafts.ts             unsaved drafts per issue, for the session
    uploads.ts            upload state per uploadId, for the session
    queries.ts            useSetDescription, useAddImage, useAttachmentImage
    optimistic.ts         description-aware patch and rollback
    IssuePage.tsx         uses DescriptionEditor; Esc skips an editable region
```

### Converter

The converter lives in core's renderer-safe `/adf`, in a new `adf-editor.ts`. Core already owns ADF conversion, its schemas and the recorded fixtures, and the converter is JSON in, JSON out: it imports nothing from TipTap or ProseMirror, so core gains no dependency. The editor form is ProseMirror's JSON (`{ type, attrs?, content?, marks?, text? }`), which TipTap loads with `setContent` and returns with `getJSON`. The node names it uses must match the extensions in `editor/extensions.ts`; a desktop test pins that (Testing).

```ts
adfToEditor(doc: AdfDoc, options?: { accepts?: (block: EditorNode) => boolean }): EditorDoc
editorToAdf(doc: EditorDoc): AdfDoc | null
equivalentAdf(a: unknown, b: unknown): boolean
imageNode(file: { mediaId: string; filename: string; width?: number; height?: number }): AdfNode
```

**Mapping.**

| ADF | Editor | Notes |
|---|---|---|
| `doc`, `paragraph`, `text`, `hardBreak` | same names | |
| `heading` (`level`) | `heading` (`level`) | |
| `blockquote`, `bulletList`, `listItem` | same names | |
| `orderedList` (`order`) | `orderedList` (`start`) | |
| `codeBlock` (`language`) | `codeBlock` (`language`) | |
| `rule` | `horizontalRule` | |
| `mediaSingle` holding one `media` of `type: 'file'` | `adfImage`, atom, attr `node` | The raw `mediaSingle`, caption included |
| any other block: `table`, `panel`, `expand`, `mediaGroup`, `layoutSection`, `taskList`, `decisionList`, `extension`, `bodiedExtension`, `blockCard`, `embedCard`, a `mediaSingle` of an external image, unknown types | `adfBlock`, atom, attr `node` | The read-only block |
| any other inline node: `mention`, `emoji`, `date`, `status`, `inlineCard`, `mediaInline`, `placeholder`, `inlineExtension`, unknown types | `adfInline`, atom, attr `node` | |
| marks `strong`, `em`, `strike`, `code`, `underline` | `bold`, `italic`, `strike`, `code`, `underline` | |
| mark `link` (`href`, `title`) | `link` (`href`) | |
| any other mark: `textColor`, `backgroundColor`, `subsup`, `annotation`, unknown types | `adfMark`, attr `mark` | `excludes: ''`, so several sit on one text |

An `inlineCard` stays read-only, since ADR-0005 makes links the `link` mark and a card carries Jira's own preview.

**Attributes TipTap does not model.** Each mapped node and mark carries one extra attribute, `adf`, holding its original ADF `attrs` and, for a block, its block `marks` such as `alignment` and `indentation`. The fixtures hold `localId` on paragraphs, lists and list items, which this keeps. On the way out, the original attrs are written back as they were, and a modelled attribute (`level`, `order`, `language`, `href`) overwrites its original only when the editor changed it. So a list with no `order` keeps none, and one renumbered to start at 3 gets `order: 3`. A node the editor created has no `adf` attribute and gets only the attrs ADF needs: `order` only when the start is not 1, `language` only when set. `editorToAdf` reads only the attributes in this table, so TipTap's own defaults (`target`, `rel` and `class` on a link, a `null` language) never reach ADF.

`adf` is declared with `keepOnSplit: false` and `rendered: false`. Splitting a paragraph therefore never copies its `localId`, and pasted content loses `adf` on mapped nodes through `transformPasted`, so a copy never duplicates one. Read-only atoms keep their raw node in every case.

**Unknown nodes round trip byte for byte.** `adfBlock`, `adfInline` and `adfImage` store the original ADF node in `node`, and `editorToAdf` writes it back untouched. ProseMirror lets a user put a mark such as bold across an atom; `editorToAdf` ignores any mark on the three atoms, so the raw node stays the only truth. They are atoms: the user can select, move or delete one, never edit inside it.

**Self-check per block.** `adfToEditor` converts each top-level block, converts it back, and keeps it only when `equivalentAdf` says the result equals the input. A block that fails becomes one `adfBlock` holding the original, as `adfToMarkdown` writes a block that does not read back as an `adf` fence. This catches what the mapping cannot carry: a text node with a key beyond `type`, `text` and `marks`, an empty `marks` array, a non-object `attrs`. The optional `accepts` runs on each converted block after the self-check, and a block it refuses becomes an `adfBlock` too. The renderer passes a check against its own schema (Loading), so a document the converter maps but ProseMirror refuses still loads, read-only where needed, instead of throwing or losing content. The fallback is always the whole top-level block: a list whose third item fails becomes one read-only list. `adfBlock` therefore never needs to appear in the `listItem` or `blockquote` content rules for a fallback to fit.

**Equivalence.** ProseMirror joins adjacent text nodes with the same marks and orders marks by its schema, so a load and save cannot preserve either. Neither carries meaning in ADF. `equivalentAdf` is deep equality, blind to key order (core's `same`), after joining adjacent text nodes with equal marks, comparing each mark list as a set, and treating a node with no `content` and one with `content: []` as equal. `adfToEditor` joins such text itself, so its output is already in ProseMirror's normal form. No recorded fixture has adjacent equal-mark text; two hold multi-mark text (`link` with `underline`, `em` with `strike`).

**Empty documents.** `editorToAdf` returns `null` for a document holding only one empty paragraph, and the save clears the description, since Jira shows an empty description and no description alike. Dirty tracking uses ProseMirror's `doc.eq` against the document as loaded, so an issue with `content: []` that loads as one empty paragraph is not dirty.

**Uploads are not ADF.** `editorToAdf` throws `validation_failed` for an `adfImage` whose `node` is still `null`, which is an upload in flight or failed. The editor disables Save while one exists, so the throw only guards against a bug.

`refuseDeepNesting` from `adf.ts` wraps both directions, so a document nested past the stack throws `validation_failed`, as the Markdown converters do.

### Editor Schema

`editor/extensions.ts` holds the one extension list the editor, its tests and D5 use. It is schema only: `AdfEditor` adds the React node views with `.extend({ addNodeView })`, so the schema test imports no React and needs no DOM.

- `StarterKit` with `trailingNode: false` (it would append a paragraph after a final table or panel on every load, making each such issue dirty), `link` configured as in Security with `openOnClick: false`, and `listItem` and `blockquote` given ADF's content rules: a list item holds a paragraph, then paragraphs, lists, code blocks and images; a quote holds paragraphs, lists, code blocks and images. A heading, rule or quote cannot sit inside either, so a markdown shortcut there does nothing rather than produce ADF Jira refuses.
- `code` with `excludes: 'bold italic strike underline'`. TipTap's default excludes every other mark, which would strip a link from linked code on the first edit; ADF allows `code` with `link`.
- A global `adf` attribute on every mapped node and mark.
- `adfBlock` (group `block`), `adfImage` (group `block`, attrs `node` and `uploadId`), `adfInline` (inline) and the `adfMark` mark.
- A Save keymap at a higher priority than `HardBreak` and `CodeBlock`: `Mod-Enter` saves and `Escape` cancels. `Shift-Enter` still inserts a line break. `Mod-Enter` no longer leaves a code block; `ArrowDown` at its end, or `Enter` three times, still does.
- One `handleClick` plugin for links (Keyboard and Accessibility).

`adfBlock` may sit wherever a block may, so a nested unknown node loads in place. Dragging one where ADF forbids it is possible; Jira then refuses the save with a 400, and the draft stays in the editor with Jira's message (Save).

**Paste.** `parseHTML` on the three atoms reads the raw node from a `data-adf` attribute, so cut and paste inside the editor keeps them. `transformCopiedHTML` stamps copies made in this editor with `data-jm-clip` set to a random nonce made once per app session. `transformPastedHTML` strips every `data-adf` attribute from HTML that lacks the current nonce, so content copied from another app, or from an earlier session, parses as its plain text; a crafted page cannot slip a raw ADF node into a description. `readAdfAttr` still validates a stamped node with `adfNodeSchema` and `isBlockNode` or `isInlineNode`, and anything else parses to nothing. `transformPasted` also strips `uploadId` (Images). `<img>` tags have no parse rule, so a pasted web page never loads a remote image.

TipTap's `enableContentCheck` is on. If the editor still refuses the content, the section shows the description read-only with "This description cannot be edited here. It is unchanged in Jira." and no Edit button, so the editor never saves a document it mangled.

### Loading

`AdfEditor` takes `{ value: AdfDoc | null, issueKey, label, editing, onSave, onCancel, onDirtyChange }`. It renders one TipTap editor for both modes, toggled with `setEditable`, so the read view shows headings, lists, code, links, images and read-only blocks exactly as editing will. Dirty state and Save's enabled state come from `useEditorState`, so typing does not re-render the page. The `accepts` check it passes to `adfToEditor` is `schema.nodeFromJSON(block).check()`, inside `refuseDeepNesting` and a `try`.

While not editing, a new `value` from a refetch replaces the content. While editing, `value` changes are ignored; the editor keeps the document it started from as its `base`.

Read-only nodes render through React, as text, never as HTML:

| Node | Shows |
|---|---|
| `adfBlock` `table` | A plain table of each cell's text, under a "Table, read-only" label |
| `adfBlock`, any other | A label from `readOnly.ts` (Panel, Expand, Files, Layout, Tasks, Decisions, Jira macro, or the type name) and the block's plain text, one line per paragraph |
| `adfInline` | A mention as a chip with `@` and its text, its account id in the tooltip; the emoji's text or short name; a local date from `timestamp`; a status's text; a card's URL as a link; "Attachment" for `mediaInline`; `[type]` otherwise |

Each read-only node has `contenteditable="false"`, a visible "Read-only" tag on blocks, and an accessible name such as "Panel, read-only. Edit it in Jira."

### Images

**Rendering an existing image.** `ImageView` reads `media.attrs.id`, the media UUID, and calls `useAttachmentImage(issueKey, mediaId)`, query key `['attachments', key, mediaId]`. The query function turns the bytes into an object URL from a `Blob` typed from `IMAGE_TYPES`, never from the response, and caches the URL, not the bytes, with `staleTime: Infinity` and a `gcTime` of one minute. A query-cache subscription revokes the URL when the query is removed. `retry` is off for `not_found` and `validation_failed`.

Main resolves the UUID through a media index per issue, held in the backend and cleared on logout:

1. The index starts from `listAttachments(http, key)`, cached, keeping each attachment's id, `size` and `mimeType`.
2. A lookup resolves image attachments it has not resolved yet, in list order, in batches of 4 through `attachmentMediaId`, and stops at the batch that finds the UUID. Each pair resolved stays cached, so the next image costs nothing or one more batch.
3. A UUID not found after every image attachment is resolved re-reads the list once, since the image may have been added in Jira since. One re-read per issue runs at a time, shared by every waiting lookup, and at most once per 30 seconds. A UUID still missing is cached as missing for 30 seconds and throws `not_found` without a request. An image embedded from another issue lands here.
4. Before fetching, main refuses an attachment whose `mimeType` is not in `IMAGE_TYPES`, or whose `size` is over `PREVIEW_LIMIT_BYTES` (20 MB), with `validation_failed`.
5. `attachmentContent(http, attachmentId, { maxBytes: PREVIEW_LIMIT_BYTES })` returns the bytes. Main checks their magic bytes (`main/images.ts`) against the four types and refuses anything else, whatever Jira's header says.

At most 4 `attachments:image` calls run at once in main; the rest queue.

| `ImageView` state | Shows |
|---|---|
| Loading | The `alt` text in a box sized from the `media` width and height, so the page does not jump |
| Loaded | The image. Width follows `mediaSingle.attrs.width` when `widthType` is `pixel`, otherwise the media width, capped at the column |
| `not_found` | "Image not in this issue's attachments. Open the issue in Jira to see it." |
| `validation_failed` | "Too large to preview, or not an image. Open it in Jira." |
| `permission_denied` | "Jira refused access to this image." |
| `jira_error` | "Could not load this image." with Retry |

**Core additions.** `attachmentMediaId(http, attachmentId)` sends `GET /rest/api/3/attachment/content/{id}` with `as: 'mediaId'` and returns the UUID. `attachmentContent(http, attachmentId, { maxBytes })` sends the same path with `?redirect=false`, which Jira answers with the bytes itself, so the request stays on the site under Basic auth. Both validate the id as digits.

`http.ts` changes, all additive, typed by overloads on `request`, so a test fake implementing `request` keeps compiling:

- `as: 'bytes'`, with a required `maxBytes`. It sends `Accept: */*` and keeps `redirect: 'error'`. A `Content-Length` over `maxBytes` throws `validation_failed` before the body is read. Otherwise it reads the body stream, raced against the timeout and the caller's signal as `readText` is, and aborts and throws `validation_failed` once the bytes read pass `maxBytes`. It resolves `{ contentType, bytes: Uint8Array }`. A non-2xx answer maps as today.
- `as: 'mediaId'`, accepted only for the path `/rest/api/3/attachment/content/<digits>` and refused for any other, so it is no general way to read a redirect. It fetches with `redirect: 'manual'` and cancels the body unread on every status. It handles a 3xx before the `!response.ok` check: the `Location` must parse with `new URL`, use `https:`, name the host `api.media.atlassian.com`, and have a pathname matching `^/file/<uuid>/`. It resolves the UUID alone, so the URL, which carries a short-lived media token, never leaves `http.ts`. A 3xx without such a `Location`, or a 2xx, throws `jira_error` with no `cause` and no `details`, so nothing of the URL reaches a log or a message. Other statuses map as today. `JM_DEBUG` prints the status line as for any request, never the header.

The redirect shape is not documented by Atlassian. `attachment-content-redirect.json` holds a recorded redirect, status and `Location`, with the `token` query parameter stripped, recorded with one live read; the int tests and the e2e fake replay it. A live read-only test pins the shape on real issues (Testing), and an unexpected shape fails loudly with `jira_error` rather than embedding a wrong id.

**Dropping or pasting an image.** The editor's `handleDrop` and `handlePaste` take files whose type is in `IMAGE_TYPES` (`image/png`, `image/jpeg`, `image/gif`, `image/webp`). Any other file is left alone, so D5's page-level drop can attach it. For each image, in order, at the drop point:

1. A file over `IMAGE_LIMIT_BYTES` (100 MB, Q34) is refused before its bytes are read, with an alert naming the file and the limit.
2. The editor inserts an `adfImage` with `node: null` and a new `uploadId`. The upload's state lives in `uploads.ts`, a session store keyed by `uploadId` holding the issue key, filename, a local preview URL and the state (uploading, done with its ADF node, or failed with a message). Keeping it outside the document means undo never replays it, and keeping it outside the page means it outlives the editor.
3. `createImageBitmap(file)` reads the width and height; a file it cannot decode uploads without them.
4. `attachments:addImage` sends the bytes, filename, type and dimensions. Main checks the bytes' magic number against the claimed type, refuses a filename holding a slash, a control character or a bidi override, and rewrites the extension to match the type. It calls `addAttachment(http, key, { filename, content, contentType })`, so the multipart part declares the type (an additive option on core's `addAttachments`), which checks the site's `uploadLimit` itself. It then calls `attachmentMediaId` on the new attachment, adds the pair to the issue's media index, and returns `{ node }`: `imageNode({ mediaId, filename, width, height })` built from the filename Jira stored. That is a `mediaSingle` with `layout: 'center'` holding `media` with `type: 'file'`, `id`, `collection: ''`, `alt` set to the filename, and the dimensions, the shape Jira's own editor writes in the fixtures.
5. The result goes into the upload store, never straight into a document. Each `ImageView` with an `uploadId` watches the store, and when its entry is done it sets its node's `node` and clears `uploadId`, with `addToHistory: false`. So a completion finds the node wherever it is: an image undone during the upload has no view and the result is dropped (the attachment stays on the issue); a redo brings the view back and it applies the stored result; a draft restored after the user left the page applies a result that landed meanwhile, or keeps waiting. A view whose `uploadId` the store does not know, after a logout or from a paste, shows the failed state.
6. On failure the view shows "Could not upload shot.png. <message>" in a `role="alert"` region with Retry and Remove. Save stays disabled until each uploading or failed image is done or removed.

While uploading, the view shows the local preview dimmed with "Uploading shot.png" in a `role="status"` region.

The upload happens on drop, not on Save, as in Jira's editor. Cancelling the edit leaves the attachment on the issue; deleting it would be a destructive write the user did not ask for, and D5's attachment list shows it.

### Save

**Explicit save.** Save, or `Cmd+Enter`, writes the description; Cancel, or `Esc`, discards. There is no autosave: every PUT adds an entry to the issue's history and can notify watchers, and a debounced autosave would send one every few seconds of typing. Save is disabled while the document equals its base, or while an image is uploading or failed.

**Conflict check.** `issues:setDescription` carries the edited document and the `base` the edit started from. Main reads the issue with `getIssue` and compares its description to `base` with `sameAdf`. Equal, it writes with `editIssue(http, key, { description })` and returns `{ saved: true }`. Different, it writes nothing and returns `{ saved: false, current }`. Comparing the description, not `updated`, means the user's own sidebar edits, a worklog or a transition during the edit raise no false alarm. Jira has no conditional write, so an edit landing between the read and the write still wins the race; the window is one round trip.

**No false conflict after your own save.** Jira may store a saved description in a normalised form, which reaches the app only through the re-read after the save. The description mutation carries the mutation key `['issues', key, 'description']`, and TanStack keeps a mutation pending until its `onSettled`, re-read included, finishes. Edit description is disabled while `useIsMutating` counts one for the issue, with the label "Saving", so the next edit always takes its base from Jira's re-read form.

**Optimistic update.** `useSetDescription()` builds on D3's `issueMutation`, with `patchOf` returning `{ description }`. On Save the editor leaves edit mode at once and the read view shows the new description from the patched cache. `issueMutation` changes in two ways, because the description lives only on the page's own read (`IssueDetail`), not on the listed `Issue`:

- `patchOf` returns `Partial<IssueDetail>`, and `editEverywhere` applies `description` and `subtasks` only to the detail cache, never to the phase lists.
- `current()` reads the detail cache first, when it holds the issue, so the rollback restores the previous description rather than `undefined`.

A conflict result makes the send function throw a `JiraMgrError` with code `validation_failed` and `details: { conflict: true, current }`, so `issueMutation` rolls the patch back like any refusal.

**Failure keeps the draft.** On any failure, conflict included, the editor reopens in edit mode with the draft:

| Failure | Shows |
|---|---|
| Conflict | "PSAPAC-12's description changed in Jira while you edited." with **Save mine anyway**, which saves with Jira's current description as the base, and **Discard mine**, which loads Jira's |
| Jira refused or failed | "Could not save the description, so Jira still holds the old one. <message>" with the draft open to fix or save again |

**Caret and history.** The editor instance stays mounted through a save, since read and edit mode are one instance. A failed save reopens that instance, so the caret and the editor's undo history are as the user left them. A draft restored after leaving the page loads from JSON into a new instance: its undo history starts empty and the caret sits at the end.

**Leaving with unsaved text.** `drafts.ts` is a session map from issue key to a draft and its base. Opening another issue, Back, or switching to the Tree while the editor is dirty, or while its save is failing, puts the draft there, with no prompt. Coming back reopens the editor with it and the note "Unsaved draft restored." Esc or Cancel on a dirty editor opens `DiscardDialog`, an in-page `role="alertdialog"` reading "Discard your changes to the description?" with **Keep editing**, focused, and **Discard**. Esc in the dialog closes it and returns to the editor, without cancelling again. Quitting or reloading while any draft exists or an editor is dirty sets `onbeforeunload`, and main answers Electron's `will-prevent-unload` with a native dialog, Quit or Stay. The e2e entry answers Quit without a dialog and counts the prompt. A draft saved or discarded leaves the map.

**Logout.** Logout with any draft open asks first with the same alertdialog, naming how many issues hold unsaved descriptions. Logging out clears `drafts.ts` and `uploads.ts`, revoking every preview URL, and `clearAccountData` removes the `['attachments']` queries, revoking their URLs.

**Undo.** Inside the editor, `Cmd+Z` is the editor's own history. A saved description joins D7's undo stack (Q38) when D7 builds it, with the base as the previous value; D4 adds no stack.

### Channels

| Channel | Args | Result | Core |
|---|---|---|---|
| `issues:setDescription` | `{ key, description: AdfDoc \| null, base: AdfDoc \| null }` | `{ saved: true } \| { saved: false, current: AdfDoc \| null }` | `getIssue`, `sameAdf`, `editIssue` |
| `attachments:addImage` | `{ key, filename, mimeType, bytes: Uint8Array, width?, height? }` | `{ node: AdfNode }` | `addAttachment`, `attachmentMediaId`, `imageNode` |
| `attachments:image` | `{ key, mediaId }` | `{ mimeType, bytes: Uint8Array }` | `listAttachments`, `attachmentMediaId`, `attachmentContent` |

Each handler validates with zod before the backend runs, as D1 to D3 do: an issue key; `description` and `base` with `adfDocSchema` or `null`, each at most 1 MB as JSON, parsed under `refuseDeepNesting` so a deep document is `validation_failed`, not a crash; `filename` 1 to 255 characters; `mimeType` in `IMAGE_TYPES`; `bytes` a non-empty `Uint8Array` of at most `IMAGE_LIMIT_BYTES`; `width` and `height` positive integers; `mediaId` a UUID. The backend calls `assertInProject(key)` first on all three.

The IPC contract is internal and the error codes are unchanged, so no public contract changes. The CLI is unchanged: it keeps its Markdown path.

### Security

- **No HTML from ADF.** The converter emits JSON, TipTap renders nodes through their `renderHTML` specs with DOM calls, and read-only nodes render text through React. Nothing from ADF reaches `innerHTML`, `dangerouslySetInnerHTML` or `setContent` as an HTML string.
- **Links.** `shared/links.ts` decides with `new URL(raw).protocol`: `http:`, `https:` and `mailto:` pass, everything else, including a leading space, `JAVASCRIPT:`, `file:`, `data:` and a backslash form of `https`, fails. A `mailto:` keeps only the `subject`, `body`, `cc` and `bcc` query parameters. What opens is the parsed `url.href`, never the raw string. Links the user creates go through Link's `isAllowedUri` with the same function. A loaded link with another scheme keeps its `href` for the round trip but renders without one. The renderer checks the scheme before `window.open`, and main's `setWindowOpenHandler` checks again before `shell.openExternal`, and denies the window in every case. Inline cards open through the same handler. `will-navigate` stays blocked.
- **Paste.** Only copies stamped with this session's nonce carry raw ADF (Editor Schema).
- **Images through main only.** The CSP's `img-src` becomes `'self' data: blob:`; the CSP is a meta tag, so the packaged `file://` build gets the same. No remote image loads, `<img>` in pasted HTML is dropped, and an external `mediaSingle` stays a read-only block that shows its URL as text. Images are read with a 20 MB cap, typed by magic bytes, and fetched 4 at a time.
- **Uploads.** Magic bytes must match the claimed type, filenames are checked and their extension rewritten, and the multipart part declares the type.
- **The token stays in main.** Image bytes cross IPC, never a URL. The media redirect URL never leaves `http.ts`.
- **IPC validation** as in Channels, behind D1's trusted-frame check.
- **Electron.** The editor makes the renderer parse untrusted pasted HTML, so Electron must stay on a supported, patched release line; Dependabot's weekly updates cover it.

### Keyboard and Accessibility

- Read mode: the description sits in the `Description` section with an **Edit description** button (**Add description** when empty), matching D3's Edit summary. A click on the text with nothing selected also enters edit mode at the click point, except on a link or an image; a click that ends a selection does not, so text can be copied.
- `editorProps.attributes` change with the mode. In edit mode the region has `role="textbox"`, `aria-multiline="true"` and the accessible name "Description"; in read mode it has no role and the name "Description". Focus moves into it on edit. Save and Cancel follow it in tab order, with their shortcuts in their titles.
- Tab: inside a list, `Tab` and `Shift+Tab` indent and outdent the item (ListKeymap). Outside a list, `Tab` leaves the editor for Save and Cancel. `Cmd+Enter` and `Esc` work from anywhere in the editor.
- Markdown shortcuts, from StarterKit's input rules: `#` to `######` and a space for headings, `-` or `*` for a bullet list, `1.` for an ordered list, `>` for a quote, three backticks for a code block, `---` for a rule, `**bold**`, `*italic*` or `_italic_`, `~~strike~~`, `` `code` ``. TipTap's own mark shortcuts, such as `Cmd+B`, `Cmd+I` and `Cmd+U`. There is no link dialog in D4: paste a URL over text, or type one.
- Links: one `handleClick` plugin opens a link on a plain click in read mode and on `Cmd`+click in edit mode, and does nothing else, so a click opens one window, not two.
- No single-letter shortcut. The editor binds nothing that D7 needs: `Cmd+K` passes through to the Palette.
- `Esc` in the editor cancels (through `DiscardDialog` when dirty) and returns focus to the page, as D3's summary field does. `IssuePage`'s Esc handler adds `[contenteditable="true"]` and `[role="alertdialog"]` to the controls it leaves alone, so that Esc never also goes back to the Tree. A second Esc, on the page, goes back.
- Read-only nodes are selectable with the arrow keys (Gapcursor reaches the gap beside a final block) and deletable with Backspace, and announce as read-only.
- Upload progress uses `role="status"`, failures `role="alert"`. No animation, so `prefers-reduced-motion` needs nothing.

### Testing

The converters are pure and carry the round-trip proof. A desktop test then runs the same fixtures through the real TipTap schema, since ProseMirror's normalisation is where a JSON-level round trip could still break. A converter that made everything read-only would pass a round trip, so both tests also check, per fixture, which blocks became read-only against an independent oracle. Typing, dropping and saving are covered end to end through the fake Jira. Testing Library and a DOM environment are not installed; `getSchema` and `Node.fromJSON` run without one, and the schema test confirms it.

`@jira-mgr/core/test/adf-fixtures` exports every ADF document in `packages/core/fixtures/adf-*.json`, each description and each comment body, with its file name, so the desktop test reads them by package name.

**The oracle.** A top-level block should load as an `adfBlock` exactly when it is, or contains, a block node outside the supported block set (`paragraph`, `heading`, `blockquote`, `bulletList`, `orderedList`, `listItem`, `codeBlock`, `rule`, and a `mediaSingle` holding one file `media`). The tests count both and compare, and count `adfInline` nodes against the unsupported inline nodes in the remaining blocks. They also assert that editable `paragraph`, `heading`, list and `codeBlock` nodes exist in `-3017`, `-550` and `-1219`.

**Unit tests:**

| File | Test |
|---|---|
| `core/src/adf-editor.test.ts` | `round-trips every recorded ADF document through the editor form` |
| | `makes read-only exactly the top-level blocks the oracle names, in every fixture` |
| | `keeps paragraphs, headings, lists and code blocks editable in PSAPAC-3017, -550 and -1219` |
| | `maps strong, em, strike, code, underline and link to the editor's marks and back` |
| | `keeps textColor and other unknown marks, several on one text` |
| | `keeps localId on paragraphs, lists and list items, and block marks such as alignment` |
| | `writes a changed level, order, language or href over the original attrs` |
| | `writes no order for a new list starting at 1, and order for one starting elsewhere` |
| | `drops TipTap's default link and code block attrs` |
| | `ignores marks on read-only atoms` |
| | `keeps mention, date, emoji, status, inlineCard and mediaInline as read-only inline nodes` |
| | `loads a mediaSingle of a file as an image, and an external one as a read-only block` |
| | `loads a block that does not come back equivalent as a read-only block` |
| | `loads a block the accepts check refuses as a read-only block` |
| | `joins adjacent text with the same marks, and compares marks as a set` |
| | `treats a paragraph with no content and one with empty content as equal` |
| | `saves a document holding only an empty paragraph as no description` |
| | `refuses an image still uploading with validation_failed` |
| | `imageNode builds the mediaSingle Jira writes for an attachment` |
| | `refuses a document nested past the stack with validation_failed` |
| `core/src/http.int.test.ts` | `bytes returns the body and content type without parsing JSON` |
| | `bytes refuses a Content-Length over maxBytes before reading` |
| | `bytes aborts a body that passes maxBytes` |
| | `mediaId returns the id from the recorded redirect without following it, and cancels the body` |
| | `mediaId refuses a path other than attachment content` |
| | `mediaId throws jira_error, with no cause or details, for a missing Location, another host, http, or no file id` |
| | `mediaId never prints the Location under JM_DEBUG` |
| `core/src/extras.int.test.ts` | `attachmentMediaId reads the file id from the content redirect` |
| | `attachmentContent asks for redirect=false and returns the bytes` |
| | `addAttachments declares the content type on the multipart part` |
| | `both refuse an attachment id that is not digits` |
| `core/src/extras.live.test.ts` | `the image attachments of PSAPAC-19 and PSAPAC-1219 resolve to the media ids their descriptions embed` (for example `f06ee6e2-999b-491f-acb0-f299310206ec` on PSAPAC-19; read-only) |
| | `attachments 652123 and 652124 of PSAPAC-3017 resolve to b779fa03-43a9-473f-bc64-531f0c7fa560 and 2dca82e3-a88f-4cfc-a9e5-1a2f302369b8` (as a set; read-only) |
| `renderer/src/editor/schema.test.ts` | `the editor schema accepts every recorded fixture with no block refused` |
| | `every fixture survives nodeFromJSON, toJSON and editorToAdf unchanged` |
| | `makes read-only exactly the top-level blocks the oracle names, through the schema` |
| | `a heading, rule or quote cannot sit in a list item or a quote` |
| | `linked code keeps both marks` |
| | `the editor names every node and mark the converter emits` |
| | `readAdfAttr refuses invalid JSON, an inline node for a block, and a block for an inline` |
| `renderer/src/editor/readOnly.test.ts` | `labels a panel, a table, an expand, a macro and an unknown block` |
| | `gives a block's plain text, one line per paragraph` |
| | `gives a table's cells as rows of text` |
| | `labels a mention, emoji, date, status and inlineCard` |
| `renderer/src/optimistic.test.ts` | `a description edit patches the page's read and leaves the listed issues alone` |
| | `a refused description edit restores the previous description` |
| `renderer/src/queries.test.ts` | `a conflict result rolls the description back and carries Jira's description` |
| | `the description mutation stays pending until its re-read lands` |
| | `logout removes the attachment images and revokes their URLs` |
| `renderer/src/drafts.test.ts` | `keeps a draft per issue until it is saved or discarded` |
| | `logout removes every draft` |
| `renderer/src/uploads.test.ts` | `keeps an upload's result until a view applies it` |
| | `logout removes every upload and revokes its preview` |
| `shared/links.test.ts` | `opens http, https and mailto links and refuses every other scheme` |
| | `refuses " javascript:", "JAVASCRIPT:", "file:", "data:" and a backslash https` |
| | `keeps only subject, body, cc and bcc on a mailto link` |
| | `opens the parsed href, not the raw string` |
| `main/images.test.ts` | `names PNG, JPEG, GIF and WebP by magic bytes and nothing else` |
| | `refuses filenames with a slash, a control character or a bidi override` |
| | `rewrites the extension to match the type` |
| `main/backend.test.ts` | `setDescription writes when Jira's description matches the base` |
| | `setDescription returns Jira's description and writes nothing when it differs` |
| | `setDescription treats a key-order difference as no change` |
| | `addImage uploads with the type, then returns the image node built from Jira's filename` |
| | `addImage refuses bytes whose magic number does not match the claimed type` |
| | `image resolves image attachments in batches of 4 and stops at the batch that finds the id` |
| | `image re-reads the list once for an unknown id, shares the re-read, and caches the miss for 30 seconds` |
| | `image refuses an attachment over 20 MB or of another type before fetching it` |
| | `image refuses fetched bytes that are not one of the four types` |
| | `image runs at most 4 reads at once` |
| | `logout clears the media index` |
| `main/handlers.test.ts` | `issues:setDescription refuses a description or base that is not ADF, over 1 MB, or nested too deeply` |
| | `attachments:addImage refuses another type, an empty or oversized file and a long filename` |
| | `attachments:image refuses a media id that is not a UUID` |

**Fake Jira.** `apps/desktop/src/main/e2e-fake.ts` grows to:

- An issue whose description holds a panel, a table, a mention, a paragraph with a `localId`, a linked code span, and a `mediaSingle` whose media id belongs to one of its attachments.
- Attachments: `GET /rest/api/3/issue/{key}?fields=attachment`, `GET /rest/api/3/attachment/meta`, `POST /rest/api/3/issue/{key}/attachments` (recorded in `counts.uploads`), and `GET /rest/api/3/attachment/content/{id}`, answering with the recorded redirect from `attachment-content-redirect.json`, or a small PNG with `redirect=false`.
- `releaseUpload()` and `failUpload()`, holding or failing the next upload as `releaseEdit` and `failDone` do.
- `setDescription(key, adf)`, changing the description as another user would, for the conflict test.
- `normaliseDescriptions()`, which makes the fake store each saved description with a `localId` added to every paragraph, as Jira may.
- `counts.openExternal` and `counts.quitPrompts`, from the e2e entry's stand-ins for `shell.openExternal` and the quit dialog.

**End-to-end tests,** in `e2e/desktop/editor.test.ts`:

| Test |
|---|
| `writes a heading, a list and bold text with markdown shortcuts and saves them with Cmd+Enter` |
| `saves the panel, table and mention unchanged when a paragraph beside them is edited` |
| `splitting a paragraph sends one localId, not two` |
| `cannot type inside a read-only block, but can delete it` |
| `shows the saved description before Jira answers, and reopens the draft when Jira refuses` |
| `keeps Edit disabled until the re-read lands, so a quick second save against a normalising Jira raises no conflict` |
| `offers Save mine anyway and Discard mine when the description changed in Jira` |
| `Save mine anyway overwrites Jira's description with the draft` |
| `Discard mine shows Jira's description and drops the draft` |
| `embeds a dropped image inline and saves a mediaSingle with its media id` |
| `undoing an image during its upload drops it, and the save holds no image` |
| `an image uploading when the user leaves the page is embedded when the draft is restored` |
| `shows an upload failure on the image and keeps Save disabled until it is removed` |
| `shows an existing image fetched through main as a blob URL` |
| `a click on a link in read mode opens it once; a plain click while editing opens nothing; Cmd+click opens it once` |
| `Esc leaves an unchanged edit, and a second Esc returns to the Tree` |
| `Esc on a changed draft opens the discard dialog; Esc there keeps editing; Discard drops the draft` |
| `restores an unsaved draft after opening another issue and coming back, with the caret at the end` |
| `a failed save reopens with the caret where it was and Cmd+Z undoing the last change` |
| `quitting with an unsaved draft raises the quit prompt` |
| `logging out with an unsaved draft asks first, then removes it` |
| `edits, saves and cancels by keyboard alone, tabbing out of a list to Save and Cancel` |

The drop test builds a `DataTransfer` holding a `File` in the page and dispatches `drop` on the editor; the paste path shares the handler. The image test checks that the `img` has a `blob:` source and a non-zero natural width.

## Alternatives

| Option | For | Against |
|---|---|---|
| **Converter in core, pure JSON** (chosen) | Core already owns ADF, its schemas and fixtures; no TipTap import in core | The renderer's node names must match; a desktop test pins them |
| Converter in the renderer beside the schema | One package touched | ADF rules outside core, against ARCHITECTURE.md; the fixtures live in core |
| Through Markdown: `adfToMarkdown`, then a TipTap Markdown extension | Reuses C9 | One more dependency; `adf` fences load as editable code blocks of JSON, not read-only blocks |
| **Raw ADF on a read-only atom** (chosen) | Byte-for-byte by construction; any unknown type works | Nothing inside the block is editable, as ADR-0005 accepts |
| Partial models of tables and panels | Edits more content | Each needs both converter directions and its own tests (ADR-0005); out of D4 |
| **Explicit save** (chosen) | One history entry and notification per save; one conflict check | A crash loses the open draft |
| Debounced autosave | Linear's feel | A PUT every few seconds floods history and watchers; a conflict read on each |
| **Conflict by comparing the description** (chosen) | No false alarm from the user's own field edits | One GET per save; a race window of one round trip |
| Conflict by `updated` | Free from the cache | Every edit to any field, the user's own included, raises it |
| **Media id from the content redirect** (chosen) | Public endpoints, reads only | The `Location` shape is undocumented; one request per image attachment, resolved lazily and cached |
| `media` of `type: 'external'` at the attachment URL | No media id needed | Renders only where a browser holds a Jira session; mobile and email break |
| Wiki markup `!shot.png!` through REST v2 | Jira resolves the attachment itself | Rewrites the whole description through wiki conversion, losing the ADF the editor keeps |
| `renderedFields` HTML to map media to attachments | One request per issue | Parsing undocumented HTML in core |
| **Bytes over IPC, object URLs cached** (chosen) | Reuses validated, trusted-frame IPC | Bytes copied once across IPC |
| A privileged `jm-media:` protocol | Streams; browser caching | A new scheme, and its handler sees no frame for the trust check |
| **Draft kept on leaving, in-page dialog on Esc** (chosen) | Navigating never loses text; Esc stays a cancel; the dialog is keyboard-testable | Drafts last only the session |
| Native `confirm()` on Esc | No component | Blocks the renderer, cannot be styled or reached by Playwright's role queries |

## Rollout

D4 ships in one pull request from `d4-editor` with `Refs #31`, after this doc and Shane's answer on the packages, built in this order:

1. Core: `adf-editor.ts` with its tests and the fixture export.
2. Core: the `http` options, `attachmentMediaId`, `attachmentContent`, the content type on uploads, the recorded redirect fixture, their tests, and the live test, run once with `pnpm test:live` before step 4 relies on the redirect.
3. Desktop main: the channels, backend, image checks, link handling, quit prompt, fake Jira and their tests.
4. Renderer: the packages, the extensions and schema test, the node views, `AdfEditor`, `DescriptionEditor`, `DiscardDialog`, drafts, uploads, the optimistic change, the CSP.
5. The e2e suite.

The same pull request updates core's README (the editor converter beside the Markdown one; the two attachment functions and the upload content type; the `http` options), `apps/desktop/README.md` (channels, the editor, known limits: drafts last the session, no link dialog, a read-only block can be dragged where Jira refuses it, a cancelled edit leaves its uploaded images attached), `e2e/README.md` (`releaseUpload`, `failUpload`, `setDescription`, `normaliseDescriptions`, the new counts) and `CONTEXT.md` (**Read-only block**: content the editor shows but cannot edit, kept as the original ADF; avoid "unsupported node", "macro"). The pull request description names the four packages and the measured growth of `out/renderer`.

No decision here meets all three ADR tests: each is reversible within the app, and ADR-0005 already records the editor choice. Backing out is a revert. The only lasting effect is attachments uploaded by image drops, which stay on their issues.

## Open Questions

1. **Packages, for Shane (Ask First: a runtime dependency).** Four direct packages in `apps/desktop`, declared as the app declares React, all at 3.31.4 (published 2026-09-30, past the seven-day `minimumReleaseAge`):

   | Package | Why | Unpacked |
   |---|---|---|
   | `@tiptap/core` | The editor | 3.2 MB |
   | `@tiptap/pm` | ProseMirror, a peer of core | 15 KB, plus about 2.8 MB of `prosemirror-*` |
   | `@tiptap/react` | `EditorContent`, `useEditorState` and React node views for images and read-only blocks | 590 KB |
   | `@tiptap/starter-kit` | Headings, lists, code, quotes, rule, the five marks, links, history, drop and gap cursors, markdown input rules | 54 KB, plus its extension packages |

   With transitive packages that is 46 packages and about 9.5 MB unpacked, every one MIT, none with an install script (checked on the registry, 2026-10-09). The renderer bundle grows by an estimated 100 to 150 KB gzipped; the builder reports the measured figure. Core gains nothing. **Recommendation: approve.** They are the packages ADR-0005 named, maintained and typed, and the node views would take more code in plain DOM than `@tiptap/react` costs.

2. **One live write check, for Shane, before merge.** No test may write to Jira, and only a write proves that Jira renders a `mediaSingle` the app wrote for an attachment it uploaded. **Recommendation:** with Shane present, as in L7, in the packaged app: on a throwaway PSAPAC issue, drop an image, save, confirm the image shows in the app and inline in Jira's web view with the content around it intact, then delete the issue.
