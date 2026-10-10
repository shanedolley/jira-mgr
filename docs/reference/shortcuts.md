# Shortcuts

Source: `apps/desktop/src/renderer/src/keymap.ts` for global keys and `tree.ts` for Tree keys. Ctrl stands in for Cmd off the Mac. To add one, see [add a shortcut](../how-to/add-shortcut.md).

## Global

A letter acts only when pressed alone, not held, and not typed into a field, picker, dialog or editor.

| Key | Action |
|---|---|
| `C` | Create an issue |
| `T` | Start or stop the timer on the active issue |
| `S` | Open Status |
| `A` | Open Assignee |
| `L` | Open Labels |
| `P` | Open Priority |
| `E` | Edit the summary |
| `Cmd+K` | Open the search palette; it searches issues and lists no commands. Not over a dialog or open picker |
| `Cmd+Z` | Undo; a text field keeps its own undo |
| `Esc` | Close the page, then the Peek |

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
