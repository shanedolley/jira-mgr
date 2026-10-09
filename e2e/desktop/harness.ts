import { fileURLToPath } from 'node:url'

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

// The e2e entry runs the real app on a fake Jira and a fake Keychain, and needs JM_STATE_DIR.
const entry = fileURLToPath(new URL('../../apps/desktop/out/main/e2e.js', import.meta.url))

export const SITE = 'https://fake.atlassian.net'
export const TOKEN = 'good-token'

/** Counters the fake Jira in the app's main process keeps. */
export interface Counts {
  searches: { unresolved: number; done: number }
  doneEarly: number
  /** Writes received: edits, transitions and sprint moves. */
  edits: number
  applied: number
  /** Reads of one issue, in order of arrival. */
  issueReads: string[]
  /** The body of every write received, in order. */
  editBodies: unknown[]
}

interface FakeJira {
  counts: Counts
  releaseEdit: () => void
  releaseDone: () => void
  failDone: () => void
}

interface WithFake {
  __fakeJira: FakeJira
}

/** Launches the e2e entry on `stateDir`. `env` adds to the app's environment, such as `JM_E2E_BULK`. */
export async function launch(
  stateDir: string,
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    // GitHub's Linux runners lack the setuid sandbox helper, so CI runs without it.
    args: process.env.CI ? ['--no-sandbox', entry] : [entry],
    env: { ...process.env, ...env, JM_STATE_DIR: stateDir },
  })
  return { app, window: await app.firstWindow() }
}

export const counts = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as WithFake).__fakeJira.counts)

/** Lets the fake Jira answer the oldest edit it holds. Call it once `counts().edits` shows the edit arrived. */
export const releaseEdit = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.releaseEdit()
  })

/** Lets the fake Jira answer the first Done page it holds. Until then no Done issue has loaded. */
export const releaseDone = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.releaseDone()
  })

/** Makes the fake Jira answer 500 to the next Done page. */
export const failDone = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.failDone()
  })

export async function logIn(window: Page, token = TOKEN) {
  await window.getByLabel('Site URL').fill(SITE)
  await window.getByLabel('Project key').fill('PSAPAC')
  await window.getByLabel('Email').fill('me@example.com')
  await window.getByLabel('API token').fill(token)
  await window.getByRole('button', { name: 'Log in' }).click()
}
