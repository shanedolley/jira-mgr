import { mkdir } from 'node:fs/promises'
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
// JM_E2E_LATE_AUTOMATION_MS delays the fake's automation rule, and JM_E2E_LATE_READ_MS shortens the
// app's second read of a created issue, so a test sees the late toast without a 10 s wait.
const lateAutomationMs = process.env.JM_E2E_LATE_AUTOMATION_MS
const lateReadMs = process.env.JM_E2E_LATE_READ_MS
// JM_E2E_REMINDER_MS makes the timer reminders look at the timer that often.
const reminderMs = process.env.JM_E2E_REMINDER_MS
const jira = createFakeJira({
  bulk: Number.isInteger(bulk) && bulk > 0 ? bulk : 0,
  ...(lateAutomationMs !== undefined && { lateAutomationMs: Number(lateAutomationMs) }),
})
globalThis.fetch = jira.fetch
;(globalThis as { __fakeJira?: unknown }).__fakeJira = jira

start(
  createBackend({
    keychain: createFakeKeychain(),
    ...(lateReadMs !== undefined && { lateReadMs: Number(lateReadMs) }),
    // Stands in for the native save dialog: a file under the state folder, or a cancel on request.
    async chooseSavePath(defaultName) {
      jira.counts.downloads.push(defaultName)
      if (jira.takeDownloadCancel()) return null
      const folder = join(stateDir, 'downloads')
      await mkdir(folder, { recursive: true })
      return join(folder, defaultName)
    },
  }),
  {
    inactive: true,
    // Stand-ins that count, so a test never opens a browser or waits on a native dialog.
    openExternal: (url) => {
      jira.counts.openExternal.push(url)
    },
    confirmQuit: () => {
      jira.counts.quitPrompts++
      return true
    },
    notify: (title, body) => {
      jira.counts.notifications.push({ title, body })
    },
    ...(reminderMs !== undefined && { reminderCheckMs: Number(reminderMs) }),
  },
)
