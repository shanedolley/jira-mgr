# Shortcuts

Source: `apps/desktop/src/renderer/src/keymap.ts` for global keys and `tree.ts` for Tree keys. Ctrl stands in for Cmd off the Mac. To add one, see [add a shortcut](../how-to/add-shortcut.md).

## Global

A letter acts only when pressed alone, not held, not typed into a field, picker, dialog or editor, and only with focus in the Tree, the Peek or the issue page. `T` on a sidebar button does nothing.

| Key | Action |
|---|---|
| `C` | Create an issue under the issue the pointer rests on, else the active one: a Story under an Epic, a Subtask under a Story, Task or Bug or beside a Subtask |
| `T` | Start or stop the timer on the active issue |
| `S` | Open Status |
| `A` | Open Assignee |
| `L` | Open Labels |
| `P` | Open Priority |
| `E` | Edit the summary |
| `Shift+D` | Open Due date. On the issue page it focuses the page's Due date field; from the Tree it opens the issue menu with the Due date field focused |
| `Shift+P` | Open Parent, the same way |
| `Shift+E` | Open Original estimate, the same way. From the Tree it focuses the estimate field in the active row when the row shows that slot |
| `Shift+C` | Open Sprint, the same way. These four never fall through to `C`, `P` or `E`, and do nothing where the issue's type has no such field (an Epic has no sprint, parent or estimate) |
| `I` | Assign the issue to me |
| `Y` | Copy the issue key |
| `U` | Copy the link to the issue on the Jira site |
| `F` | Open the Filter menu, with focus on its first field; `Esc` closes it and returns to the Tree |
| `/` | Focus the text filter; works from a sidebar or toolbar button too, not under an open issue, Inbox, Sprint, Epics or Customers page |
| `?` | List every shortcut on this page; works from a sidebar or toolbar button too, not in a field or over a dialog |
| `Shift+F10` | Open the issue menu of the active Tree row, or of the focused row on the Inbox, Sprint and Epics pages. The context-menu key and a right-click on a row do the same |
| `Cmd+K` | Open the palette; with an issue in context it lists that issue's actions first, each beside its key, then saved views, then it searches loaded issues and, below them, Jira text. Not over a dialog or open picker |
| `Cmd+Z` | Undo; a text field keeps its own undo. A batch from the bulk bar goes back as one, skipping issues that changed since |
| `Esc` | Close the issue page, then the Sprint page or the Epics or Customers page, then clear the checked issues, then close the Peek. An issue page opened from a sprint, the Epics table or the Customers page returns to it |
| `Tab` | The first stop is a "Skip to issues" link, hidden until it has focus; `Enter` on it moves focus to the Tree |

## Tree

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
| Double-click | On an issue row, open its page as `Enter` does, the issue the first click hit. The checkbox, the status dot, the avatar, the chevron and a Shift+double-click ignore it, and a header or chip does only what its two clicks do |
| `Space` | Toggle the Peek |
| `X` | Check or uncheck the active issue; the checkbox in a row's left gutter does the same |
| `Shift+Down`, `Shift+Up` | Move to the next or previous row and check the issue rows it crosses |
| `Shift+click` | Check every issue row from the anchor (the issue last checked or unchecked) to the one clicked |
| `Cmd+A` | Check every issue row shown, skipping headers, chips and context rows |
| `Alt+Shift+Up`, `Alt+Shift+Down` | Move the active issue up or down one place among its siblings, which makes the order Manual; a screen reader hears the new position, and `Cmd+Z` puts the move back |
| `Esc` | Clear the checked issues; with none checked, close the Peek |

## Fields and Dialogs

| Where | Key | Action |
|---|---|---|
| Rich-text editor, comment box | `Cmd+Enter` | Save or post; `Esc` cancels the editor |
| Create dialog, summary or description | `Cmd+Enter` | Create the issue, or focus the first missing field |
| Create dialog, description | `Esc` | Close the dialog, as it does from the summary |
| Sub-issue form (the page's Subtasks "+"), anywhere in the form | `Cmd+Enter` | Create one Subtask per line of the titles box |
| Sub-issue form, anywhere in the form | `Esc` | Close the form and stay on the page; ignored while the Subtasks are being created |
| Text filter | `Enter`, `Down` | Move to the first issue row, skipping group headers, with the query kept |
| Text filter | `Esc` | Clear the query; when empty, return to the Tree |
| Summary and property fields | `Enter` | Save |
| Summary and property fields | `Esc` | Cancel the edit |
| Saved views list | `Up`, `Down` | Move between views |
| Saved views list | `F2` | Rename the focused view |
| Saved views list | `Alt+Up`, `Alt+Down` | Move the focused view up or down one place |
| View name field | `Enter`, `Esc` | Save or cancel the rename |
| Inbox list | `Up`, `Down` | Move between entries |
| Inbox list | `Enter` | Open the entry's page and mark it read; `Esc` on the page returns to the list |
| Issue menu | `Up`, `Down`, `Home`, `End` | Move between items; `Up` from the first item goes to the last |
| Issue menu | `Right`, `Enter` | Open the item's submenu, or run an item that has none |
| Issue menu | `Left` | Close an open list of options and return to its item; in a search field only while it is empty. The date, estimate and Rename fields keep `Left` for the caret, and only `Esc` closes them |
| Issue menu | `S`, `A`, `L`, `P`, `E`, `Shift+D`, `Shift+P`, `Shift+E`, `Shift+C` | Run the item that shows the key |
| Issue menu | `Esc` | Close the open submenu, then the menu, and return focus to the row. `Tab` closes the menu too |
| Pickers | `Up`, `Down` | Move the highlight |
| Pickers without a search field | `Home`, `End` | First or last option; in a searchable picker they move the caret |
| Pickers | `Enter` | Choose the highlighted option |
| Status and Priority pickers | `1` to `9` | Choose the numbered option; the keycap on each option shows its number |
| Palette | `Up`, `Down` | Move the highlight; it starts on the first loaded issue, and `Up` reaches the actions and views above it; Jira text matches never take it |
| Palette | `Enter`, `Esc` | Open the highlighted row (an issue's page, or run an action or view), or close; the first loaded issue is highlighted by default |

Ctrl stands in for Cmd off the Mac.
