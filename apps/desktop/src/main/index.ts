import { app } from 'electron'

import { start } from './app'
import { createBackend } from './backend'
import { devIconPath } from './dockIcon'
import { chooseSavePath } from './save'

// A packaged app carries its icon in the bundle. Under `pnpm dev` the Dock shows Electron's, so
// set ours. `app.dock` exists on macOS only.
if (!app.isPackaged) {
  void app.whenReady().then(() => {
    app.dock?.setIcon(devIconPath(__dirname))
  })
}

start(createBackend({ chooseSavePath }))
