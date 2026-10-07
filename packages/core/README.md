# Core

`@jira-mgr/core`, the package every client imports: the CLI and the desktop app. It will own the Jira client, domain rules, the saved view schema and typed errors with stable codes. It exports `JiraMgrError`, plus `APP_NAME` and `appTitle`. The Node-only state file readers and writers live at `@jira-mgr/core/state`, so the renderer bundle never pulls in `node:fs`.

Its exported API is public to the other packages, so change it additively.

## Use

Other packages import it by name:

```ts
import { appTitle } from '@jira-mgr/core'
```

The `exports` map points at `src/index.ts`. The package has no build step: tsup and electron-vite bundle the source into each client.

## State Files

`readSettings`, `readViews`, `readTimer` and `readFields` (with matching `write` functions) own the non-secret state in `~/Library/Application Support/jira-mgr/`. Set `JM_STATE_DIR` to use another folder, as the tests do.

- A missing file yields defaults: starter views for `views.json`, `null` for `timer.json` and `fields.json`.
- A file that is not valid JSON or fails its schema throws `JiraMgrError` with code `validation_failed`, and the message names the file. Writes validate first, then write a temp file and rename it.

## Test

```
pnpm --filter @jira-mgr/core test
```

Vitest runs `<file>.test.ts` beside the source. `pnpm test:live` sets `JM_LIVE_JIRA=1`, the opt-in for tests that read the live PSAPAC Jira. Tests never write to Jira. Integration tests run against an MSW fake fed by the recorded PSAPAC responses in `fixtures/`, served through `test/msw.ts`.
