import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'

/**
 * Asks the user, in a native save dialog, where to put a downloaded attachment. The dialog opens
 * in the Downloads folder with `defaultName` filled in. `null` means the user cancelled. This is
 * the only way a path reaches the backend's file write: the renderer never names one.
 */
export async function chooseSavePath(defaultName: string): Promise<string | null> {
  const options = { defaultPath: join(app.getPath('downloads'), defaultName) }
  const window = BrowserWindow.getFocusedWindow()
  const { canceled, filePath } = await (window === null
    ? dialog.showSaveDialog(options)
    : dialog.showSaveDialog(window, options))
  return canceled || filePath === '' ? null : filePath
}
