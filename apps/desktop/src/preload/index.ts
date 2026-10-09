import { contextBridge, ipcRenderer } from 'electron'

import { CHANNELS, WINDOW_FOCUS_EVENT, type JmApi } from '../shared/ipc'

const requests = Object.fromEntries(
  CHANNELS.map((channel) => [channel, (args: unknown) => ipcRenderer.invoke(channel, args)]),
)

const api = {
  ...requests,
  onWindowFocus(listener) {
    // The listener gets a boolean only, never the Electron event.
    const forward = (_event: unknown, focused: unknown) => {
      listener(focused === true)
    }
    ipcRenderer.on(WINDOW_FOCUS_EVENT, forward)
    return () => {
      ipcRenderer.removeListener(WINDOW_FOCUS_EVENT, forward)
    }
  },
} as JmApi

contextBridge.exposeInMainWorld('jm', api)
