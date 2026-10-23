import { stateDir } from '@jira-mgr/core/state'

/** The dev server's URL under `pnpm dev`, and undefined in a built or packaged app. */
export function devRendererUrl(): string | undefined {
  const url = process.env.ELECTRON_RENDERER_URL
  return url !== undefined && url !== '' ? url : undefined
}

/**
 * Keeps Electron's own data (the renderer's `localStorage`, which holds the theme) in the state
 * folder, `~/Library/Application Support/jira-mgr/`. Electron would derive the folder from the
 * app's name, and renaming the app would leave the theme behind. `JM_STATE_DIR` still wins.
 * `pnpm dev` keeps its own profile, so it can run beside the installed app. `app.isPackaged`
 * cannot tell them apart: the bundle keeps Electron's executable name, so it reads false there too.
 */
export function pinUserData(app: { setPath: (name: 'userData', path: string) => void }): void {
  if (devRendererUrl() !== undefined) return
  app.setPath('userData', stateDir())
}
