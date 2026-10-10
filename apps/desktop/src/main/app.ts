import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { APP_NAME } from '@jira-mgr/core'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'

import { CHANNELS, ISSUES_PROGRESS_EVENT, LATE_READ_EVENT, WINDOW_FOCUS_EVENT } from '../shared/ipc'
import { externalUrl } from '../shared/links'
import type { Backend } from './backend'
import { createHandlers } from './handlers'
import { startReminders } from './reminders'
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

/** What the window does for the renderer that Electron owns: the browser and the quit prompt. */
interface WindowHooks {
  /** Opens a checked URL in the user's browser. */
  openExternal: (url: string) => void
  /** Asks whether to quit with unsaved text. True quits, false stays. */
  confirmQuit: (window: BrowserWindow) => boolean
}

function nativeHooks(): WindowHooks {
  return {
    openExternal(url) {
      void shell.openExternal(url)
    },
    confirmQuit: (window) =>
      dialog.showMessageBoxSync(window, {
        type: 'warning',
        message: 'Quit with unsaved changes?',
        detail: 'A description you are editing has not been saved. Quitting discards it.',
        buttons: ['Quit', 'Stay'],
        defaultId: 1,
        cancelId: 1,
      }) === 0,
  }
}

function createWindow(inactive: boolean, hooks: WindowHooks): void {
  const hideForTest = inactive && process.platform === 'darwin'
  const window = new BrowserWindow({
    // A test run shows its window without taking focus, so it never steals the user's keystrokes.
    // macOS keeps 40px of any window on a display, so it cannot sit off-screen. There the window is
    // invisible and ignores the mouse instead. Playwright drives it over CDP, not the OS. Linux
    // runs under xvfb, where nobody watches and opacity and click-through change the layout tests.
    show: !inactive,
    opacity: hideForTest ? 0 : 1,
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

  // The renderer shows one page. A link opens in the browser, after this check as well as the
  // renderer's, and never in a window of its own.
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = externalUrl(url)
    if (target !== null) hooks.openExternal(target)
    return { action: 'deny' }
  })
  // The renderer sets `onbeforeunload` while a description holds unsaved text, which raises this
  // when the window closes or the app quits. Preventing the event lets the unload go ahead.
  window.webContents.on('will-prevent-unload', (event) => {
    if (hooks.confirmQuit(window)) event.preventDefault()
  })
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

  if (hideForTest) window.setIgnoreMouseEvents(true)
  if (inactive) {
    window.once('ready-to-show', () => {
      window.showInactive()
    })
  }

  void window.loadURL(rendererUrl())
}

export interface StartOptions {
  /** Open windows invisible, click-through and without focus. Only the e2e entry sets it. */
  inactive?: boolean
  /** Replaces `shell.openExternal`, so a test counts links instead of opening a browser. */
  openExternal?: WindowHooks['openExternal']
  /** Replaces the native quit dialog, so a test counts prompts instead of showing one. */
  confirmQuit?: WindowHooks['confirmQuit']
  /** Replaces the native notification of a timer reminder, so a test counts them. */
  notify?: (title: string, body: string) => void
  /** How often the reminders look at the timer. Tests shorten it. */
  reminderCheckMs?: number
}

function nativeNotify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

/** Registers the IPC handlers for `backend` and opens the window once Electron is ready. */
export function start(backend: Backend, options: StartOptions = {}): void {
  const inactive = options.inactive ?? false
  const hooks: WindowHooks = { ...nativeHooks() }
  if (options.openExternal !== undefined) hooks.openExternal = options.openExternal
  if (options.confirmQuit !== undefined) hooks.confirmQuit = options.confirmQuit
  const handlers = createHandlers(backend)
  for (const channel of CHANNELS) {
    ipcMain.handle(channel, (event, raw: unknown) =>
      fromOurWindow(event)
        ? handlers[channel](raw, {
            // Progress goes to the window that asked, and not at all once it is gone.
            sendProgress(progress) {
              if (!event.sender.isDestroyed()) event.sender.send(ISSUES_PROGRESS_EVENT, progress)
            },
            isOpen: () => !event.sender.isDestroyed(),
            sendLateRead(read) {
              if (!event.sender.isDestroyed()) event.sender.send(LATE_READ_EVENT, read)
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
    createWindow(inactive, hooks)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(inactive, hooks)
    })
  })

  // Reminders belong to the app, not a window: they keep firing with every window closed (Q55).
  let stopReminders: (() => void) | undefined
  void app.whenReady().then(() => {
    stopReminders = startReminders({
      notify: options.notify ?? nativeNotify,
      ...(options.reminderCheckMs !== undefined && { checkMs: options.reminderCheckMs }),
    })
  })

  // A pending second read of a created issue dies with the app.
  app.on('before-quit', () => {
    stopReminders?.()
    backend.dispose()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
