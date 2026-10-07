# Core

`@jira-mgr/core`, the package every client imports: the CLI and the desktop app. It will own the Jira client, domain rules, the saved view schema and typed errors with stable codes. Today it exports `APP_NAME` and `appTitle`, so the pipeline has something real to build and test.

Its exported API is public to the other packages, so change it additively.

## Use

Other packages import it by name:

```ts
import { appTitle } from '@jira-mgr/core'
```

The `exports` map points at `src/index.ts`. The package has no build step: tsup and electron-vite bundle the source into each client.

## Test

```
pnpm --filter @jira-mgr/core test
```

Vitest runs `<file>.test.ts` beside the source. `pnpm test:live` sets `JM_LIVE_JIRA=1`, the opt-in for tests that read the live PSAPAC Jira. Tests never write to Jira. Integration tests run against an MSW fake fed by the recorded PSAPAC responses in `fixtures/`, served through `test/msw.ts`.
