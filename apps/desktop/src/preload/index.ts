import { contextBridge, ipcRenderer } from 'electron'

import {
  BATCH_PROGRESS_EVENT,
  CHANNELS,
  ISSUES_PROGRESS_EVENT,
  LATE_READ_EVENT,
  WINDOW_FOCUS_EVENT,
  type BatchProgress,
  type IssuesProgress,
  type LateRead,
  type JmApi,
} from '../shared/ipc'

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
  onIssuesProgress(listener) {
    const forward = (_event: unknown, progress: unknown) => {
      // Main sends the shape; the listener still gets only the three fields, never the Electron event.
      const { phase, loadId, loaded } = progress as IssuesProgress
      listener({ phase, loadId, loaded })
    }
    ipcRenderer.on(ISSUES_PROGRESS_EVENT, forward)
    return () => {
      ipcRenderer.removeListener(ISSUES_PROGRESS_EVENT, forward)
    }
  },
  onBatchProgress(listener) {
    const forward = (_event: unknown, progress: unknown) => {
      const { batchId, done, total } = progress as BatchProgress
      listener({ batchId, done, total })
    }
    ipcRenderer.on(BATCH_PROGRESS_EVENT, forward)
    return () => {
      ipcRenderer.removeListener(BATCH_PROGRESS_EVENT, forward)
    }
  },
  onLateRead(listener) {
    const forward = (_event: unknown, read: unknown) => {
      const { key, issue } = read as LateRead
      listener({ key, issue })
    }
    ipcRenderer.on(LATE_READ_EVENT, forward)
    return () => {
      ipcRenderer.removeListener(LATE_READ_EVENT, forward)
    }
  },
} as JmApi

contextBridge.exposeInMainWorld('jm', api)
