# Shortcuts

Source: `apps/desktop/src/renderer/src/keymap.ts` for global keys and `tree.ts` for Tree keys. Ctrl stands in for Cmd off the Mac. To add one, see [add a shortcut](../how-to/add-shortcut.md).

## Global

A letter acts only when pressed alone, not held, not typed into a field, picker, dialog or editor, and only with focus in the Tree, the Peek or the issue page. `T` on a sidebar button does nothing.

| Key | Action |
|---|---|
| `C` | Create an issue |
| `T` | Start or stop the timer on the active issue |
| `S` | Open Status |
| `A` | Open Assignee |
| `L` | Open Labels |
| `P` | Open Priority |
| `E` | Edit the summary |
| `I` | Assign the issue to me |
| `Y` | Copy the issue key |
| `U` | Copy the link to the issue on the Jira site |
| `F` | Open the Filter menu, with focus on its first field; `Esc` closes it and returns to the Tree |
| `/` | Focus the text filter; works from a sidebar or toolbar button too, not under an open issue, Inbox, Sprint, Epics or Customers page |
| `?` | List every shortcut on this page; works from a sidebar or toolbar button too, not in a field or over a dialog |
| `Cmd+K` | Open the palette; with an issue in context it lists that issue's actions first, each beside its key, then saved views, then it searches loaded issues and, below them, Jira text. Not over a dialog or open picker |
| `Cmd+Z` | Undo; a text field keeps its own undo |
| `Esc` | Close the issue page, then the Sprint page or the Epics or Customers page, then the Peek. An issue page opened from a sprint, the Epics table or the Customers page returns to it |
| `Tab` | The first stop is a "Skip to issues" link, hidden until it has focus; `Enter` on it moves focus to the Tree |

## Tree

| Key | Action |
|---|---|
| `J`, `Down` | Next row |
| `K`, `Up` | Previous row |
| `PageDown`, `PageUp` | Move one page |
| `Home`, `End` | First or last row |
| `Right` | Expand; on an expanded row, next row |
| `Shift+Right` | Expand all |
| `Left` | Collapse; otherwise parent row |
| `Shift+Left` | Collapse all to the customer |
| `Enter` | Open the issue page; toggle a header |
| `Space` | Toggle the Peek |
| `Esc` | Close the Peek |

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
| Pickers | `Up`, `Down` | Move the highlight |
| Pickers without a search field | `Home`, `End` | First or last option; in a searchable picker they move the caret |
| Pickers | `Enter` | Choose the highlighted option |
| Status and Priority pickers | `1` to `9` | Choose the numbered option; the keycap on each option shows its number |
| Palette | `Up`, `Down` | Move the highlight; it starts on the first loaded issue, and `Up` reaches the actions and views above it; Jira text matches never take it |
| Palette | `Enter`, `Esc` | Open the highlighted row (an issue's page, or run an action or view), or close; the first loaded issue is highlighted by default |

Ctrl stands in for Cmd off the Mac.
