# 0002: Issue Tree

**Status:** accepted
**Owner:** @shanedolley
**Refs:** #29

## Problem

D1 (#28, merged in #68) shows a flat list of unresolved issues, loaded in full before anything renders, beside an always-open detail pane. The main view Q5 asks for is the Tree: Customer, then Epic, then Story, Task or Bug, then Subtask, in collapsible groups, with mismatch badges (Q15), a No Epic group (Q17), Done chips (Q27, shown only while "Hide done" is off), three remembered toggles (Q28), a filter bar, `J`/`K` navigation and a space-bar Peek. Core's `buildHierarchy` (C7) and `issueMatcher` (C8) already compute the tree and the filters, and `jm issue tree` prints them. The app has to load all of PSAPAC without making the user wait for the 2029 Done issues, and render up to about 3200 rows without lag.

## Goals

- The Tree renders from core's `buildHierarchy`, with no grouping, sorting or Done rules of its own. Its mismatch badges and Done chips match `jm issue tree` for the same issues and toggles.
- The unresolved issues show as soon as their phase loads. Done issues then load in the background with a running count, and, while "Hide done" is off, the Done chips appear when they arrive.
- The list renders only the rows in view, so a keypress or a scroll costs the same with 3200 rows as with 30.
- "Hide done", "Assignee: me" and "Hide empty Customers" persist in `settings.json` under the existing `toggles` key.
- The filter bar holds core's `ViewFilters` shape, so D8 saves it as a view unchanged.
- The Tree works fully by keyboard, reads correctly as an ARIA tree, and leaves every single-letter key but `J` and `K` to D7.
- No new runtime dependency, and no change to a public contract.

## Design

### Layout

```
packages/core/src/hierarchy.ts  exports STATUS_ORDER; Hide done builds from open issues only
apps/desktop/src/
  shared/ipc.ts               issues:list takes a phase and a load id; new channels and the progress event
  main/backend.ts             per-phase loads with progress and abort; me, customers, serialised toggles
  main/handlers.ts            schemas for the new arguments; passes a progress sender through
  main/app.ts                 hands each handler the requesting window's sender
  preload/index.ts            onIssuesProgress
  renderer/src/
    queries.ts                the two phase queries, me, customers, toggles
    optimistic.ts             phase-aware summary edit
    tree.ts                   pure: mergeIssues, flattenTree, moveActive, windowRange, fallbackRow
    IssueTree.tsx             replaces IssueList.tsx: the virtual window, keys, scroll anchoring
    TreeRow.tsx               one row of any kind
    TreeToolbar.tsx           toggles, Filter and Groups menus, filter chips, text filter
    IssueDetail.tsx           becomes the Peek
    Shell.tsx                 owns the tree state; sidebar, Tree, and the Peek column while open
```

### Core Changes

Two changes to `@jira-mgr/core/hierarchy`, both in this story:

- **Hide done removes every Done issue** *(amended 2026-10-12, build of #199, by Shane; replaces the next paragraph)*. With "Hide done" on, `buildHierarchy` builds the tree from the open issues alone. A Done issue is never matched, never context and never a row, and no node has `doneChildren`, so no "N done" chip renders. An open issue under a Done parent attaches to its nearest open ancestor, else it is a root in its own Customer group, and a group left with no rows follows "Hide empty Customers". "Assignee: me" and a view's filters match open issues only, so a Done match keeps no ancestor: an open Epic of someone else whose only child is my Done Story shows nothing. Progress still counts Done children, because `childProgress` reads the issues, not the Tree. With "Hide done" off nothing changes. The superseded rule follows.
- **~~Done ancestors stay as context.~~** Under "Hide done", an open issue keeps its Done ancestors as `contextOnly` rows, with their other Done children dropped, whether or not a filter or "Assignee: me" is on. Today `buildHierarchy` rescues Done ancestors only inside its `assigneeMe || match` branch (`hierarchy.ts:89-104`), so with no filter a Done Epic drops with its open Story; once the app loads Done issues, that Story vanishes. This extends the orchestrator decision of 2026-10-07 for "Assignee: me" (handover, Open Decisions) to every case, decided by the orchestrator on 2026-10-09. The pinned test `drops a Done Epic with its whole subtree` becomes `keeps a Done Epic as context for its open child`, beside a new `drops a Done Epic whose children are all Done`. Core's README changes to match.
- **`STATUS_ORDER` is exported,** so the status filter lists statuses in the Q21 order without copying the list. A test pins the order.

The CLI's output does not change by default: with Done hidden it never loads the Done phase, so no Done issue is in its input. One case changes: an `epic` or `not.epic` filter loads the Done phase to climb from a Subtask, so under Hide done `jm issue tree` now drops the Done chips and Done context rows that `buildHierarchy` used to build from it (#199; the builder's call, disclosed on PR #204). Since #199 the app and the CLI agree: an open Story whose Epic is Done shows under No Epic in both, with no Done chips and no Done Epic row, whether or not the app's Done issues have loaded.

### Channels

| Channel | Change | Args | Result | Core |
|---|---|---|---|---|
| `issues:list` | Takes a phase and a load id | `{ phase: 'unresolved' \| 'done', loadId: number }` | `Issue[]`, or `null` when the load was aborted | `search#searchIssuePages` with `phases: [phase]` and a `signal` |
| `user:me` | New | none | `{ accountId, displayName }` | `lookups#getCurrentUser` |
| `fields:customers` | New | none | `{ id, value }[]`, the shape `buildHierarchy` takes | `lookups#getFieldOptions(http, 'customer')`, mapped as `jm issue tree` maps it |
| `settings:getToggles` | New | none | `{ hideDone, assigneeMe, hideEmptyCustomers }` | `state#readSettings` |
| `settings:setToggles` | New | the same three booleans, a strict object | the toggles stored | `state#readSettings`, then `writeSettings` with only `toggles` replaced |
| `issues:progress` | New event, main to renderer | | `{ phase, loadId, loaded }` | the `loaded` of each page `searchIssuePages` yields |

The toggles type is `Pick<HierarchyOptions, 'hideDone' | 'assigneeMe' | 'hideEmptyCustomers'>` from the renderer-safe `/hierarchy`, so `shared/ipc.ts` imports nothing Node-only. `issues:setSummary` is unchanged. The IPC contract is internal to the app, the error codes are unchanged, and `settings.json` keeps its shape, so none of this is a public contract change.

Each handler receives a second argument, `{ sendProgress(progress) }`. `app.ts` builds it from `event.sender`, skipping a destroyed sender, so progress reaches only the window that asked. Preload exposes `onIssuesProgress(listener)`, shaped like `onWindowFocus`. The renderer numbers each load it starts and ignores progress for any other `loadId`, so a superseded load cannot set the count back.

The backend serialises `setToggles` on a promise chain, so two quick presses write in order and the second never reads settings from before the first.

### Loading

PSAPAC holds 2793 issues: 764 unresolved and 2029 Done (round 2, measured 2026-10-07). At core's 100 per page, that is 8 pages, then 21.

1. The Shell starts `['issues', 'unresolved']`, `['toggles']` and `['me']` at once.
2. The Tree renders once the unresolved phase and the toggles have data, and `me` too when "Assignee: me" is on or the assignee filter holds `me`. Until then the list shows `Loading issues: 300` from the progress events. A partial phase never renders, because it can hold a Story whose Epic is on a later page.
3. `['issues', 'done']` is enabled once the unresolved query holds data. It runs whatever "Hide done" says, because progress counts need the Done issues and, with "Hide done" off, the Tree shows them as chips under open parents (Q27). `jm issue tree` skips the Done phase when hiding Done.
4. While Done first loads, the toolbar shows `Loading Done issues: 600`. The Tree works meanwhile with no chips. When the phase completes with "Hide done" off, the Tree rebuilds and the chips appear; with it on, the Tree does not change. A later Done reload shows no count, and the existing chips stay until its data lands.

The visible count is the text of an `aria-hidden` span, shown only while its query has no data. A `role="status"` region announces only the start and end of each first load, so a screen reader hears two messages, not 29.

`mergeIssues(unresolved, done)` builds the input to `buildHierarchy`: unresolved issues, then Done ones. An issue resolved between the two loads, or reopened since Done last loaded, appears in both. The merge keeps the copy whose `Date.parse(updated)` is later, the unresolved copy on a tie, since a duplicate key would duplicate a root row.

### Failures

| Fails | Shows |
|---|---|
| Unresolved, with no data yet | D1's error state: the message, Retry, and Log in again for `permission_denied` |
| Unresolved or Done refetch, with data | The Tree stays. A non-blocking banner above it reads `Could not refresh. Retry` |
| Done first load | The Tree stays. The banner reads `Could not load Done issues, so the "N done" chips are unavailable. Retry` |
| Toggles | The error state with Retry. An unreadable settings file also stops the search, so nothing useful renders without it |
| `me`, while needed | The error state with Retry in place of the Tree. The toolbar stays usable, so turning off "Assignee: me" and removing Me from the filter shows the Tree |
| Customers | The Tree builds as if "Hide empty Customers" were on, with a banner: `Could not load the Customer list, so empty Customers stay hidden. Retry` |

The error state replaces the Tree only while its query has no data, so a failed background refetch never blanks the screen.

### Cancellation

The backend keeps one `AbortController` per phase:

- A new `issues:list` for a phase aborts the load already running for it. TanStack Query only starts a second fetch of a query after it has discarded the first (a Retry, or a refetch after `cancelQueries`), so the aborted call has no reader.
- `session:logout` aborts both loads before core removes the token, so no page is fetched with a token that is going away.
- An aborted load returns `null` and logs nothing; it never becomes an `internal` error. Its `finally` removes the map entry only while the entry is still its own controller, so it cannot drop the newer load's.

The renderer still cannot abort a load by itself. These rules cover every case where a load's result would be discarded, so a cancel channel would add nothing.

### Freshness

ADR-0002's focus refetch applies per phase:

| Query | `staleTime` | On focus |
|---|---|---|
| `['issues', 'unresolved']` | 0, as D1 | Refetches (8 requests) |
| `['issues', 'done']` | 5 minutes | Refetches only when stale (21 requests) |
| `['me']`, `['customers']`, `['toggles']` | Infinity | Never. Logout removes `me` and `customers` |

Refetching 21 Done pages on every switch back to the app would cost more than it shows. Done issues change only when something is resolved or reopened, and the unresolved refetch sees both. A key that leaves the unresolved set was resolved, deleted or moved: the unresolved query function copies those issues, as last loaded, into the Done cache with `setQueryData`, then invalidates `['issues', 'done']`. The issue therefore stays in the Tree, with its old status, until the Done reload replaces it, instead of blinking out for the 15 seconds the reload takes. A reopened issue reappears in the unresolved set at once and wins the merge by `updated`.

`['customers']` is enabled only while "Hide empty Customers" is off, since `buildHierarchy` needs the option list only then.

### Optimistic Edits

The Tree and the Peek read from the phase caches, so D1's summary edit shows in both. `optimistic.ts` changes from one `['issues']` key to the phases that hold the issue, usually one, both while the merge dedupes it:

- `onMutate` cancels, and patches, every phase cache holding the key.
- `onError` rolls back in each of them, under D1's rule that it touches the issue only while it still shows the optimistic text.
- Touched phases go into a `WeakMap<QueryClient, Set<phase>>` beside D1's `inFlight` count. The last edit to settle invalidates every phase in the set and clears it.

An edit to an unresolved issue therefore never cancels or restarts the 21-page Done load. An edit to a Done issue cancels a Done load in flight, whose result TanStack discards, and the invalidation on settle starts it again from the first page. The chips keep their data meanwhile. D1's README listed "a saved summary refetches the whole list" as a limit for D2; this narrows it to the issue's phase. Re-reading only the edited issue through `getIssue` belongs with D3, whose pickers make edits frequent.

### Tree Model

The Shell derives everything during render, with `useMemo`:

1. `issues = mergeIssues(unresolved, done ?? [])`
2. `match = issueMatcher(filters, { accountId })` from `/view-filter`
3. `groups = buildHierarchy(issues, { ...toggles, accountId, customers, match })`, with `match` left out when `undefined`, as core's README directs
4. `rows = flattenTree(groups, { collapsed, revealed })`

`filters` passes through `useDeferredValue`, so typing in the text filter stays responsive while the Tree rebuilds.

`flattenTree` turns `CustomerGroup[]` into the visible rows, in this order: each Customer header; its Epics, each followed by its children (in the chosen order, as core orders them), then the Epic's Done chip; then its No Epic header and those issues. A node's subtree and chip appear only when the node is expanded. A chip's Done children appear only when the chip is revealed, one level below it.

| Kind | Id | Level | Shows | Expandable |
|---|---|---|---|---|
| Customer header | `c:<option id>`, `c:none` | 1 | The Customer's name, or "No Customer", and its issue count. An empty group shows "No issues" | When it has rows |
| Issue | `i:<key>` | 2 for an Epic, 3 for a child, 4 for a Subtask; one more under a chip | Status, key, type, summary, mismatch badge, assignee; an Epic adds its issue count. The summary draws in `--muted`, the key's colour, on every row, ink on a checked row as the key is (#266, #300). It draws at weight 400 on a `contextOnly` row and 500 otherwise | When it has children or Done children |
| No Epic header | `n:<option id>`, `n:none` | 2 | "No Epic" and its issue count | Yes |
| Done chip | `d:<parent key>` | The parent's level plus one | "N done" | Yes: revealing lists the Done children |

A count is the number of issues in the subtree, context rows included and issues behind a chip excluded. Each row also carries `parentId`, `expandable`, `setSize` and `posInSet` among its siblings, chips included. Ids are stable across refetches and toggles, since an issue appears once in the Tree and a Customer once at the top.

**Mismatch badge.** Shown exactly when `node.customerMismatch !== null`, the condition `jm issue tree` prints as `[Customer: X, Epic: Y]`. The row shows a compact "Customer" badge with a tooltip naming both, such as "Customer: Acme. Epic's Customer: Beta Ltd." The Peek shows both in full. The one-click "match Epic's Customer" fix (Q15) ships with D3, which builds the Customer edit and its optimistic mutation; D7 then adds its undo.

**Done chip.** Shown exactly when `node.doneCount > 0`, the condition `jm issue tree` prints as `+N done`. It reads "N done", and "Hide N done" while revealed.

**Tree state.** The Shell holds the active row id, the Peek's issue key, `revealed` (a `Set<string>` of chip ids; every chip starts hidden) and the overrides: a `Map<string, boolean>` of the rows the user opened or closed by hand, `true` for closed. The set `collapsed` is derived on each render: `levelCollapsed(groups, level)` closes every expandable row at or below the stored level, except an issue at Story depth or below shown only as context, and `withOverrides` layers the hand toggles on top. `changeOverrides` records a toggle by adding only the rows whose state changed, so an override for a row a filter hides survives. A row that appears later, from a refetch or from loading Done issues, follows the level, and a row toggled by hand keeps its state. Holding the overrides in the Shell keeps them through refetches, failures, toggles and filters; they last for the session. Picking a level clears them, and clears `revealed` unless the level is Everything. A chevron click is never written to Jira or a file.

**Level.** The level is one of Customers, Epics, Stories or Everything, and the default is Stories. Customers closes every Customer header. Epics keeps the Customer headers open and closes each Epic and No Epic header. Stories keeps those open and closes each Story, Task and Bug (every level 3 issue), so their Subtasks and the Done chips under them stay hidden; an Epic's own Done chip shows. Everything closes nothing. The Shell stores it in `settings.json` as `treeLevel` through `settings:getTreeLevel` and `settings:setTreeLevel`, with the same optimistic mutation as the toggles, and shows "Loading settings" until it reads. Saved views do not carry the level and applying a view leaves the expansion alone. The CLI ignores it.

**A filter keeps its matches.** Two rules keep a narrowed Tree from hiding what narrowed it (decided 2026-10-13, approved by Shane 2026-10-14, #209). An issue at Story depth or below shown only as context, an ancestor of a match that does not match itself, is always open, whatever the level and whatever narrows the Tree, "Assignee: me" included, so my Subtask under someone else's Story still shows. A context Epic is not exempt: under "Assignee: me" alone the Epics level closes an Epic that is not mine, so there Epics hides the Stories below it, my Subtask included, behind a row that shows its count, and Stories no longer equals Epics (adopted from the PR #210 review, 2026-10-13). And while the filter bar narrows the Tree (the Shell's `issueMatcher` returns a matcher), the level closes no issue and no No Epic header, so a match nested under a match shows too. "Assignee: me" alone does not count as filtering, because it is on in daily use and would stop the level applying: with it on and no filter, my own Story with my own Subtask is closed at Stories. With neither rule in play the level applies untouched. Both rules live in `levelCollapsed(groups, level, filtering)`, not in the hand overrides, so clearing the filter returns the Tree to the level, and a row closed by hand stays closed for the session. The Customer headers always follow the level. So while the filter bar narrows, only Customers can hide matches, behind a header that shows its count; under "Assignee: me" alone, Epics, No Epic and Customers can hide them, behind an Epic row, the No Epic header or a Customer header that shows its count. The No Epic header is the Epic level's peer and stays open while the filter bar narrows. Putting a row back to the state the level gives it drops its hand toggle (`changeOverrides` takes the level's closed rows), so it follows the level again.

**Active row fallback.** When a rebuild removes the active row, `fallbackRow(previousRows, rows, id)` picks the next surviving sibling, then the nearest ancestor still in the rows, then the row now at the old index.

### Virtualisation

| Case | Rows |
|---|---|
| Worst case: "Hide done" on, Everything level | up to 764 issues, 42 Customer and up to 42 No Epic headers, with no chips, since Hide done removes them: about 800 |
| "Hide done" off, every chip revealed | 2793 issues, 84 headers and the chips: about 3200 |
| Rows in view in an 800-pixel window | about 22 |

Rendering 3200 rows would mount around 25 000 DOM nodes and reconcile all of them on every rebuild, such as each keystroke in the text filter. Every row has one fixed height, 32 pixels, since summaries truncate to one line and badges, counts and chips sit inline. With fixed heights the window is arithmetic, a few dozen lines with no dependency:

- The scroll container holds one inner element `rows.length * 32` pixels tall. A `ResizeObserver` tracks the container's height, and `onScroll` its `scrollTop`.
- `windowRange(scrollTop, height, count, activeIndex)` returns the sorted indices to render: those in view plus 10 rows of overscan each side, and `activeIndex` wherever it is, so `aria-activedescendant` never points at a missing element. Each row is absolutely positioned at `index * 32`.
- A keyboard move scrolls the active row into view by setting `scrollTop`.
- **Scroll anchoring.** Before a rebuild commits, the Tree notes the first visible row's id and its offset from the top. A `useLayoutEffect` finds that id in the new rows and sets `scrollTop` so it sits at the same offset, before paint. Chips arriving or a Story moving under its Epic above the viewport therefore shift nothing in view. When the id is gone, `scrollTop` stays.

That renders about 42 rows at any moment. The window keeps D1's 900-pixel minimum width, and the Peek column takes width from the summary, never from the key or status.

### Toggles and Filter Bar

The toolbar above the Tree holds three toggle buttons, a Filter menu, a Groups menu, the active filter chips and a text field. It wraps onto a second line when the chips need it.

**Toggles.** "Hide done", "Assignee: me" and "Hide empty Customers", each a `button` with `aria-pressed` equal to the stored boolean and a check mark when pressed, so the state does not rest on colour. A press updates `['toggles']` in the cache at once, so the Tree rebuilds, then writes through `settings:setToggles`. A failed write refetches `['toggles']`, so the toolbar shows what the file holds, and shows the error in a `role="alert"` under the toolbar. First launch reads core's defaults: on, off, on (Q28). The CLI keeps ignoring `settings.toggles`, as design 0001 decided.

**Master checkbox (#300).** A native `<input type="checkbox">` named "Select all rows" sits before the toggles, and only while at least one shown row is checked. It shows a dash when some shown checkable rows are checked and a tick when all are. A click with some checked calls `selectAll` (the function behind `Cmd+A`), which checks every checkable row shown under the current filter, "Hide done" and collapsed groups; a click with all checked calls the `Esc` clear, after which the master goes. A row hidden by a filter, "Hide done" or a collapse is never checked, and expanding it later does not check it. `checkState(rows, checked)` in `tree.ts` gives `none`, `some` or `all`; a checked key no row shows (a running batch) is not counted. Tab reaches the box and Space presses it.

**Selected look (#300).** Only a checked row draws `--row-selected` (`--row-selected-focus` when it is also the focused active row), weight 500, a bold ink key and an ink summary. The Peek's row draws none of it: it carries `aria-current` and the Peek's own panel names its issue. The active row, which hover and the keys move, keeps its `--hover` fill, or `--row-focus` while the Tree has focus. The fills differ by WCAG contrast of 1.06 (light) and 1.29 (dark) between hover and selected, and 1.03 and 1.16 between hover and focus.

**Filters.** The state is one `ViewFilters` object in Shell state, with its values stored exactly as core and the CLI read them:

| Field | Choices | Value stored |
|---|---|---|
| Assignee | Me, Unassigned, then each assignee among the loaded issues | `me`, `unassigned`, or an accountId |
| Status | Every status in `STATUS_ORDER`, then any other loaded status | The name |
| Label | The labels among the loaded issues | The label, exactly |
| Type | The types among the loaded issues | The name |
| Sprint | Current sprint, then each sprint among the loaded issues | `current`, or the sprint id |
| Text | The text field: key or summary | `text` |

The filter can only match loaded issues, so choices other than statuses come from them and need no channel. The Filter button opens a native `popover` listing the five fields; each opens its choices as a checkbox list (a submenu beside the list since #305). Each active field shows as a chip such as "Status: To Do, In Progress", with a remove button, and "Clear" empties every field. As in `jm issue tree`, a matching issue keeps its ancestors as context rows, which draw their summary at regular weight (400) where a matching row's is medium (500), so a matching Story keeps its Epic.

**Groups.** A menu with the four levels, shallowest first: Customers, Epics, Stories and Everything. The current level is pressed (`aria-pressed`, as the Display menu's buttons are). Picking one stores it (picking the current level writes nothing), clears the rows opened or closed by hand and, unless it is Everything, hides every revealed chip. It works with no row shown. Customers and Everything are the `Shift+ArrowLeft` and `Shift+ArrowRight` keys, so Customers also makes the row's Customer header active.

**Feedback.** After a toggle or filter change settles for 500 milliseconds, a `role="status"` region announces "N issues shown". When nothing matches, the Tree area reads "No issues match", names the toggles that are on ("Hide done and Assignee: me are on"), and offers Clear filters when a filter is active.

*Amended 2026-10-14, build of #222.* Shane decided the direction saved per view, Key by key alone and the Status order. The orchestrator decided the literal meaning of `asc` and `desc` and the per-order default direction, which Shane approved by closing #222 on 2026-10-15. The Display menu's Ordering gains Status and a Direction (Ascending, Descending, saved with the order in `display.direction`). Key now orders by key number alone at every level; before, Stories, Tasks, Bugs and Subtasks sorted by status first. Status is its own order: `STATUS_ORDER`, then key. Direction is literal: `asc` runs the lowest key, lowest priority, oldest update, soonest due date and first status first, and `desc` reverses each, with undated issues last under Due date and an unlisted status last under Status either way. Each order has a default direction that keeps its primary sort as it was: `desc` for Key, Priority and Updated, `asc` for Due date and Status (`ORDER_DEFAULT_DIRECTION`). A display with no direction reads as its order's default, and choosing another order in the menu sets that order's default. Ties between equal values break by key in the chosen direction; before, they broke newest key first. `buildHierarchy` takes `direction`; Customer groups keep their order.

*Amended 2026-10-14, build of #223.* Shane chose a local order per view, saved in the views file and never written to Jira. The orchestrator's rules, which Shane approved by closing #223 on 2026-10-17: Manual is a sixth choice under Ordering; a row moves only among its siblings under one parent (the Epics of a Customer, the issues of No Epic, an Epic's children, a Story's Subtasks, the Done children behind a chip); Customer groups keep their own order; an issue the list does not name sits after the named ones by key ascending; the Direction buttons are disabled under Manual, which carries `asc`. The list is `display.manual`, issue keys in depth-first display order, kept in `settings.json` for the Tree on screen and in a saved view's `display` for each view, so applying a view restores its list and Update view saves the current one. `buildHierarchy` takes `manual`; `treeOrder`, `siblingKeys`, `moveInManualOrder` and `sortedByManual` hold the rules, in core. A move gives the siblings the slots they held in the list, so a sibling hidden by a filter keeps its place between them.

Any issue row can be dragged. Dragging a row onto a sibling puts it in that sibling's place (above when the row moves up, below when it moves down), and a drop on another parent's row, a header, a chip or outside the Tree does nothing and records nothing. A drop line (`data-drop`, a 2px accent inset on the edge) shows the landing place; when the drag moves down past a sibling that shows its children, the line sits below the sibling's last visible row, since the issue lands after them. The dragged row dims (`data-dragging`) and becomes the active row, which also keeps it mounted if the drag scrolls it out of the window. A row that refuses the drag still accepts `dragenter`, or the browser sends later `dragover` events to the body and the line sticks to the last accepted row. `Alt+Shift+Up` and `Alt+Shift+Down` move the active issue one place among its siblings. A drag or a key under another order makes the display Manual, starting from the order on screen (`treeOrder`). Choosing Manual in the menu does the same, unless the display already holds a list, which it restores.

A move is announced through the Notice region ("Moved PSAPAC-12 to position 2 of 5", or "PSAPAC-12 is already first among its siblings" at an end) and shows the same toast an edit does, with an Undo button. It goes on the undo stack as an `OrderEntry` holding the display before and after; `Cmd+Z` writes back the order, direction and list only (a property toggled since stays), unless the order, direction or list changed since, which it reports and leaves alone. Quick key presses can outrun the render, so a move reads the display from the query cache and sorts the siblings by its list before it picks the target. There is no Linear reference for a drag line: `docs/design/linear/` holds no reorder capture, so the line follows the saved views list's drop edge.

*Amended 2026-10-17, build of #254.* Shane asked for the original estimate, the work logged and the time remaining as Display properties, the last both as hours and minutes and as a percentage. The Display properties gain four chips, in this order after Sprint and before Due date: Original estimate (`estimate`), Logged (`logged`), Remaining (`remaining`) and Remaining % (`remainingPercent`). Shane decided the four chips, that Remaining % is 100 minus the Peek's Used% and that the Sprint page shows them too. The orchestrator's rules, which Shane approved by closing #254 on 2026-10-18: hours and minutes use `formatEstimate` (`2h 30m`) with no working-day conversion; Remaining is Jira's remaining estimate and can disagree with Remaining % after a hand edit; Remaining % floors at 0% and is empty without an original estimate; an issue with no value and an Epic show an empty slot, and a Customer or No Epic header shows none; values are the issue's own, with no subtask roll-up; the Sprint page reads the same `display.properties` and renders the same slots at any width; in a narrow Tree the trailing properties drop for every row at once, sized for the deepest row and the widest extras, so the columns line up (#275 replaced the whole-column drop with narrower trailing columns). The settings and views files stay readable both ways, since an older build drops the names it does not know.

*Amended 2026-10-17, build of #276.* Shane asked to select the original estimate and edit it on the main canvas. The Original estimate slot of #254 becomes a text field in place on the Tree and the Sprint page (`EstimateCell`), and the Tree's key handling now leaves any `input` its keys. The orchestrator's rules, which Shane approved by closing #276 on 2026-10-18: a click on the slot, filled or empty, opens the field, makes the row active and does not open the Peek (`clickRow` takes `activate`); Enter saves, Escape cancels and leaving saves a valid draft and drops an invalid one; a draft that is not a Jira duration, or an empty one on an issue with an estimate, keeps the field open under a hint, since the write path cannot clear an estimate; the duration is Jira's own form read by `parseEstimate`, as the issue page does, with no working-day conversion; the save is `editIssue`'s `originalEstimate` through the issue page's optimistic path, so Remaining and Remaining % re-read after it settles and a refusal reverts with a Retry toast; a Hold-faded row stays editable; `Shift+E` from the Tree focuses the in-row field, and falls back to the issue menu when the row does not show the slot; an Epic has no field. The row being edited is the active row, which the virtual window keeps mounted. While an estimate field is open on a Hold row, the fade moves from the row's content to each part except the field, so the field and its hint draw at full strength. The Sprint page's slot is a `Slot` button beside the row's own button (#279), so it takes Enter and Space itself, and the open field stops its clicks and its space keyup from reaching the row.

*Amended 2026-10-17, build of #274.* Shane asked for the sprint on the canvas as a number and an end date. Amended 2026-10-18, #273: the end day left the canvas, so the Sprint slot of a Tree row and of a Sprint page row shows `sprintLabel(sprint)` from `@jira-mgr/core/display`: `S 36` for "Sprint 36", and the full name (truncated by the slot) when the name holds no number. The slot keeps the sprint's end day in its `title` (`sprintTitle`, "Sprint 36, ends 2026-10-18"), and the row's accessible name ends with "sprint Sprint 36, ends 2026-10-18" while the Sprint property is on. The orchestrator's rules, which Shane approved by closing #274 on 2026-10-18: the number is the last run of digits in the name before any bracket, so `PS Sprint 36 (05 Oct-18 Oct)` reads 36 and `PS Sprint 41,42(14 Dec-08 Jan)` reads 42; leading zeros drop (`PS Sprint 09` is `S 9`); the end day is the date part of Jira's timestamp, not the local day (PSAPAC sprints end at 14:00Z, the next day in Sydney, while the name says 18 Oct). The issue's sprint objects gain `endDate` (additive, `null` when Jira sends none), which `jm` `--json` output carries too; the sprint picker lists `sprintDates` (#273). The issue page, the Sprint page header and `jm` text output keep the full name. The slot is 104px (`SLOT_WIDTH.sprint` in `propertyFit.ts`), a step up from the other 96px slots. It dates from the longer label and is wider than `S 36` needs; a user resizes it with the column header (#275).

*Amended 2026-10-17, build of #217.* A Hold or On Hold issue draws as a dashed To Do ring at 30% opacity (Shane, 2026-10-14 and 2026-10-15), and on 2026-10-17 he asked that every field of its row fade the same, the issue number and the avatar included. `holdFade(status)` in `StatusDot.tsx` fades the row's content to `HOLD_OPACITY` at one element: in the Tree a wrapper around everything after the checkbox and chevron, on the Sprint page a wrapper in the row's content beside the row button, in the palette a wrapper inside the option, and in the Epics table each cell of the row (the first cell fades its key and summary inside the focus button, so the button's outline stays at full strength), since a table row cannot fade its content without fading its hover fill. So the type icon, key, summary, priority glyph, every Display slot, the pills, the timer clock, the status name and the avatar fade together, and the row's focus ring, selection and hover fill do not. `styles.css` holds the ring at 100% inside `[data-hold]`, so it ends at 30%, not 9%. A Sprint page `Slot` inside the wrapper that has keyboard focus must draw its own ring in full, as the open estimate field does (#276), so then `styles.css` moves the fade from the wrapper to each of its children but that slot (#279). Peek, the issue page, the pickers, the delete dialog and the text of the Sprint page's group headings keep full strength (the Hold group's ring stays at its own 30%), and the accessible name is unchanged. Faded text is exempt from the 4.5:1 contrast rule by Shane's decision (`contrast.test.ts` keeps a 1.3:1 floor).

*Amended 2026-10-17, build of #275.* Shane asked for column names and separators after the title, widths he can drag down to 0px, and the column removed when the mouse is released at 0px. A header row (`ColumnHeader`) sits above the Tree's list from the `@tree` width up and names each Display property with the Display menu's label, right-aligned over the values; the key, status, priority and avatar get none. `fittingCount` and its uniform drop are gone. Each column draws at the user's width, saved per view as `display.widths` (a property name to whole pixels, additive and lenient: [config.md](../reference/config.md#settingsjson)), else at its default (`SLOT_WIDTH`). The Tree sets the widths as CSS custom properties (`--col-labels` and so on) on its container, which the cells and the header read, so a drag repaints with no render per row and `TreeRow` stays memoised. The orchestrator's rules, which Shane approved by closing #275 on 2026-10-18: a separator sits on the left edge of its column (the first after the title), because the strip hangs from the avatar and a column grows leftwards, so the pointer stays on the edge it drags; a drag moves in whole pixels from 0 to a cap that leaves the title `5rem` in the deepest row with the widest extras (`stripRoom`, `dragCap`); a narrow window draws the trailing columns narrower, to 0, and keeps the saved widths (`fitWidths`); at 0 the column is empty, its separator turns red and a status line reads `Release to remove <name>`; release at 0 removes the property and drops its width exactly as turning its chip off does (`withoutProperty`, through `useSetDisplay`), so the view stays lit and adding the property back starts at the default; a release above 0 saves the width; Escape cancels; the header is never faded. Each separator is a focusable `role="separator"` (`aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax`, "Resize Original estimate column"): Left widens and Right narrows by 8px, 32px with Shift, Right stops at 1px, and Delete or Backspace removes the column. Pointer events with capture on the separator keep a drag from starting a row drag, selecting text, changing the active row or opening the Peek. The header ends 44px plus the list's scrollbar (`offsetWidth - clientWidth`) from the right, so it lines up on Linux's 15px scrollbars as on macOS. Below `@tree` the strip and the header stay hidden. The Sprint page shows one header row above its first status section at the same widths, drawn only, and floors every column at 16px because its cells are buttons, so a column the Tree draws at 1px is wider there; its wrapped rows do not line up with it.

*Amended 2026-10-11, build of #139:* the Filter menu lists 15 fields, not five: Creator, Status type, Priority, Customer, Engagement, Epic, Relations, Due date, Created and Updated join the five above. Every field but the dates has an "is" and "is not" switch, a field can hold both, and each field and operator draws its own chip. The new values are stored as `ViewFilters` keys beside the old ones, `not` holds the excluded values, and `dates` holds one window per date. [config.md](../reference/config.md#viewsjson) lists them.

*Amended 2026-10-19, build of #305.* Shane wants the Filter menu to list only the fields, with a field's values in a submenu beside the list instead of expanding inline. He accepted these defaults on 2026-10-19:

- The main menu keeps its width and position and lists the 15 fields, each a 32px row with its icon, label, held count and a right chevron. No field expands in place, so the menu does not change height.
- A field opens its submenu on a click, `Enter` or `Right` (focus goes to the submenu's search box) and when the pointer rests on it for 150ms (focus stays). The submenu opens to the right of the list, level with its field, and flips to the left, above the field, or both where the window has no room (`position-try-fallbacks: flip-inline, flip-block, flip-block flip-inline`). Its height is capped at half the window's, which always fits above or below the field, and the list scrolls inside it. The submenu starts at the menu's edge, past any scrollbar. A pointer resting on a field swaps the submenu, except while the focused search box holds text, and a field that takes focus closes any other open submenu. One submenu shows at a time, and a pointer that rests on another field swaps it. Every pointer move restarts the 150ms, so a diagonal move toward the submenu across other fields swaps nothing.
- The submenu is an auto popover inside the menu's, so a press in it is a press in the menu. It holds a search box (every field's, the dates included), then the "is" and "is not" switch on a field that has one, then the checkbox list, which scrolls past `max-h-56`. Checking a value applies the filter and leaves both menus open.
- The search narrows the values to those whose label contains the text, ignoring case. A checked value it hides stays checked, and a search that matches nothing reads "No matches". Closing the submenu clears the text.
- `Down` and `Up` on a field move between fields; on the search box and the checkboxes they move through one list. `Left` in the submenu closes it and focuses its field, except in a non-empty search box, where it moves the caret. In the search box `Esc` clears a non-empty text first. `Esc` otherwise closes the submenu, and `Esc` on a field closes the Filter menu. A click outside closes both.
- A field is a `button` with `aria-haspopup="true"` and `aria-expanded`. The search box is named "Search <field>". `FilterMenu.tsx` holds the menu.
- Only the Tree has a Filter menu. The issue named the Sprint page as a second place, but that page draws no toolbar of its own, and the Tree's toolbar is inert under it.

Filters reset on restart. Q28 asks only the toggles to persist, and saving filters is what saved views are for.

**Left for D8.** The views list in the sidebar, applying a view (`applyViewToggles`, then the view's filters replace the bar's), the starters "My issues" and "Current sprint", and create, rename and delete. D8 also decides whether applying a view writes its toggles back to `settings.json`. D2's state already has the `{ filters, toggles }` shape `createView` takes.

### Keyboard and Focus

The Tree is one focusable element, `role="tree"` with `aria-label="Issues"` and `tabIndex={0}`, and it takes focus when it first renders. It tracks the active row with `aria-activedescendant` rather than moving DOM focus row to row, because the window unmounts rows. Its `onKeyDown` calls `moveActive(rows, state, event)`, a pure function returning the next active id, collapsed set, revealed set, Peek state and, for `Shift` with the side arrows, the level to set, or `null` for a key it does not handle.

| Key | On an issue row | On a header or chip |
|---|---|---|
| `J`, `ArrowDown` | Next row | Next row |
| `K`, `ArrowUp` | Previous row | Previous row |
| `PageDown`, `PageUp` | One window height down or up | The same |
| `ArrowRight` | Expands; when expanded, moves to the first child | The same; a chip reveals |
| `ArrowLeft` | Collapses; when collapsed or a leaf, moves to the parent row | The same; a chip hides |
| `Shift+ArrowLeft`, `Shift+ArrowRight` | Set the Customers level, set the Everything level; Customers makes the row's Customer header active. Both are stored | The same |
| `Home`, `End` | First or last row | First or last row |
| `Enter` | Opens the issue: the Peek until D3, the issue page after. With the Peek open, moves focus into it | Expands or collapses; a chip reveals or hides |
| `Space` | Opens or closes the Peek | Nothing |
| `o` | Opens the Peek on the active issue, or switches an open Peek to it; never closes it | Nothing |
| `O` (`Shift+o`) | Opens the issue page | Nothing |
| `Esc` | Closes the Peek when open | The same |

`J` and `K` match in either case, so Shift and Caps Lock make no difference. Moves stop at the first and last rows. The Tree calls `preventDefault` on every key in the table, `Space` and the page keys included, so the container never scrolls by itself. The pointer moving over a row makes it active (#299), with no click. A click on a row's chevron expands or collapses it, and a click on a header or chip toggles it; a click on blank issue-row space does nothing. A cell with its own editor (a status dot, avatar, priority, Labels, Sprint, Due date or Start date slot, or the Original estimate field) leaves the Peek as it is.

**Focus.** After any toolbar control acts (a toggle, a chip's remove, Clear, a Groups item) and when the Filter popover closes, focus returns to the Tree, so `J` and `K` work at once. `Esc` routes by where focus is:

| Focus | `Esc` |
|---|---|
| The text filter | Clears it; when already empty, returns focus to the Tree |
| The Peek's summary field | Cancels the edit and returns focus to the Tree |
| The Filter popover | Closes it; focus returns to the Tree |
| The Tree | Closes the Peek |

Closing the Peek by `Esc`, `Space` or its Close button returns focus to the Tree.

**ARIA.** Rows are a flat list of `role="treeitem"` elements, each with an `id`, `aria-level`, `aria-setsize`, `aria-posinset`, and `aria-expanded` on expandable rows only. `aria-selected="true"` marks only the checked rows, and `aria-current="true"` the row the Peek shows (#300); neither marks every row `J` and `K` pass. Each row's accessible name follows one format:

| Kind | Name |
|---|---|
| Issue | `PSAPAC-120, Story, To Do, Build the loader, Ann Lee` (or `unassigned`), then `, Customer differs from Epic` and `, context` when they apply |
| Customer header | `Acme Corp, 12 issues` |
| No Epic header | `No Epic, 3 issues` |
| Done chip | `4 done` |

Rows contain no buttons, since a `treeitem` holds no focusable children: the Tree's keys, the pointer's hover and a click on a summary or slot are its controls. The active row carries a focus ring of at least 3:1 contrast, distinct from the hover background and from context rows, in both themes. Context rows keep WCAG 2.2 AA text contrast. Expanding animates nothing, so `prefers-reduced-motion` needs no case.

**Boundary with D7.** The handler sits on the Tree element, so it never sees a keystroke typed into the text filter or the Peek's summary field, which the React standard requires. It ignores any event with `metaKey`, `ctrlKey` or `altKey`, so `Cmd+K` and `Cmd+Z` pass through. D7's global shortcuts (`C`, `S`, `A`, `L`, `P`, `E`, and `T` in D9) share no key with it. D2 lifts the active issue key to the Shell, where D7 reads it as the target of `S`, `A` and the rest. When D7 adds its global `Esc`, it skips events already handled (`defaultPrevented`).

Every shortcut has a visible alternative: a double-click for `Enter`, the Peek's Open button for `Shift+O`, the Peek's Close button for `Esc` and `Space`, the chevron and chip for the arrows, and the Groups menu's Customers and Everything for `Shift` with the side arrows.

*Amended 2026-10-17, build of #267.* Shane wants to select the status on the canvas and edit it there, in a popover over the row instead of the Peek. The orchestrator decided these, and Shane approved them by closing #267 on 2026-10-18:

- A click on a row's status dot opens the Status list as a popover anchored to the dot, the cell editor (`CellEditor.tsx`, documented in the desktop README). The click makes the row active and does not open the Peek, arm the double-click, change the checked rows or select text. `Shift+click` still checks a range.
- `S` on the Tree opens the same list on the active row's dot. The list is the Peek's Status picker (`StatusPicker`) with its options, transitions, optimistic patch and refusal toast, so a refused transition reverts the dot and offers Retry. `Esc`, a choice or a click outside closes it, and focus returns to the Tree with the row still active. Arrows, `1` to `9` and Enter work as in the Peek.
- A Hold row stays editable: the fade is a reading aid, not a lock.
- The Sprint page's rows gain a status `Slot` button beside the row button (#279), so the row still opens the issue. It is in the tab order and named "Status of PSAPAC-4: In Progress". The Epics page stays read-only.
- The Tree still holds no buttons: the dot is a click target, and its keyboard path is `S`.

*Amended 2026-10-18, build of #268.* Shane wants to select the avatar on the canvas and pick a new user there. The orchestrator decided these, and Shane approved them by closing #268 on 2026-10-18:

- A click on a row's avatar opens the Assignee list as a cell editor popover anchored to the avatar, as the status dot does, and opens no Peek. The row's old route, a click that opened the Peek and clicked its `A` control, is gone. `A` on the Tree opens the same list on the active row's avatar; with a page open it still opens the page's picker.
- The list is the Peek's `AssigneePicker`, with the search field first. A choice applies at once and reverts with a Retry toast on refusal; `Esc` closes it with no write.
- An unassigned row's dotted person is a click target too. A Hold row stays editable. `Shift+click` still checks a range.
- The Sprint page's rows get the same target as a `Slot` around the avatar, named "Assignee of PSAPAC-4: Test User" or "Assignee of PSAPAC-3: Unassigned" (#279's pattern), so the row button still opens the issue and no control nests in another.

*Amended 2026-10-18, build of #270.* Shane wants to select the due date on the canvas and edit it there. The orchestrator decided these, and Shane approved them by closing #270 on 2026-10-18:

- A click on a row's due-date slot, filled or empty, opens a popover anchored to the slot with the Peek's native date field and a Clear button, the third cell editor (`DateEditor.tsx`). No calendar library is added. `Shift+D` opens it on the active row when the property is shown, and the issue menu's field otherwise.
- Enter or leaving the field saves the date; Esc drops it; Clear sends `null`. A picked date saves the same way, not on the pick, because typing a date fires a change at every digit of the year. The edit is optimistic with a Retry toast on refusal. A Hold row and a Done issue stay editable.
- The slot keeps its width, with a hover fill as the only change, and its title names the key.
- The Sprint page's due slot is a `Slot` button named "Due date of PSAPAC-4: none" that opens the same editor, with the focus returning to it, beside the row button and not inside it (#279).

*Amended 2026-10-18, build of #269.* Shane wants to select the priority on the canvas and edit it there. The orchestrator decided these, and Shane approved them by closing #269 on 2026-10-18:

- A click on a row's priority slot opens the Priority list as a popover anchored to the slot, the same cell editor as the status dot. The slot is a click target whether it draws bars or is empty, since Medium and an unset priority draw nothing: an empty slot shows a faint outline on hover, and the rounded dot and avatar fill instead. The slot keeps its 16px, so columns do not shift. The tooltip reads "Change priority"; the row's accessible name still carries `priority <name>` when the bars show.
- `P` on the Tree opens the same list on the active row's slot. It is the Peek's Priority picker (`PriorityPicker`) with its options, optimistic patch and refusal toast, so a refused priority removes the bars again and offers Retry. `Esc`, a choice or a click outside closes it, and focus returns to the Tree. The Peek's and the page's Priority pickers and the palette's "Change priority" are unchanged.
- A Hold row stays editable, and its slot keeps the row's fade.
- The Sprint page rows drew no priority, so each gains the same slot, after the summary and before the row properties: a `Slot` button named "Priority of PSAPAC-4: Medium" around the Tree's glyph slot, drawn or empty, that opens the same list. It is in the tab order after Status, sits inside the row's Hold fade, and the row button still opens the issue. It shows even when the Display menu has no properties on, since it is a cell and not a Display property.

*Amended 2026-10-18, build of #272.* Shane wants to select the labels on the canvas and edit them there. The orchestrator decided these, and Shane approved them by closing #272 on 2026-10-18:

- A click on a row's labels slot, filled or empty, opens the Labels picker as a cell editor anchored to the slot. The whole slot (96px by default) is the target (`data-pick="labels"`), not the chip or the "+N" alone, so an empty slot has a target too. It shows the first label and "+N" as before, and the list shows every label. The click makes the row active and does not open the Peek, arm the double-click, change the checked rows or select text. Its `title` reads "Add labels" while the slot is empty.
- `L` on the Tree opens the same list on the active row's slot. When the Display menu leaves Labels off, or the Tree is too narrow to draw the slot, `L` opens the Peek's picker as before.
- The list is the Peek's `LabelsPicker`, a multi-select: each toggle writes at once through `editIssue` with `addLabels` or `removeLabels` and updates the slot before Jira answers, and the list stays open. A refusal reverts that one label and offers Retry. The type-ahead creates a new label from text without a space. `Esc` or a click outside closes the list, and focus returns to the Tree with the row still active. Enter chooses the active option and never closes the list; `Esc` does.
- A Hold row stays editable, as with the status dot.
- The Sprint page's labels slot offers the same picker. It is a `Slot` button beside the row's own, named "Labels of PSAPAC-4: docs" ("none" when empty), in the tab order, so Enter or Space opens the list and the row button still opens the issue.
*Amended 2026-10-18, build of #273.* Shane wants to select the sprint on the canvas and edit it there. The Sprint slot is the sixth cell editor cell. The orchestrator decided these, and Shane approved them by closing #273 at 2026-10-18T23:42:54Z:

- A click on a Tree row's Sprint slot opens the Sprint list as a popover anchored to the slot, through the cell editor. The click makes the row active and does not open the Peek. `Shift+C` opens the same list on the active row's slot; when the Sprint Display property is off, or the Tree is too narrow to draw its slots (an open Peek), there is no visible slot, and `Shift+C` falls back to the issue menu's Sprint picker.
- The list is the issue page's `SprintPicker`: Backlog first, then the board's sprints, closed ones disabled, with Show all sprints. It names each sprint in full though the slot is abbreviated, and shows the sprint's start and end days as detail (`5 Oct - 18 Oct`, with `'25` after a day in another year), the end day alone when the sprint has no start day, and the state when it has no end day. The popover is the wide one (26rem). Amended 2026-10-18, build of #273: Shane asked for dates in the menu and a number alone on the canvas. The issue page, menu, create dialog and bulk bar pickers all use `sprintDetail`, so one sprint reads the same everywhere. The choice is optimistic through `sprintPatch` and `useSetSprint`, and a refusal reverts the slot and offers Retry.
- The empty slot of a Story, Task or Bug (Backlog) is a click target titled "Set sprint". An Epic or a Subtask has no sprint (`propertyRules`), so its slot is not a target.
- A Hold row stays editable. Moving a done issue into a sprint is allowed; Jira decides.
- On the Sprint page the slot is a `Slot` button (#279's pattern), named "Sprint of PSAPAC-13: Sprint 5" and titled with the full name and end day, that opens the same list. Moving the issue to another sprint or to Backlog takes its row off the page at once, a refusal puts it back with the Retry toast, and focus falls to the Sprint page when the row it was on is gone.

*Amended 2026-10-19, build of #306.* Shane wants Priority optional on the canvas. The orchestrator decided these:

- The Display menu's Display properties gain a Priority chip, first in the group and on by default. It is not a `display.properties` entry: the setting is the optional boolean `display.priority`, where only `false` hides the slot and a missing key or any other value reads as on. Priority is not draggable (#301), so it stays fixed anatomy and gains no column, header name or resize separator.
- Off, the Tree omits `PriorityCell` and the Sprint page omits its Priority `Slot`; the title gains the slot's 16px and its gap, and the header, right-aligned over the strip, does not move. On brings the slot back in the same place, after the pills and before the properties.
- A saved view carries it as part of its `display`: applying a view copies it into `settings.json` (a view without the key applies as on), Update view saves it, and `viewDisplayMatches` compares it, so the view stays lit and Update view wakes when it differs.
- `P`, `Shift+P` and the issue menu change priority with the slot hidden; the row's accessible name still names the priority; the Peek and the issue page keep their field.

*Amended 2026-10-18, build of #271.* Shane wants to select the start date on the canvas and edit it there. The orchestrator decided these, and Shane approved them by closing #271 on 2026-10-18:

- The Display properties gain Start date (`start`), placed after Remaining % and before Due date. It is a short date in a 96px slot, as Due date without the tone icon, and joins the row's accessible name as `start 2026-10-01` while shown. A file written without it still loads, and an older build drops the name.
- A click on the slot, filled or empty, opens the same date editor as the due date (`DateEditor.tsx`), the fourth cell editor, with Save, Clear, Esc, an optimistic write and a Retry toast on refusal. `Shift+S` opens it on the active row when the property is shown and the issue menu's field otherwise; it never falls through to `S`, which opens Status. The key is the orchestrator's pick.
- The Sprint page's start slot is a `Slot` button named "Start date of PSAPAC-4: none", as the due slot is.
- A start date after the due date is allowed, as Jira allows it and the issue page does not warn.

*Amended 2026-10-19, build of #301.* Shane wants to drag the Display columns into a new order, from Priority onward, with the title, the blocking pills and the subtask indicators staying where they are. The orchestrator decided these, with Shane's go on 2026-10-19:

- The order is `display.properties` itself, in `settings.json` and in a view's `display`, so no key is added. `keepKnownProperties` keeps the file's order and drops unknown names and repeats, where it sorted to `ROW_PROPERTIES` order. A file written before this change holds the old order and reads the same. The Tree rows, the Column header and the Sprint page's rows and names all map over `display.properties`, so all three draw it.
- Only the Display properties reorder. Priority (`PriorityCell`) and the assignee avatar are fixed anatomy with no header, so they do not drag; Priority stays the first slot after the pills.
- A name in the Column header is a button. A press that travels 4px starts a drag, and the column whose centre is nearest the pointer is the target. A 2px drop line (`data-drop-line`) sits at the edge the column would land beside. The line is state in `ColumnHeader` alone, so no row renders while the pointer moves. Release saves once (`moveColumn` in `Shell`, `movedColumn` in `propertyFit.ts`); Escape cancels. A name drag and a separator drag are separate elements with pointer capture each, and neither starts while the other runs.
- A focused name takes `Alt+Left` and `Alt+Right` to move its column one place, saved at once; a polite live region says "Labels moved to position 2 of 5", focus returns to the name once the column is drawn in its new place, and a name at an end does nothing.
- Turning a property on in the Display menu appends it to the end of the order; turning one off keeps the rest. A view that carries a display saves and restores its own order, and Update view wakes when only the order differs.
- The Sprint page gains no drag: its names are drawn only.

*Amended 2026-10-19, build of #310.* Shane wants Comments as a Display property on the canvas, a chat icon with a count badge that opens the comments in a modal. Shane approved the proposed defaults on 2026-10-19, and these are the build's rules:

- The Display properties gain Comments (`comments`), off by default and placed after Remaining % and before Start date in the default order, so the time group stays together; turning it on appends it to the end of the user's order, as #301 sets. It is a 40px slot on the Tree and the Sprint page, resizable and in the column header like the others. A file written without it still loads, and an older build drops the name.
- The count comes with the Tree's search, but only while the property is on. Core keeps only the `total` of Jira's `comment` field as the optional `Issue.commentCount` and drops the bodies at the boundary; a read that did not ask, or got a malformed field, leaves it absent. Jira has no narrower form: `fields=comment.total` returns nothing. A live read-only measure on 2026-10-19 put a full PSAPAC load at 18.2 MB without the field and 24.9 MB with it (+37%; unresolved 4.4 to 4.7 MB, Done 13.8 to 20.1 MB, whose issues carry up to 22 comments). Shane decided on 2026-10-19 that default loads must not carry it: the main process reads the saved display and passes `comments: true` to the Tree load and the Sprint page read only while `comments` is listed, and turning the property on reloads the issue lists and the Sprint pages once the write lands (`displayMutation`). Turning it off drops the field on the next load. Until a load that asked lands, the slot shows the bubble alone, named "Comments". A single-issue read (`getIssue`, the Peek and page reads, `jm issue get`) always asks.
- The slot draws a bubble with the count as a badge on its top right, the bubble alone at 0 and `99+` from 100. Its accessible name is `3 comments`, `1 comment` or `No comments`, and the row's name ends with it while the property is on and the count is above 0. An Epic shows the slot like any issue.
- A click on the slot (`data-edit="comments"`) makes the row active and opens the Comments modal without a Peek. A Shift+click checks a range instead. On the Sprint page the slot is a `Slot` button, so Enter and Space open it too. The Tree has no focusable slot, so its Enter keeps opening the issue.
- A post or delete sets the row's count from the comment list at once, and the next refresh confirms it.

### Peek

D1's always-open detail pane becomes the Peek, since Q5 gives the issue a full page (D3) and a space-bar preview. The Shell's grid has two columns, sidebar and Tree, and gains a third while the Peek is open: `IssueDetail`, a labelled `aside` named "Peek", not a dialog, because it blocks nothing. Opening it leaves focus on the Tree. It keeps D1's summary editor and adds Engagement, the parent key and the mismatch detail.

The Peek shows the issue under `peekedKey` (`Shell.tsx:763`), which follows the active row when a key moves it, with these exceptions:

- The pointer moving the active row (#299) does not move the Peek. `o` points it at the active row. Hover reaches the Shell as `hover`, not through `apply`, so only a key, `Space` opening the Peek or `o` sets `lastIssueKey`.
- On a header or chip row it keeps showing the last issue.
- While its summary field is open, it stays on that issue. Focus leaving the field saves the edit (D11), so a click on another row saves it first and the Peek then follows that row. `J` and `K` type into the field and do not move the active row.
- When its issue leaves the Tree, through a refetch or a filter, it keeps showing the issue's last data under the label "No longer in this view", until the user moves the active row or closes the Peek.

### Issue Menu

*Added 2026-10-15, build of #238.* A right-click on an issue row opens a menu of 18 actions in the style of Linear's: view full screen, Status, Assignee, Start date, Due date, Sprint, Rename, Parent, Type, Labels, Priority, Original estimate, Log work, Related issues, Copy, Open in Jira, Add comment and Delete (`menuItems.ts` is the list, in that order, in four groups). The orchestrator decided these, and Shane approved them by closing #238 on 2026-10-17:

- **Where.** Every list of issue rows: the Tree, the Sprint page, the Epics page and the Inbox. A row opens it with a right-click, the context-menu key or `Shift+F10`; on the Tree the key stands for the active row. The Peek and the issue page keep their own controls. The menu acts on the row right-clicked, even with others checked, and does not select it or open the Peek.
- **A DOM menu, not Electron's.** `IssueMenu` is a `role="menu"` manual popover in the top layer, placed at the pointer and moved to stay in the window, and taller than the window it scrolls. Its submenus are the pickers' own lists: `Picker` has a `menu` variant (the item, its key and an arrow, the list opening beside it), and `PropertyPickers.tsx` now holds the Sprint, Parent and Type pickers beside the four it had, so the page and the menu share them and every edit is the one the page makes (optimistic, rolled back with a toast and Retry, per [Optimistic Edits](#optimistic-edits)). Start date, Due date, Original estimate and Rename open a popover with the page's own `TextField`.
- **Closing.** A manual popover, because an auto one closes on the pointer-up that ends the right-click that opened it. A press outside closes it, `Esc` closes the open submenu and then the menu, and a finished action closes it. Focus goes back to the row clicked, or to the Tree.
- **Keyboard.** Arrows, `Home` and `End` move; `Right` or `Enter` opens a submenu; `Left` closes a list of options (in a search field only while it is empty; the date, estimate and Rename fields keep `Left` for the caret, and only `Esc` closes them); `Tab` closes the menu; a listed key (`S`, `A`, `L`, `P`, `E`, `Shift+S`, `Shift+D`, `Shift+P`, `Shift+E`, `Shift+C`) runs its item. `Shift+S`, `Shift+D`, `Shift+P`, `Shift+E` and `Shift+C` also work outside the menu on the active issue. The Peek holds only four pickers, so from the Tree they open the menu with that submenu already open, except that `Shift+S`, `Shift+D`, `Shift+E` and `Shift+C` act on the row's own slot (the date editors, the estimate field and the Sprint list) while the row draws it; on the issue page they focus the page's own field. `keymap.ts` no longer reads them as `P`, `E` or `C`.
- **By type.** An item a type cannot take is not listed (`propertyRules`): an Epic has no sprint, parent, type change, original estimate or worklog; a Subtask has no sprint or type change.
- **Navigation items.** View full screen opens the issue page; Add comment and Related issues open it and then focus the comment box or press "Add link", waiting for the control when the page loads it later; Log work opens the Log work modal (see the 2026-10-17 note for #277); Open in Jira opens the browser; Delete opens the existing confirmation, with its subtask rule.
- **Copy.** Opens the create dialog seeded from the source (`copyDraft`): type, "Copy of" and the summary, parent, Customer, Engagement, labels, priority, original estimate and description. The sprint, the dates and the comments, worklogs and links are not copied, and the assignee follows the create default (#237). The description's images are dropped, since they are attachments of the source and would not resolve on the copy. Core has no clone, so the copy is a create.

*Added 2026-10-17, build of #277.* Shane asked to select the work logged on a row and log work from a modal. The orchestrator's decisions, and Shane approved them by closing #277 on 2026-10-18:

- **Where.** A click on a row's Logged slot, filled or empty, on the Tree and on the Sprint page, opens a centred modal titled "Log work on PSAPAC-123". The click does not open the Peek or the issue. An Epic has no time tracking, so its slot is no target (`allows(issue, 'logWork')`, the same test as the menu). On the Tree the slot is a `role="button"` span named "Log work on PSAPAC-123" with no tab stop: the keyboard path is `W` on the active Tree row or the open issue page, the menu's Log work and the palette's Log work. On the Sprint page (#279) it is a `Slot` button with the same name and a tab stop, so Enter or Space opens the modal.
- **The form.** `WorklogFormRow` inside `Modal`, as the Peek uses it: Time spent, Started, Comment, "Reduces Time remaining by the time logged", Enter saves from the time field, Esc and Cancel close without a write, a refusal keeps the modal open with the text and the error, and Esc does nothing while the save is in flight. The slot passes its issue to the Shell, so a Done row on the Sprint page, which the Tree's list may not hold, opens its modal. `addWorklog` posts with `adjustEstimate=auto`, so Jira lowers Remaining.
- **After a save.** The modal closes once `useAddWorklog` has re-read the issue, so the row shows Jira's new Logged, Remaining and Remaining %, with no optimistic patch because Jira computes the remaining. Focus returns to the Tree (the clicked row became the active one) or to the Sprint page.
- **Left alone.** A running timer on the issue is not touched and logs separately on stop. A Hold-faded row stays loggable. Subtask time does not roll up: the modal logs against the row's own issue.
- **Key.** `W`, free in `LETTERS` and the palette.

### Hover Active Row

*Added 2026-10-19, build of #299.* Shane wants the row under the pointer to be the active row, with `o` peeking it and `O` opening its page, and no click that selects or peeks (2026-10-18). Decisions are his, by accepting the proposed defaults.

- **Last input wins.** `pointermove` over the Tree makes a row active (`hoverRow`, `IssueTree.onPointerMove`) when the position differs from the last one (`pointerMoved`). A scroll or a rebuild under a still pointer makes the browser resend the pointer events from the same spot, so those change nothing, and a key that moved the active row keeps it until the pointer really moves. `J`, `K` and the arrows move from the hovered row. Hover covers issue rows, Customer and No Epic headers and chips. Hover takes focus to the Tree when it is on the page body, and `o` and `O` from the Peek act on the active Tree row. A cell editor, picker or menu that is open (`:popover-open`) holds its row: the pointer moves nothing until it closes. The view does not scroll a hovered row into place, and the Shell flushes the update at once so a key pressed right after the move acts on the new row.
- **Leaving the list.** The last row stays active, so the letter keys keep a target.
- **Peek and page.** `o` and `O` live in `moveActive`, so a text field, a picker or a dialog keeps its letters (`keepsLetters`). `o` points the Peek at the active row (`MoveResult.peekHere`) and never closes it; `Space` toggles. The Shell's `hover` sets only the active row, so the Peek stays on its issue while the pointer moves, and `apply` moves `peekedKey` only when a key moved the row, the Peek just opened, or `o` asked.
- **Clicks.** A click on blank issue-row space does nothing (`clickRow` returns the same state, and the Tree skips `onChange`). A chevron, header and chip click toggle; the checkbox, a range click and an in-row cell keep their own action and name their row active, for a click that lands before the hover rendered. A double-click on blank space opens the page, the issue its first click hit. The hover tint of `.tree-row` is gone, so the active row is the only highlighted one; the Peek's `aria-selected` row keeps its fill.
- **Sprint page.** The section is a `data-key-scope`, a row is active under the pointer (`data-active`), and `resolveKey` reads `o` (`peek`) and `Shift+O` (`openPage`) there. `o` opens the Peek beside the page, which keeps its column while the page is open; the first Esc closes that Peek and the second closes the page. The row button opens the issue on a double-click, or on Enter or Space from the keyboard (a click with `detail` 0). The summary is a button that opens the modal. The other letters still do nothing there.
- **Replaced.** `C` no longer reads CSS `:hover` and the navigation-key tracking in the Shell: the hovered row is the active row.

### Summary Modal

*Added 2026-10-17, build of #278.* Shane asked to select an issue's summary on the canvas and edit it in a modal. The choices below are the orchestrator's, for Shane to confirm.

- **Gesture.** A single click on the summary text opens the modal at once (amended 2026-10-19, build of #299). A click has no other job on an issue row, since hover makes the row active and `o` opens the Peek, so the second-click rule, its 500 ms wait (`DOUBLE_CLICK_MS`) and the hover pencil (`[data-edit="summary"]`) are gone. A double-click on the summary therefore edits it, and a double-click on blank row space opens the page. A Shift+click never edits.
- **Keyboard.** `E` with focus in the Tree opens the modal on the active row; in the Peek and on the page it keeps the in-place field. The Sprint page's summary is a real button (a button cannot nest in a button), named "Edit summary of KEY", beside the row's button.
- **Modal.** `SummaryDialog` on `Modal`, titled "Edit summary", one field (max 255) selected on open, Save and Cancel. Enter saves, Esc, Cancel and a click outside close with no write. An empty summary stays open with "A summary cannot be empty." Focus returns to the control that opened it.
- **Write.** The context menu's path: `useSetSummary` through `useAttempt('Summary')`, so the row changes at once, an undo entry is kept and a refusal reverts with the Retry toast. `editEverywhere` also patches the Sprint page's own read, which no phase cache holds.
- **No target.** Customer headers, the No Epic row and chips; a Hold-faded row stays editable.

### Testing

Pure functions carry the logic and get unit tests. The components are thin, and the e2e suite drives them through the D1 fake Jira. Testing Library is not installed, and these tests reach the same behaviour without it.

**Unit tests:**

| File | Test |
|---|---|
| `core/src/hierarchy.test.ts` | `drops a Done Epic and attaches its open child as a root in its own Customer group` (#199; D2 first pinned `keeps a Done Epic as context for its open child`) |
| | `attaches an open issue to its nearest open ancestor, past Done ones` (#199) |
| | `shows no Done row and no chip anywhere` (#199) |
| | `drops a group whose only match is a Done child of someone else's Epic` (#199) |
| | `STATUS_ORDER runs Opportunity, To Do, In Progress, Review, Hold, Done` |
| `renderer/src/tree.test.ts` | `keeps one copy of an issue both phases hold, the later updated` |
| | `keeps the unresolved copy when both have the same updated` |
| | `lists Customer, Epic, child and Subtask rows in tree order at levels 1 to 4` |
| | `puts the No Epic header after a Customer's Epics at level 2` |
| | `hides a collapsed Customer's rows and a collapsed issue's subtree` |
| | `adds an N done chip after an open parent's children` |
| | `lists Done children under a revealed chip, one level down` |
| | `gives an empty Customer group a header that cannot expand` |
| | `numbers siblings with setSize and posInSet, chips included` |
| | `gives each row its parentId and expandable flag` |
| | `counts a subtree's issues, context included and chips excluded` |
| | `carries contextOnly and the mismatch onto the row` |
| | `J and ArrowDown move down, K and ArrowUp move up, stopping at the ends` |
| | `Shift+J and Caps Lock J move like J` |
| | `PageDown and PageUp move one window height` |
| | `ArrowRight expands a collapsed row, then moves to its first child` |
| | `ArrowLeft collapses an expanded row, then moves to its parent` |
| | `Shift+ArrowLeft sets the Customers level and activates the Customer header; Shift+ArrowRight sets Everything` |
| | `closes the rows below the level, shown or not` |
| | `shows Stories as Customer, Epic, Story and No Epic rows, with the Epic's Done chip shown and Subtasks hidden` |
| | `applies the level unless the filter bar narrows, and context issues at Story depth or below always open` |
| | `layers hand overrides on the level, and a change keeps overrides for rows out of view` |
| | `keeps an override for a row the groups no longer hold when another row changes` |
| | `drops an override when a row goes back to the level, so it follows the level again` |
| | `keeps the No Epic header open while a filter narrows, and closes it at Epics otherwise` |
| | `Shift+ArrowLeft and Shift+ArrowRight set the level with no row shown, and other keys do nothing` |
| | `Home and End move to the first and last row` |
| | `Enter toggles a header or chip and opens an issue` |
| | `Space toggles the Peek on an issue row only` |
| | `ignores keys pressed with Cmd, Ctrl or Alt` |
| | `leaves every other key unhandled` |
| | `windowRange covers the visible rows plus overscan, clamped at both ends` |
| | `windowRange includes an active row outside the window` |
| | `fallbackRow picks the next surviving sibling, then the nearest surviving ancestor, then the old index` |
| `renderer/src/optimistic.test.ts` | `patches and cancels every phase that holds the issue` |
| | `an edit to an unresolved issue leaves the Done load running` |
| | `refetches only the touched phases once the last edit settles` |
| `renderer/src/queries.test.ts` | `the Done query waits for the unresolved phase` |
| | `copies an issue that left the unresolved set into Done, then invalidates Done` |
| | `ignores progress from another load id` |
| | `a failed toggle write refetches the toggles` |
| | `logout removes the issues, me and customers queries` |
| `main/backend.test.ts` | `loads one phase and reports progress per page with its load id` |
| | `a second load of a phase aborts the first, which returns null` |
| | `an aborted load leaves the newer load's controller in place` |
| | `logout aborts every load before removing the token` |
| | `setToggles writes in call order and keeps the other settings` |
| | `customers maps field options to the hierarchy's shape` |
| `main/handlers.test.ts` | `issues:list refuses an unknown phase or a missing load id` |
| | `settings:setToggles refuses a missing, extra or non-boolean key` |
| | `issues:list passes each page's progress to sendProgress` |
| | `an aborted load logs nothing` |

**Fake Jira.** `apps/desktop/src/main/e2e-fake.ts` grows to:

- A Done-category status (`{ key: 'done' }`) and an Epic type (`hierarchyLevel: 1`) beside the existing ones.
- A hierarchy: three Customers including "Collibra (Internal team)", and a fourth Customer option with no issues; Epics; Stories, a Task and a Bug under them; a Subtask (`subtask: true`, `hierarchyLevel: -1`); a Story whose Customer differs from its Epic's; Done Stories under an open Epic; a Done Epic with one open and one Done child; a Story with no Epic; issues assigned to the test user and to another user; labels and an active sprint on some. PSAPAC-1 to PSAPAC-4 keep their summaries, types, statuses and assignees, under one Epic.
- Search by phase: it tests the JQL for `!= Done` before `= Done`, since the second is a substring of the first, and pages by `maxResults` and `nextPageToken`, so each phase spans several pages.
- `releaseDone()`, holding the first Done page as `releaseEdit` holds edits, so a test sees the Tree before Done arrives without a timing window, and `failDone()`, making the next Done page answer 500.
- `allowedValues` for the Customer field in the createmeta response, for `getFieldOptions`.
- `createFakeJira({ bulk })`, which `e2e.ts` calls with `JM_E2E_BULK`, adding `bulk` generated open Stories under one open Epic.
- `counts.searches` split into `unresolved` and `done`.

**End-to-end tests,** in `e2e/desktop/tree.test.ts`:

| Test |
|---|
| `groups issues by Customer with the internal Customer last` |
| `shows the Tree before Done issues load, then their N done chips once Hide done is off` |
| `keeps an open Story under No Epic while its Epic is Done and Hide done is on` |
| `reveals a parent's Done children from its chip` |
| `marks a Story whose Customer differs from its Epic's` |
| `opens at the Stories level on a first launch` |
| `collapses and expands groups by click, by arrow keys and with the Groups menu's levels` |
| `moves with J and K and peeks with the space bar` |
| `Esc clears the text filter, then returns focus to the Tree` |
| `turning Hide done off shows the Done Epic with its subtree` |
| `Assignee: me keeps my issues with their ancestors as context` |
| `turning Hide empty Customers off shows the Customer with no issues` |
| `remembers the toggles across a relaunch` |
| `remembers the expansion level across a relaunch` |
| `a filter keeps its matches under the default level, and clearing it restores the level` |
| `a filter opens a Story whose Subtask also matches, and a hand toggle still closes it` |
| `a toggle by hand survives a filter and the chevrons used under it` |
| `Assignee: me lets an Epic shown only as context follow the level` |
| `a filter at the Epics level still shows a match with no Epic` |
| `closing and reopening a Story under a filter leaves it following the level once the filter clears` |
| `a level picked with no row shown is kept and stored` |
| `picking a level hides the revealed chips unless it is Everything` |
| `keeps a row opened by hand when Done issues load, and new rows follow the level` |
| `filters by status and by text, keeping ancestors as context` |
| `shows No issues match with Clear filters when nothing matches` |
| `keeps the Tree and offers Retry when the Done load fails` |
| `renders a bounded number of rows for 2000 issues and reaches the last with End` |

The bounded-rows test launches with `JM_E2E_BULK=2000`, so the 2000 issues are open and show with default toggles. It expects the inner element's height to be within one row of the row count times 32, fewer than 100 `treeitem` elements in the DOM, and, after `End`, the last issue's key visible on the active row. A relaunch starts with an empty fake Keychain, since it lives in the process, so the relaunch test logs in again and then checks the toggles.

**Changes to `e2e/desktop/shell.test.ts`:**

- `logs in to the layout and logs out again`: rows are `treeitem` elements in the `tree` named "Issues", so the count of four `button` elements in the `list` becomes a check that the PSAPAC-3 row is visible; "Select an issue to see it here." becomes a check that no Peek is shown; the detail is the `complementary` region named "Peek". Its field checks stay, since PSAPAC-3 keeps its values.
- `updates a summary before Jira answers, and restores it when Jira refuses`: the three row lookups by `button` name become `treeitem` lookups, and the detail becomes the Peek.
- `refetches the issues when the window regains focus`: it waits for the `tree`, not the `list`, and counts `searches.unresolved`, since the Done query is not stale after one focus.

## Alternatives

| Option | For | Against |
|---|---|---|
| **Hand-rolled fixed-height window** (chosen) | A few dozen lines; no dependency; every row is one height already | Variable-height rows would need a rewrite; none are planned |
| `@tanstack/react-virtual` | Maintained; handles variable heights and scroll restoration | A new runtime dependency for arithmetic that fixed heights make trivial |
| Render every row, with CSS `content-visibility: auto` | Native; no windowing code | Still mounts and reconciles about 25 000 nodes on each rebuild; not the virtualised list the acceptance criteria ask for |
| **Two phase queries, progress pushed as events** (chosen) | Unresolved renders first; core's generator pages unchanged; a running count | One more event in preload |
| One query loading both phases | Least code | Nothing shows until all 29 pages load, against ADR-0002 |
| Renderer-driven paging, one IPC call per page with Jira's token | The renderer controls cancellation | Core keeps its paging state inside the generator; exposing tokens changes core's API, and refetching stored tokens assumes they never expire |
| **Hide done builds from open issues only** (chosen, #199) | One rule for the CLI and the app; no Done row or chip while Hide done is on; the Tree never shifts when Done loads | A Done Epic no longer labels its open children |
| ~~Done ancestors kept as context in core~~ (D2's choice, replaced by #199) | An open issue kept its Epic's label | A Done match pulled in an open Epic of someone else, and its Customer group with it |
| Leave core alone; the app shows such issues under No Epic | No core change | The issue vanishes from the app once Done loads, since core then drops it with its Epic |
| **`role="tree"`, flat treeitems, `aria-activedescendant`** (chosen) | Matches the interaction: rows are selected, not their cells; survives virtualisation | The row's columns are not separate cells to a screen reader |
| `role="treegrid"` | Cell-level navigation | Needs a cell focus model no D2 interaction uses |
| Nested `ul` of buttons, as D1 | Semantic HTML | Cannot virtualise without losing nesting, and a roving tabindex breaks when the focused row unmounts |
| **Done refetched when stale (5 minutes) or when an issue leaves the unresolved set** (chosen) | Focus refetch costs 8 requests, not 29; a resolved issue never blinks out | A Done issue edited elsewhere shows its old summary for up to 5 minutes |
| Done refetched on every focus | Simplest | 29 requests and about 15 seconds of loading on every switch back |
| **One expansion level in `settings.json`, hand toggles for the session** (chosen, 2026-10-13, #209) | The Tree opens at the level picked last, at Stories on a first launch; one optional key the CLI and older builds ignore | A settings shape change (Ask First), settled by Shane |
| ~~Collapse state for the session only~~ (D2's choice, replaced by #209) | No file or contract change | The Tree opened fully expanded on each launch |
| Every collapsed row id in `settings.json` or `localStorage` | Survives a restart exactly | Ids go stale as issues move, and view state against the React standard |
| **Mismatch fix in D3** (chosen) | D3 builds the Customer edit, its rollback and its picker | The badge ships a story before its fix |
| **Peek replaces the always-open pane** (chosen) | Q5 asks for a page plus a peek; the Tree gets the width | D1's e2e assertions change |

Skeleton rows, an approximate total, assignee type-ahead and an inline Done count on collapsed parents stay out of D2.

## Rollout

D2 shipped in one pull request (#71) with `Refs #29`, after this doc, built in this order:

1. Core: the context rule and `STATUS_ORDER`, with their tests and README.
2. Data: the channels, backend loads with progress and abort, the event in preload, the phase queries, the phase-aware optimistic edit, and their unit tests.
3. Tree model: `tree.ts` and its tests.
4. Components: `IssueTree`, `TreeRow`, `TreeToolbar`, the Peek in the Shell.
5. The fake Jira's hierarchy, the new e2e suite and the `shell.test.ts` changes.

The same pull request updates `apps/desktop/README.md` (layout table, IPC section, known limits), `e2e/README.md` (`releaseDone`, `failDone`, `JM_E2E_BULK`) and core's README (the context rule, `STATUS_ORDER`). No decision here is hard to reverse, so none needs an ADR. Backing out is a revert: the only state D2 writes is `settings.json`'s `toggles`, which the schema already holds and the CLI ignores.

## Open Questions

None. On 2026-10-13 Shane replaced session-only collapse with a stored expansion level (#209); a chevron click still lasts for the session only. The 2026-10-09 decision that an open issue keeps its Done ancestors as context under "Hide done" was replaced on 2026-10-12 (Core Changes, #199).
