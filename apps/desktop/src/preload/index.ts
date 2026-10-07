import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('jm', { platform: process.platform })
