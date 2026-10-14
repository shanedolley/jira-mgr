# 0004: Activity

**Status:** accepted
**Owner:** @shanedolley
**Refs:** #32

## Problem

D3 (#30) and D4 (#31) give the issue page a summary, a description, subtasks and a properties sidebar. It shows no comments, worklogs, links or attachments, and a dropped file that is not an image is refused ("Other files cannot be attached here yet"). Q11, Q19 and Q34 ask for all four, and Shane's spec on #32 adds an Attachments section at the bottom that lists every attachment of any type with download, and an "Attach file to issue" zone that lights up with D4's "Add images into description" zone while a file is dragged over the page. The CLI already does all of it through core's /extras (L5, verified live on 2026-10-08).

## Goals

- The page lists the issue's comments, worklogs, links and attachments, read when the page opens and again on window focus.
- Comments are added, edited and deleted by their author in D4's `AdfEditor`.
- Worklogs are added, edited and deleted by their author, and the remaining estimate adjusts as the CLI's does.
- Links are added in either direction with any of the 21 types, and removed. Both ends of every link write sit in the project.
- The Attachments section lists every attachment of any type, with a Download button that saves through a native dialog the main process opens.
- A file dropped anywhere on the page attaches. While a file is dragged over the page, the Attachments zone and the description zone light up together. An image dropped on the description or a comment still embeds.
- A failed write says what failed and leaves the page as it was. No Jira access leaves core. Every IPC value is validated in main.
- No new dependency and no change to a public contract.

## Design

### Layout

```
apps/desktop/src/
  shared/ipc.ts            fourteen channels; CommentItem, WorklogItem, LinkItem, LinkTypeItem, AttachmentItem
  main/backend.ts          comments, worklogs, links, attachments; project guards; save dialog
  main/handlers.ts         schemas for the fourteen channels
  main/save.ts             the native save dialog (imports electron; nothing else does)
  main/images.ts           safeFilename, shared by image and file uploads
  main/index.ts, e2e.ts    pass the dialog to the backend; the e2e entry passes a stand-in
  main/e2e-fake.ts         comments, worklogs, links, link types, attachment download
  renderer/src/
    activity.ts            pure: link choices and their order, worklog form, human size, notices
    attach.ts              the attach hook: sequential upload of dropped or picked files
    CommentsSection.tsx    the Activity section: comments and the comment box
    WorklogsSection.tsx    the Worklogs section
    LinksSection.tsx       the Links section
    AttachmentsSection.tsx the Attachments section and its drop zone
    DropZone.tsx           claims the drops it takes, so the page does not attach them twice
    DescriptionEditor.tsx  hands non-image files to attach instead of refusing them
    IssuePage.tsx          the sections, and the page-level drop
    queries.ts             one list query and the mutations for each kind
```

### Page

The main column reads top to bottom: summary, description, subtasks, Links, Worklogs, Activity (comments and the comment box), Attachments. Attachments is last, as Shane asked. Worklogs is absent on an Epic, which takes none (`propertyRules(...).estimates`, the same switch D3 uses for the estimates). Each section keeps D3's small uppercase heading and `max-w-3xl` column.

Compared with Linear's activity screenshots ([12](linear/12-issue-activity.png), [14](linear/14-issue-comments.png)): Linear's Activity is one-line events with an avatar, the time after a dot, and a bordered comment box below with a paperclip and a round submit button. This page copies the comment box (bordered and rounded, placeholder "Leave a comment"; its attach control is the Attachments section's Attach file button, which also takes drops) and the one-line rows for links and worklogs, with time after a dot in grey 13px. It does not copy the event history (status moves, field edits): Jira's changelog is not in D5's scope, and the roadmap row lists only the four kinds. Linear's 15px section heading is not copied; D3 and D4 already set the page's headings and a second style would look wrong beside them.

### Reads

Each kind is its own query, `['activity', key, kind]`, so a failure in one shows in its section and leaves the rest. They load when the page opens, refetch on window focus like the page's own read, and show "Loading comments" and so on while loading, with `LoadError` and Retry on failure, as D4's description does. `clearAccountData` removes `['activity']` on logout.

| Channel | Args | Result | Core |
|---|---|---|---|
| `comments:list` | `{ key }` | `CommentItem[]`, oldest first | `listComments` |
| `comments:add` | `{ key, body: AdfDoc }` | `CommentItem` | `addComment` |
| `comments:edit` | `{ key, commentId, body: AdfDoc }` | `CommentItem` | `editComment` |
| `comments:delete` | `{ key, commentId }` | `null` | `deleteComment` |
| `worklogs:list` | `{ key }` | `WorklogItem[]` | `listWorklogs` |
| `worklogs:add` | `{ key, timeSpent, started?, comment? }` | `WorklogItem` | `addWorklog` |
| `worklogs:edit` | `{ key, worklogId, timeSpent?, started?, comment? }` | `WorklogItem` | `editWorklog` |
| `worklogs:delete` | `{ key, worklogId }` | `null` | `deleteWorklog` |
| `links:list` | `{ key }` | `{ links: LinkItem[], types: LinkTypeItem[] }` | `listLinks`, `listLinkTypes` |
| `links:add` | `{ key, typeId, direction, otherKey }` | `null` | `addLink` |
| `links:remove` | `{ key, linkId }` | `null` | `getLink`, `removeLink` |
| `attachments:list` | `{ key }` | `AttachmentItem[]` | `listAttachments` |
| `attachments:add` | `{ key, filename, mimeType, bytes }` | `AttachmentItem` | `addAttachment` |
| `attachments:download` | `{ key, attachmentId }` | `{ saved: true, filename } \| { saved: false }` | `listAttachments`, `attachmentContent` |

The item types carry the author as `{ accountId, displayName }` or `null` and times as ISO text, as core returns them. `AttachmentItem` drops core's `contentUrl`, so no Jira URL crosses IPC. A comment or worklog `body` is ADF, never HTML.

Every handler validates with zod before the backend runs: an issue key; ids as digits; `body` and `comment` as ADF of at most 1 MB through the `adfArg` D4 wrote; `timeSpent` against `DURATION_PATTERN`; `started` as an ISO date-time; `typeId` as digits; `direction` as `outward` or `inward`; `filename` 1 to 255 characters; `bytes` a non-empty `Uint8Array` of at most `ATTACHMENT_LIMIT_BYTES`. Core repeats the checks that matter to Jira. Every backend method calls `assertInProject(key)` first.

### Comments

Each comment shows its author, the time after a dot ("edited" when `updated` differs from `created`), and its body in a read-only `AdfEditor` (`editing: false`), which already renders D4's blocks, links and images. A comment whose author is the signed-in user (`useMe`) has Edit and Delete. Jira lets an admin edit others' comments, but Q34 says "your own" and a button Jira refuses is worse than none; a 403 still maps to `permission_denied` and shows as an error.

**Edit.** Unsaved text in an edit joins the description's draft store (`drafts.ts`, under `<key>#<comment id>`), so Back, Esc or opening a link keeps it, coming back reopens the edit, and a quit or logout asks first. Edit puts that comment's editor into edit mode, with Save and Cancel from `AdfEditor`. Save, or `Cmd+Enter`, sends `comments:edit`; `Esc` or Cancel discards through `DiscardDialog` when dirty. The edit is not optimistic: the editor stays in edit mode with Save reading "Saving" until Jira answers, then leaves edit mode with Jira's returned comment. A refusal keeps the editor open with the text and shows "Could not save the comment. <message>". That is the same no-loss guarantee as D4's description save without D4's draft map, since a comment edit is short and its editor stays mounted. An empty comment (`editorToAdf` gives `null`) is refused with "A comment cannot be empty."; Jira has no empty comment. Before it sends, a comment save reads the comment list again and compares Jira's comment to the one the edit began on (the draft's `base`, by `sameAdf`). When they differ, nothing is sent and the row shows D4's conflict prompt, "This comment changed in Jira while you edited.", with **Save mine anyway** (sends the draft over Jira's comment) and **Discard mine** (shows Jira's comment and drops the draft). A comment missing from that read is left to Jira to refuse. Every comment list read also drops the drafts of comments it no longer holds, because a comment deleted in Jira never mounts again and its draft would count in the logout and quit prompts for good.

**Add.** The comment box at the end of the Activity section is an `AdfEditor` that is always in edit mode with `value: null`, placeholder text "Leave a comment", and its Save button labelled **Comment** (a new `saveLabel` prop on `AdfEditor`, default "Save"). `Cmd+Enter` posts. It is not optimistic, as create is not: the id is Jira's to give. It disables while posting, and on success the new comment appends from Jira's answer and the box clears. On failure the text stays and the error shows under the box. The box takes no focus when the page opens, so the page's keys keep working, and its text is a draft kept, like the description's, when the page is left. Clear (Esc) asks first when text is typed.

**Delete.** An inline "Delete comment?" with Delete and Cancel, focus on Cancel, as the saved views' delete does. Delete removes the comment at once and puts it back if Jira refuses.

**Images.** An image dropped or pasted into a comment editor goes through D4's path unchanged: it uploads as an attachment of the issue and embeds as a `mediaSingle`. The comment's ADF then holds the same `media` node a description does. Jira renders it in a comment the same way, by the Media Services id; that has not been written live (Open Questions).

### Worklogs

The Worklogs section lists each worklog as one line: author, "logged 1h 30m", the started date and time, and its comment as plain text, with a total ("Logged 3h 15m") at the end of the heading row. The author sees Edit and Delete. An "Add worklog" button opens an inline form; so does Edit, prefilled.

| Field | Control | Rule |
|---|---|---|
| Time spent | text | A Jira duration (`DURATION_PATTERN`): `1h 30m`. The Save button stays off until it matches |
| Started | `datetime-local` | Defaults to now; sent as an instant. Core formats it for Jira |
| Comment | text | Optional; one paragraph of ADF. An empty comment sends none |

**adjustEstimate.** Core always sends `adjustEstimate=auto` on add, edit and delete (Q11), so the remaining estimate falls by the time logged, moves by the difference on an edit, and returns on a delete. The form says "Reduces Time remaining by the time logged" and offers no other mode: Q11 chose (a), not (c). The live PSAPAC rule keeps Time remaining (h) equal to the remaining estimate (handover Traps), so after any worklog write the page reads the issue once (`issues:get`) and takes the fresh issue through `applyFreshIssue`, which moves the sidebar's estimate and Time remaining. No list is reloaded.

**Optimistic.** Add and edit are not optimistic: the form stays open, disabled and reading "Saving", and closes on Jira's answer. A refusal keeps the form and the text with the message. Delete is inline-confirmed like a comment, removes the row at once and restores it on refusal. A foreign worklog id is refused by core before any write (#60), so main passes ids through as they come.

### Links

Links lists each link as "blocks PSAPAC-5  Summary  Status" with a Remove button. The phrase is `type.outward` for an `outward` link and `type.inward` for an `inward` one, which is how core defines the direction. Rows group by phrase. A linked issue opens its page when it is in the loaded list, and is plain text otherwise (a link to another project).

**Add.** "Add link" opens a row with one select, a key field and an Add link button. The select lists one choice per type and direction: "blocks", "is blocked by", "relates to". A type whose outward and inward text are equal (Relates) lists once. Q19 orders them: Blocks, Relates, Duplicate, Causes and Clones first, then a divider, then the rest. A native `<select>` with two `<optgroup>`s draws the divider, so it works by keyboard with no code. Types come from `listLinkTypes`, all 21, unfiltered. The key field has a `<datalist>` of the loaded issues. A key that does not look like `PSAPAC-12`, or is the page's own issue, keeps Add off.

**Direction.** The choice carries `direction`: "blocks" is `outward`, so the page's issue blocks the other. Core's `addLink` sends the blocker as `inwardIssue` (verified live on 2026-10-07 and again in L7). Main passes `direction` through and never swaps it. A test pins "this issue blocks PSAPAC-5" to a POST whose `inwardIssue` is this issue.

**Guard.** `links:add` calls `assertInProject` on `key` and on `otherKey`, as `jm link add` does, so a link never reaches an issue outside PSAPAC. `links:remove` reads the link (`getLink`), requires one end to be `key`, and calls `assertInProject` on both ends, as `jm link remove` does. The end check stops a stale or forged link id from removing a link of issues the page is not showing.

**Optimistic.** Add is not optimistic: the id is Jira's, and Jira answers 201 with no body, so the list reads again after the write. Remove removes the row at once and restores it on refusal. After either, the other issue's `['activity', other, 'links']` query, when cached, is invalidated, since the link shows on both pages.

### Attachments

The Attachments section lists every attachment of any type: file name, size ("96.4 KB"), the date and the author, with a **Download** button. Images show no thumbnail in the list; D4's inline view covers images in the description. An **Attach file** button opens the native file picker (`<input type="file" multiple>`), so there is a visible alternative to dropping. The section is a `DropZone` labelled "Attach file to issue".

**Drop.** `useFileDrag` already lights every `DropZone` while a file is dragged over the window, so the Attachments zone and D4's description zone light up together with no new code in the hook. The drop rules:

| Dropped on | Images | Other files |
|---|---|---|
| Description (editing, or not) | Embed, as D4 does | Attach (D4 refused them) |
| A comment editor while editing | Embed in the comment | Attach |
| Attachments zone | Attach, no embed | Attach |
| Anywhere else on the page | Attach, no embed | Attach |

`DropZone` marks each drop it takes in a `WeakSet`, so the page-level handler skips it. The page's `<section>` takes the rest: it attaches every file of a drop that no zone claimed, and when an editor took some images (`defaultPrevented`), only the files that are not images. A drop that carries only an unreadable folder reports it.

**Attach.** `attach(files)` fixes the issue when the files are dropped and sends them one at a time over `attachments:add`, with the key in the mutation's variables, so a drop queued on one issue never lands on another, each read in the renderer to a `Uint8Array`. A file over `ATTACHMENT_LIMIT_BYTES` (100 MB, the site's limit and Q34's) is refused before it is read, with a notice naming it. While one uploads, the section shows "Uploading name" as a `role="status"` row; when it lands, the list query refetches. A failure shows a notice with Jira's reason and stops nothing else. Main refuses an unsafe name with `safeFilename` (a slash, a control character, a bidi override), passes the declared type when it is a valid `type/subtype` and none otherwise, and calls core's `addAttachment`, which reads the site's upload limit itself.

**Download.** Download sends `{ key, attachmentId }`. Main lists the issue's attachments, finds that id (so an id from another issue is `not_found`), opens `dialog.showSaveDialog` with the attachment's file name in the user's Downloads folder as the default, and returns `{ saved: false }` when the user cancels. It then reads the bytes with `attachmentContent` (`redirect=false`, so the token stays on the site, with `maxBytes` 100 MB) and writes them to the path the dialog returned. The renderer never sends a path and never receives one; main writes only to what the native dialog chose. A notice says "Saved name". The dialog is a `chooseSavePath(defaultName)` dependency of the backend: `main/save.ts` implements it with Electron for the app, and the e2e entry passes a stand-in that returns a path under `JM_STATE_DIR` and counts the call, as `confirmQuit` does.

The file is held in memory while it downloads, because core reads a body to `Uint8Array`. At 100 MB that is acceptable for a desktop app.
`// ponytail: no streaming; stream to disk if the limit rises.`

**Not built.** Removing an attachment. Core has `removeAttachment`, but the roadmap row says list, download and attach, an attachment may be embedded in a description or comment, and D4 left an orphaned attachment on the issue by design. Deleting one is a separate, destructive story.

### Refresh and Errors

| Event | What reads again |
|---|---|
| Page opens, window focus | The four activity queries, and the page's own read |
| Comment add, edit | The comment list takes Jira's answer; no re-read |
| Comment delete | The row leaves at once; the list reads again once the write settles |
| Worklog add, edit, delete | The worklog list, and the issue once, for Time remaining |
| Link add, remove | The links list, and the other issue's links when cached |
| Attachment lands | The attachment list |

Each write sits in a TanStack mutation. A refusal of an optimistic write restores the previous list and shows a notice "Could not delete the comment" with the message as a note, `warned: true`, which stays until dismissed, as D3's edits do. A refusal of a pessimistic write shows its error in the form, beside the text it keeps. Core's messages reach the user through `desktopMessage`, as elsewhere. Logout removes `['activity']`.

### Undo

Comments, worklogs, links and attachments stay off D7's undo stack, as `undo.ts` already says: they are not field edits, and a delete cannot be written back exactly (a comment's id and time change). Deletes ask first instead.

### Security

- Download writes only to a path from the native dialog; the renderer names none. `pnpm package` sets `LSFileQuarantineEnabled` in Info.plist, so macOS quarantines what the app saves. The offered name is cut to 255 UTF-8 bytes, keeping its extension. The default file name goes through `safeFilename` and `path.basename`, so a name such as `../x` offers `x`.
- Uploads: `safeFilename`, the declared type checked against `type/subtype`, size capped at 100 MB in the schema and by core against the site's limit. No file type is refused: Q34 asks for any type, and Jira serves attachments as downloads.
- ADF in comments and worklog comments is rendered through `AdfEditor` and plain text, never as HTML.
- The Jira content URL never crosses IPC. The token stays in main.
- Project guards on every key written to, both ends of a link included.

## Testing

**Unit.**

| File | Test |
|---|---|
| `renderer/src/activity.test.ts` | `orders link types: Blocks, Relates, Duplicate, Causes and Clones first, then the rest` |
| | `lists a type once when its outward and inward text are equal` |
| | `gives the direction a choice carries` |
| | `reads a worklog form: a Jira duration, a start time, an empty comment as none` |
| | `formats a size in bytes, KB and MB` |
| `renderer/src/attach.test.ts` | `sends files one at a time and reports each failure` |
| | `refuses a file over 100 MB before reading it` |
| `main/backend.activity.test.ts` | `comments:add, edit and delete call core and guard the key` |
| | `worklogs:add sends adjustEstimate=auto, and edit and delete read the worklog through the issue first` |
| | `links:add sends the blocker as inwardIssue for an outward choice` |
| | `links:add refuses another project's key at either end` |
| | `links:remove refuses a link that does not touch the issue, and one with an end outside the project` |
| | `attachments:add sends the file with its declared type, and refuses an unsafe name` |
| | `attachments:download refuses an attachment of another issue` |
| | `attachments:download writes to the path the dialog chose, and writes nothing when the user cancels` |
| | `attachments:download offers the base name of the attachment as the default` |
| `main/handlers.test.ts` | one case per new channel: a bad key, a non-digit id, a bad duration, ADF over 1 MB, an empty or oversized file, an unknown direction |
| `renderer/src/activityQueries.test.ts` | `removeMutation removes the row at once, before Jira answers` |
| | `removeMutation puts the data back when Jira refuses` |
| | `logout removes every issue's comments, worklogs, links and attachment lists` |

**End to end,** in `e2e/desktop/activity.test.ts`, on PSAPAC-1 (comments, links and attachments seeded), PSAPAC-2 (worklogs) and PSAPAC-4 (a 2h estimate):

| Test |
|---|
| `shows the comments, links and attachments of the issue` |
| `shows the worklogs of the issue and their total, and none on an Epic` |
| `adds a comment with Cmd+Enter, and the box clears` |
| `does not post twice when Cmd+Enter is pressed twice` |
| `keeps the text and says why when Jira refuses a comment` |
| `offers Edit and Delete on the signed-in user's own comment only` |
| `edits a comment, and shows it as edited once Jira answers` |
| `keeps the text in the editor and says why when Jira refuses an edit` |
| `asks before discarding an edit, and Esc keeps editing` |
| `deletes a comment at once and sends the delete after the confirmation` |
| `puts a comment back, and says why, when Jira refuses the delete` |
| `logs work with adjustEstimate=auto, and Time remaining falls once Jira answers` |
| `refuses a time that is not a Jira duration before anything is sent` |
| `keeps the form and says why when Jira refuses a worklog` |
| `edits a worklog, and Time remaining moves by the difference` |
| `offers Edit and Delete on the signed-in user's own worklog only` |
| `deletes a worklog after the confirmation, and its time returns` |
| `adds a link where this issue blocks the other, with this issue as the blocker` |
| `adds a link where this issue is blocked by the other, with the other as the blocker` |
| `puts the five common types above the rest in the type select` |
| `refuses a link to an issue outside the project, and sends nothing` |
| `keeps Add off for the issue itself and for text that is not a key` |
| `removes a link at once, and the other issue shows the removal too` |
| `puts a link back, and says why, when Jira refuses the removal` |
| `opens the page of a linked issue` |
| `downloads an attachment through the save dialog, under the name it offered` |
| `writes nothing when the user cancels the save dialog` |
| `drops a file on the Attachments zone and it attaches` |
| `drops an image on the Attachments zone and it attaches without embedding` |
| `both zones light up while a file is dragged over the page, and clear on leave` |
| `drops a file on the properties sidebar, outside both zones, and it attaches` |
| `attaches a dropped file once, not once for the zone and once for the page` |
| `drops a file that is not an image on the description and it attaches` |
| `attaches a file chosen with the Attach file button` |
| `shows why an upload failed and keeps the page working` |
| `lists an image embedded in the description as an attachment` |

**Fake Jira.** `e2e-fake.ts` grows: `GET` and `POST /issue/{key}/comment`, `PUT` and `DELETE .../comment/{id}`; `GET` and `POST /issue/{key}/worklog` (`adjustEstimate=auto` moves the issue's remaining estimate and Time remaining as the live rule does), `GET`, `PUT` and `DELETE .../worklog/{id}`; `GET /issueLinkType` with eight types (Q19's five and three below the divider); `GET /issue/{key}?fields=issuelinks`, `POST /issueLink`, `GET` and `DELETE /issueLink/{id}`. Its seed gives PSAPAC-1 two comments (one by the test user), two links and a second attachment (`report.xlsx`), and PSAPAC-2 two worklogs. Writes hold on `releaseEdit` like every other write, and `refuseNextEdit` refuses the next one. `counts.downloads` records the stand-in dialog's calls and `cancelNextDownload()` makes it answer `null`.

## Alternatives

| Option | For | Against |
|---|---|---|
| **Pessimistic comment and worklog add and edit** (chosen) | No half-built row to reconcile; ids are Jira's; the form keeps the text on refusal | The row appears when Jira answers |
| Optimistic add with a temporary id | Instant | A rollback and id swap for a write that takes a round trip |
| **Delete optimistic with inline confirm** (chosen) | Matches the saved views and D6; reversible on refusal | A confirm step |
| Delete with an Undo toast | Linear's feel | The undo is a re-create with a new id and time |
| **`AdfEditor` for comments** (chosen) | Q34 says the same editor; D4 built it for this | One TipTap instance per comment |
| Plain textarea with Markdown | Light | Loses images, links and blocks; a second converter path |
| **Native save dialog in main** (chosen) | The renderer names no path | A stand-in for tests |
| `a[download]` with a blob in the renderer | No main code | Writes to a default folder with no choice, and gives the renderer the bytes of any size |
| **Page-level drop attaches, zones claim theirs** (chosen) | Q34 (a): drop anywhere | A `WeakSet` between two components |
| Only the two zones take drops | Simple | The #32 criterion is "file drop anywhere attaches" |

## Rollout

One pull request (#104), in commits after this doc: the main-process channels, the renderer sections, and the e2e fake with its tests. Back out by reverting the pull request: nothing persists locally, and Jira holds whatever the user wrote.

## Open Questions

- **Image in a comment.** The media node embeds in a description (live-checked for D4 on 2026-10-09). Shane ran the same check for a comment on 2026-10-10 (#32): the image rendered in live Jira.
- **Others' comments and worklogs.** Edit and Delete show for the signed-in user's own only. Say so if admin edits of others are wanted.
- **Attachment removal.** Not built (Attachments, Not built).
