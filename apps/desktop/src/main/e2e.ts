import { join } from 'node:path'

import { app } from 'electron'

import { start } from './app'
import { createBackend } from './backend'
import { createFakeJira, createFakeKeychain } from './e2e-fake'

// Entry for the Playwright tests: the real app on a fake Jira and a fake Keychain. It is built
// beside `index.js` but is not the package's main, so a normal launch never reaches it.
const stateDir = process.env.JM_STATE_DIR
if (stateDir === undefined || stateDir === '') {
  throw new Error('The e2e entry needs JM_STATE_DIR, so it cannot touch the real state folder.')
}
// Electron's own storage (the theme choice) stays out of the real app's data too.
app.setPath('userData', join(stateDir, 'electron'))

// JM_E2E_BULK adds that many open Stories, for the virtual window test.
const bulk = Number(process.env.JM_E2E_BULK ?? '0')
const jira = createFakeJira({ bulk: Number.isInteger(bulk) && bulk > 0 ? bulk : 0 })
globalThis.fetch = jira.fetch
;(globalThis as { __fakeJira?: unknown }).__fakeJira = jira

start(createBackend({ keychain: createFakeKeychain() }), {
  inactive: true,
  // Stand-ins that count, so a test never opens a browser or waits on a native dialog.
  openExternal: (url) => {
    jira.counts.openExternal.push(url)
  },
  confirmQuit: () => {
    jira.counts.quitPrompts++
    return true
  },
})
