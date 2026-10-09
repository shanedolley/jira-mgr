import { join } from 'node:path'

import { APP_NAME } from '@jira-mgr/core'
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

import { CHANNELS, WINDOW_FOCUS_EVENT } from '../shared/ipc'
import type { Backend } from './backend'
import { createHandlers } from './handlers'

/** Only our own windows may call the backend. */
function fromOurWindow(event: IpcMainInvokeEvent): boolean {
  return BrowserWindow.fromWebContents(event.sender) !== null
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 520,
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // The renderer shows one page. Links and new windows never leave it.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  // Chromium raises visibilitychange only when a window hides, so TanStack Query would not
  // refetch on a switch back from another app. The renderer takes its focus signal from here.
  const sendFocus = (focused: boolean) => {
    if (!window.isDestroyed()) window.webContents.send(WINDOW_FOCUS_EVENT, focused)
  }
  window.on('focus', () => {
    sendFocus(true)
  })
  window.on('blur', () => {
    sendFocus(false)
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Registers the IPC handlers for `backend` and opens the window once Electron is ready. */
export function start(backend: Backend): void {
  const handlers = createHandlers(backend)
  for (const channel of CHANNELS) {
    ipcMain.handle(channel, (event, raw: unknown) =>
      fromOurWindow(event)
        ? handlers[channel](raw)
        : { ok: false, error: { code: 'permission_denied', message: 'Request refused.' } },
    )
  }

  void app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
