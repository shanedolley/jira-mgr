# React

These rules cover the renderer in `apps/desktop`.

## Components

- Write function components with hooks, one exported component per file, named for the file.
- Load and change data through `@jira-mgr/core`, reached over IPC from the main process and wrapped in TanStack Query hooks. Components never call Jira directly.
- Keep domain rules out of components. Core decides what Jira allows, and the UI handles its refusal.
- Reach Electron only through the preload script's typed API, never through Node or Electron imports in the renderer.

## State

- Server data lives in the TanStack Query cache, not in component state or a global store. Refetch on window focus, and write optimistic updates through query mutations.
- Derive values during render rather than syncing them with effects.
- Keep view state that must survive a restart (toggles, saved views) in the local JSON files core reads, not in component state.

## Accessibility

- Every interactive element works by keyboard and has an accessible name.
- Every single-key shortcut has a visible alternative and does not fire while a text field has focus.
- Use semantic elements (`button`, `a`, `dialog`) before ARIA roles.
- Text meets WCAG 2.2 AA contrast in light and dark themes.
- Respect `prefers-reduced-motion`.

## Testing

Test components with Testing Library, querying by role and label as a user would. Test flows end to end with Playwright's Electron driver (see [Testing](testing.md)).
