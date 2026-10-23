import { app } from 'electron'

import { start } from './app'
import { createBackend } from './backend'
import { setDevDockIcon } from './dockIcon'
import { chooseSavePath } from './save'
import { pinUserData } from './userData'

// The bundle name no longer names Electron's data folder, so pin it before anything reads it.
pinUserData(app)

// `pnpm dev` shows Electron's Dock icon, so set ours. The packaged app has no PNG beside it and
// keeps the icon from its bundle.
void app.whenReady().then(() => {
  setDevDockIcon(__dirname, app.dock)
})

start(createBackend({ chooseSavePath }))
