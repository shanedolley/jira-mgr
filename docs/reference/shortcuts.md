# Shortcuts

Source: `apps/desktop/src/renderer/src/keymap.ts` for global keys and `tree.ts` for Tree keys. Ctrl stands in for Cmd off the Mac. To add one, see [add a shortcut](../how-to/add-shortcut.md).

A letter acts only when pressed alone, not held, not typed into a field, picker, dialog or editor, and only with focus in the Tree, the Peek, the issue page or the Sprint page. `T` on a sidebar button does nothing. A letter on the Tree acts on the active row: the row under the pointer, or the row `J` or `K` last moved to, whichever came last.

## Move around the Tree

| Key | Action |
|---|---|
| `J`, `Down` | Next row |
| `K`, `Up` | Previous row |
| `PageDown`, `PageUp` | Move one page |
| `Home`, `End` | First or last row |
| `Right` | Expand; on an expanded row, next row |
| `Shift+Right` | Open everything (the Everything level, stored) |
| `Left` | Collapse; otherwise parent row |
| `Shift+Left` | Close to the Customer headers (the Customers level, stored) |
| `Enter` | Open the issue page; toggle a header |
| `Space` | Toggle the Peek |
| `o` | Open the Peek on the active issue row, also with focus in the Peek; with the Peek open, switch it to the active row. It never closes the Peek: `Space` toggles. A header or chip does nothing. The Sprint page's rows answer too, with the Peek beside the page |
| `Shift+O` | Open the issue page of the active issue row. A header or chip does nothing. The Sprint page's rows answer too |

## Select and reorder

| Key | Action |
|---|---|
| `X` | Check or uncheck the active issue; the checkbox in a row's left gutter does the same. The Sprint page's rows answer too |
| `Shift+Down`, `Shift+Up` | Move to the next or previous row and check the issue rows it crosses. On the Sprint page the rows run in page order, across the status sections |
| `Shift+click` | Check every issue row from the anchor (the issue last checked or unchecked) to the one clicked, unchecking none. It works anywhere on the row, the summary, every slot and the checkbox included, and opens nothing. A plain click on an issue row sets the anchor when there is none, so click a row, then `Shift+click` another to check both and the rows between. With no anchor at all it starts at the active row. The Sprint page's rows answer too |
| `Cmd+click` (`Ctrl+click` off macOS) | Check or uncheck the issue clicked and make it the anchor, leaving every other checked issue as it was. It works anywhere on the row, the summary, status dot, avatar, priority and every slot included, and opens no Peek, editor, modal or page. On macOS `Ctrl+click` stays the right-click that opens the issue menu. The Sprint page's rows answer too |
| `Cmd+A` | Check every issue row shown, skipping headers, chips and context rows; the "Select all rows" checkbox left of "Hide done" does the same, and clears them when all are checked. The Sprint page checks every row of the page and has no master checkbox |
| `Alt+Shift+Up`, `Alt+Shift+Down` | Move the active issue up or down one place among its siblings, which makes the order Manual; a screen reader hears the new position, and `Cmd+Z` puts the move back |
| `Alt+Left`, `Alt+Right` | With a Column header name focused, move its column one place left or right in the strip; a screen reader hears the new place, and a name at an end does nothing |
| `Esc` | Clear the checked issues; with none checked, close the Peek. On the Sprint page it clears the page's checked issues first, and returns to the Tree when none are checked |

## Edit an issue

| Key | Action |
|---|---|
| `S` | Open Status. From the Tree it opens the list beside the active row's status dot, and `Esc` or a choice returns focus to the Tree; with a page open it opens the page's Status |
| `A` | Open Assignee. From the Tree it opens the list beside the active row's avatar, and `Esc` or a choice returns focus to the Tree; with a page open it opens the page's Assignee |
| `L` | Open Labels. From the Tree it opens the list beside the active row's Labels slot when the row draws it, else the Peek's; `Esc` returns focus to the Tree; with a page open it opens the page's Labels |
| `P` | Open Priority. From the Tree it opens the list beside the active row's priority slot, and `Esc` or a choice returns focus to the Tree; with a page open it opens the page's Priority |
| `E` | Edit the summary: in a modal from the Tree, in place in the Peek and on the issue page |
| `Shift+S` | Open Start date. On the issue page it focuses the page's Start date field; from the Tree it opens the date editor on the active row's Start date slot when the row shows it, else the issue menu with the Start date field focused |
| `Shift+D` | Open Due date. On the issue page it focuses the page's Due date field; from the Tree it opens the date editor on the active row's Due date slot when the row shows it, else the issue menu with the Due date field focused |
| `Shift+P` | Open Parent. On the issue page it focuses the page's Parent field; from the Tree it opens the issue menu with the Parent field focused |
| `Shift+E` | Open Original estimate. On the issue page it focuses the page's field; from the Tree it opens the issue menu with the field focused, except that when the row shows the estimate slot it focuses the estimate field in the active row |
| `Shift+C` | Open Sprint. On the issue page it opens the page's Sprint list; from the Tree it opens the Sprint list beside the row's Sprint slot (#273), and falls back to the issue menu's when the slot is hidden. These five never fall through to `S`, `C`, `P` or `E`, and do nothing where the issue's type has no such field (an Epic has no sprint, parent or estimate) |
| `I` | Assign the issue to me |
| `Y` | Copy the issue key |
| `U` | Copy the link to the issue on the Jira site |

## Create and track time

| Key | Action |
|---|---|
| `C` | Create an issue under the active (hovered) issue: a Story under an Epic, a Subtask under a Story, Task or Bug or beside a Subtask |
| `T` | Start or stop the timer on the active issue |
| `W` | Open the Log work modal for the active issue. An Epic has no worklog, so `W` does nothing there. A click on a row's Logged slot, the menu's Log work and the palette's Log work open the same modal |

## Click on a row

| Key | Action |
|---|---|
| Pointer over a row | Make it the active row: an issue row, a Customer header, a No Epic header or a chip. No click is needed. The last input wins: after `J` or `K` the keyboard row stays active until the pointer moves again, and a scroll under a still pointer changes nothing. When the pointer leaves the list the last row stays active. The Peek stays on its issue while the pointer moves |
| Click on an issue's key | Open the Peek on that issue and make it the active row, as `o` does. The key shows a pointer cursor. `Shift+click` and `Cmd+click` check instead. The Sprint page's rows have the same key button |
| Click on blank row space | Nothing: no Peek, no selection. A header or chip still expands or collapses |
| Double-click | On an issue row's blank space or its key, open its page as `Enter` does, the issue the first click hit. The checkbox, the summary, the chevron, every slot with an editor or action of its own (status dot, priority, avatar, Labels, Sprint, Due date, Start date, Original estimate and Logged), a Shift+double-click and a Cmd+double-click ignore it, and a header or chip does only what its two clicks do |
| Click on a status dot | Open the Status list beside the dot, without opening the Peek. The Sprint page's rows have the same button. `Shift+click` and `Cmd+click` check instead |
| Click on an avatar | Open the Assignee list beside the avatar, without opening the Peek, also on an unassigned row. The Sprint page's rows have the same button. `Shift+click` and `Cmd+click` check instead |
| Click on a priority slot | Open the Priority list beside the slot, without opening the Peek, whether the slot draws bars or is empty. The Sprint page's rows have the same button. On the Tree `Shift+click` and `Cmd+click` check instead |
| Click on a Labels, Sprint, Due date or Start date slot | Open the slot's editor beside it, without opening the Peek, whether the slot is filled or empty. The Sprint page's rows have the same button. `Shift+click` and `Cmd+click` check instead |
| Click on the Original estimate slot | Turn it into a field in place, without opening the Peek. `Enter` saves and `Esc` cancels. The Sprint page's rows have the same button |
| Click on the Logged slot | Open the Log work modal, without opening the Peek. The Sprint page's rows have the same button |
| Click on the Comments slot | Open the Comments modal, without opening the Peek, whatever the count. The Sprint page's rows have the same button, which `Enter` and `Space` press. `Shift+click` and `Cmd+click` check instead |
| Click on a summary | Edit the summary in a modal, with the text selected. `E` opens the same modal on the active row. The Sprint page's rows have the same button. `Shift+click` and `Cmd+click` check instead |

## Find, filter and views

| Where | Key | Action |
|---|---|---|
| | `F` | Open the Filter menu, with focus on its first field; `Esc` closes it and returns to the Tree |
| | `/` | Focus the text filter; works from a sidebar or toolbar button too, not under an open issue, Inbox, Sprint, Epics or Customers page |
| | `Cmd+K` | Open the palette; once a query is typed it lists the matching commands (Theme: System, Theme: Light, Theme: Dark, Log out) first; with an issue in context it then lists that issue's actions, each beside its key, then saved views, then it searches loaded issues and, below them, Jira text. Not over a dialog or open picker |
| Text filter | `Enter`, `Down` | Move to the first issue row, skipping group headers, with the query kept |
| Text filter | `Esc` | Clear the query; when empty, return to the Tree |
| Filter menu, a field | `Down`, `Up` | Move between fields |
| Filter menu, a field | `Right`, `Enter` | Open its values in the submenu, with focus in its search box |
| Filter submenu, search box and values | `Down`, `Up` | Move between the search box and the values |
| Filter submenu | `Left`, `Esc` | Close the submenu and return to its field; `Left` moves the caret and `Esc` clears the text while the search box holds text |
| Palette | `Up`, `Down` | Move the highlight; it starts on the first loaded issue, and `Up` reaches the commands, actions and views above it; Jira text matches never take it |
| Palette | `Enter`, `Esc` | Open the highlighted row (an issue's page, or run an action, view or command), or close; the first loaded issue is highlighted by default, and with no issue, the first action or view. A command is never highlighted by default, so `Enter` runs one only after an arrow key picks it |
| Saved views list | `Up`, `Down` | Move between views |
| Saved views list | `F2` | Rename the focused view |
| Saved views list | `Alt+Up`, `Alt+Down` | Move the focused view up or down one place |
| View name field | `Enter`, `Esc` | Save or cancel the rename |

## Menus and pickers

| Where | Key | Action |
|---|---|---|
| | `Shift+F10` | Open the issue menu of the active Tree row, or of the focused row on the Inbox, Sprint and Epics pages. The context-menu key and a right-click on a row do the same. Its Comments item opens the Comments modal for the row, the keyboard's way to it from the Tree |
| Issue menu | `Up`, `Down`, `Home`, `End` | Move between items; `Up` from the first item goes to the last |
| Issue menu | `Right`, `Enter` | Open the item's submenu, or run an item that has none |
| Issue menu | `Left` | Close an open list of options and return to its item; in a search field only while it is empty. The date, estimate and Rename fields keep `Left` for the caret, and only `Esc` closes them |
| Issue menu | `S`, `A`, `L`, `P`, `E`, `Shift+S`, `Shift+D`, `Shift+P`, `Shift+E`, `Shift+C` | Run the item that shows the key |
| Issue menu | `Esc` | Close the open submenu, then the menu, and return focus to the row. `Tab` closes the menu too |
| User menu | `Up`, `Down`, `Home`, `End` | Move between Theme, Keyboard shortcuts and Log out, or between System, Light and Dark in the Theme submenu; `Up` from the first goes to the last |
| User menu | `Right`, `Enter`, `Left` | Open the Theme submenu, or run the focused item; `Left` closes the submenu and returns to Theme |
| User menu | `Esc`, `Tab` | Close the submenu, then the menu, and return focus to the sidebar avatar. `Tab` closes the menu too |
| Pickers | `Up`, `Down` | Move the highlight |
| Pickers without a search field | `Home`, `End` | First or last option; in a searchable picker they move the caret |
| Pickers | `Enter` | Choose the highlighted option |
| Status and Priority pickers | `1` to `9` | Choose the numbered option; the keycap on each option shows its number |

## Dialogs and fields

| Where | Key | Action |
|---|---|---|
| Rich-text editor, comment box | `Cmd+Enter` | Save or post; `Esc` cancels the editor |
| Create dialog, summary or description | `Cmd+Enter` | Create the issue, or focus the first missing field |
| Create dialog, description | `Esc` | Close the dialog, as it does from the summary |
| Sub-issue form (the page's Subtasks "+"), anywhere in the form | `Cmd+Enter` | Create one Subtask per line of the titles box |
| Sub-issue form, anywhere in the form | `Esc` | Close the form and stay on the page; ignored while the Subtasks are being created |
| Log work modal | `Enter` | Save the worklog from the Time spent field |
| Log work modal | `Esc` | Close the modal with no write and return focus |
| Summary and property fields | `Enter` | Save |
| Summary and property fields | `Esc` | Cancel the edit |

## App and pages

| Where | Key | Action |
|---|---|---|
| | `?` | List every shortcut on this page; works from a sidebar or toolbar button too, not in a field or over a dialog |
| | `Cmd+Z` | Undo; a text field keeps its own undo. A batch from the bulk bar goes back as one, skipping issues that changed since |
| | `Esc` | Close the issue page, then the Peek opened beside a Sprint page, then the Sprint page or the Epics or Customers page, then clear the checked issues, then close the Peek. With focus on the Sprint page, its own checked issues clear before the Peek or the page closes. An issue page opened from a sprint, the Epics table or the Customers page returns to it |
| | `Tab` | The first stop is a "Skip to issues" link, hidden until it has focus; `Enter` on it moves focus to the Tree |
| Inbox list | `Up`, `Down` | Move between entries |
| Inbox list | `Enter` | Open the entry's page and mark it read; `Esc` on the page returns to the list |

Ctrl stands in for Cmd off the Mac.
