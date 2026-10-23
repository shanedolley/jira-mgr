import { stateDir } from '@jira-mgr/core/state'

/**
 * Keeps Electron's own data (the renderer's `localStorage`, which holds the theme) in the state
 * folder, `~/Library/Application Support/jira-mgr/`. Electron would derive the folder from the
 * app's name, and renaming the app would leave the theme behind. `JM_STATE_DIR` still wins.
 */
export function pinUserData(app: { setPath: (name: 'userData', path: string) => void }): void {
  app.setPath('userData', stateDir())
}
