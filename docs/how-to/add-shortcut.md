# Add a Shortcut

A global shortcut is one letter in the keymap, handled in one `switch` in the Shell. The keymap decides whether a keystroke is a command, so every guard (text fields, dialogs, modifiers) sits in one place. The Cmd+K palette lists the issue actions and shows each one's key, read from the keymap, so a key that a palette action shares needs no palette edit.

## Open a Property

For a key that opens one more property picker of the active issue:

1. **Name the key.** Add an entry to `PROPERTY_KEYS` in `apps/desktop/src/renderer/src/keymap.ts`. Its name joins the `Command` type.

2. **Map the letter.** Add `['x', 'yourCommand']` to the `LETTERS` map in the same file. Pick a letter no other shortcut uses. The Tree owns `J`, `K`, the arrows, `Space` and `Enter` (`tree.ts`), and the keymap owns `C`, `T`, `W`, `S`, `A`, `L`, `P`, `E`, `I`, `Y`, `U`, `F`, `/`, `?`, `Shift+D`, `Shift+P`, `Shift+E`, `Shift+C`, `Shift+F10`, `Cmd+K`, `Cmd+Z` and `Esc`. A Shift letter goes in `SHIFT_LETTERS` instead, and its `PROPERTY_KEYS` entry reads `Shift+X`.

3. **Advertise it on the control.** Give the picker the same letter: `shortcut="X"` on a `Picker` (see `PropertyPickers.tsx`), or `aria-keyshortcuts="X"` on a button. `Shell.tsx` finds the control by that attribute and clicks it, so the shortcut opens the picker the mouse opens and no code is duplicated. The `Picker` also shows the letter as a keycap on hover and focus.

The `default` branch of the `switch` in `Shell.tsx` runs the command, so it needs no change. From the Tree it opens the active issue's Peek first; from the issue page it uses the page's sidebar. The Peek holds only Status, Assignee, Priority and Labels, so a field the Peek lacks (the `Shift` keys) opens the issue menu on that item from the Tree instead, through an item in `menuItems.ts` named as the command.

## Run Another Action

For a key that does something else, such as `C` for create:

1. Add its name to the `Command` union and its letter to `LETTERS` in `keymap.ts`.
2. Add a `case` for it in the `onKey` switch in `Shell.tsx`. Call `event.preventDefault()` when the command acts, and return early when it cannot run, as `create` does with `canCreate`.
3. Put `aria-keyshortcuts` on the button that does the same job with the mouse.

## Show It in the Palette

A key that acts on one issue can also be a palette action. Add a row to `ISSUE_ACTIONS` in `paletteActions.ts`, with the `allowed` test for the issue types that can take it, and a `case` for it in `runAction` in `Shell.tsx` that calls the code the key calls. Name the action's `id` as the key's command (`assignMe`, `copyKey`) and the palette shows the key beside it with no more code; an `id` with no key shows none.

## What the Keymap Guarantees

`resolveKey` returns a command for a letter only when it is pressed alone: no Cmd, Ctrl or Alt, not held, not part of an IME composition, not already handled, not typed into an input, dialog, picker or editor, and only with focus inside an element marked `data-key-scope` (the Tree, the Peek and the issue page). Keep that rule. Do not add a listener of your own.

## List It

Add a row to the matching table in `docs/reference/shortcuts.md`. The `?` overlay draws that page, so the row shows in the overlay with no code change.

## Test

- Add the letter to the table in `keymap.test.ts` (`map C, T, W, S, A, L, P, E, I, Y, U and F, and with Shift S, T, W, A, L, I, Y, U and F alike`) and to the Cmd and Ctrl loop beside it.
- Add an end-to-end case in `e2e/desktop/keyboard.test.ts`, which presses real keys against the fake Jira ([run the tests](run-tests.md)).
