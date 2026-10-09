import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { APP_NAME } from '@jira-mgr/core'
import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron'

import { CHANNELS, ISSUES_PROGRESS_EVENT, WINDOW_FOCUS_EVENT } from '../shared/ipc'
import type { Backend } from './backend'
import { createHandlers } from './handlers'
import { isTrustedFrame } from './trust'

/** The one page a window loads: the dev server in development, the built file otherwise. */
function rendererUrl(): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev !== undefined && dev !== ''
    ? dev
    : pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

/** Only the main frame of one of our own windows, showing our own page, may call the backend. */
function fromOurWindow(event: IpcMainInvokeEvent): boolean {
  const window = BrowserWindow.fromWebContents(event.sender)
  return (
    window !== null &&
    isTrustedFrame(event.senderFrame, window.webContents.mainFrame, rendererUrl())
  )
}

function createWindow(inactive: boolean): void {
  const window = new BrowserWindow({
    // A test run shows its window without taking focus, so it never steals the user's keystrokes.
    show: !inactive,
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

  if (inactive) {
    window.once('ready-to-show', () => {
      window.showInactive()
    })
  }

  void window.loadURL(rendererUrl())
}

export interface StartOptions {
  /** Open windows without focus. Only the e2e entry sets it. */
  inactive?: boolean
}

/** Registers the IPC handlers for `backend` and opens the window once Electron is ready. */
export function start(backend: Backend, options: StartOptions = {}): void {
  const inactive = options.inactive ?? false
  const handlers = createHandlers(backend)
  for (const channel of CHANNELS) {
    ipcMain.handle(channel, (event, raw: unknown) =>
      fromOurWindow(event)
        ? handlers[channel](raw, {
            // Progress goes to the window that asked, and not at all once it is gone.
            sendProgress(progress) {
              if (!event.sender.isDestroyed()) event.sender.send(ISSUES_PROGRESS_EVENT, progress)
            },
          })
        : { ok: false, error: { code: 'permission_denied', message: 'Request refused.' } },
    )
  }

  void app.whenReady().then(() => {
    // The app asks for no permission (camera, notifications, geolocation and the rest), so refuse all.
    // Timer reminders use main-process notifications, which this does not affect.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false)
    })
    session.defaultSession.setPermissionCheckHandler(() => false)
    createWindow(inactive)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(inactive)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
