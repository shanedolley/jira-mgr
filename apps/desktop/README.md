# Desktop App

The Electron app, package `@jira-mgr/desktop`, built with electron-vite. The renderer lives here too: React, Tailwind and TanStack Query. Today it opens one window with a placeholder.

## Run

```
pnpm dev     # app with hot reload
pnpm build   # writes apps/desktop/out
```

## Layout

```
src/main/       main process: window creation, app lifecycle
src/preload/    preload script: the only bridge to the renderer
src/renderer/   React renderer
```

## Rules

- Context isolation and the sandbox stay on, and Node integration stays off. The renderer reaches the main process only through `contextBridge` in the preload script.
- The main process and the renderer call `@jira-mgr/core` and nothing else. Business rules live there.
- electron-vite bundles `@jira-mgr/core`, because it sits in `devDependencies`. Dependencies stay external in the main process.
- The package emits CommonJS, not ES modules, so the preload script can run in the sandbox.
- No code signing and no auto-update: the app builds and runs locally.
