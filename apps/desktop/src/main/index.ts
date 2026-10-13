import { app } from 'electron'

import { start } from './app'
import { createBackend } from './backend'
import { setDevDockIcon } from './dockIcon'
import { chooseSavePath } from './save'

// `pnpm dev` shows Electron's Dock icon, so set ours. The packaged app has no PNG beside it and
// keeps the icon from its bundle.
void app.whenReady().then(() => {
  setDevDockIcon(__dirname, app.dock)
})

start(createBackend({ chooseSavePath }))
