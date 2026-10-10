import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  /** Writes received: edits, transitions, sprint moves, creates and deletes. */
  edits: number
  applied: number
  /** Reads of one issue, in order of arrival. */
  issueReads: string[]
  /** The body of every write received, in order. A delete is `{ delete, deleteSubtasks }`. */
  editBodies: unknown[]
  /** Attachment uploads received, in order of arrival. */
  uploads: { key: string; filename: string; type: string; size: number }[]
  /** Links the app opened in a browser. */
  openExternal: string[]
  /** Times the quit prompt was raised. */
  quitPrompts: number
  /** Every avatar request, in order, and whether it carried an Authorization header. */
  avatarFetches: { url: string; authorized: boolean }[]
  /** The default file name each stand-in save dialog offered, in order. */
  downloads: string[]
  /** Every timer reminder the app raised, in order. */
  notifications: { title: string; body: string }[]
}

interface FakeJira {
  counts: Counts
  releaseEdit: () => void
  releaseNewestEdit: () => void
  fieldsOf: (key: string) => Record<string, unknown> | undefined
  releaseDone: () => void
  failDone: () => void
  failRead: () => void
  dropIssue: (key: string) => void
  refuseNextEdit: () => void
  moveIssue: (key: string, status: 'todo' | 'doing' | 'done') => void
  releaseUpload: () => void
  failUpload: () => void
  setDescription: (key: string, description: unknown) => void
  normaliseDescriptions: () => void
  cancelNextDownload: () => void
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
  const window = await app.firstWindow()
  // The first window arrives before its page has loaded, and a read of computed style before the
  // stylesheet applies sees an unstyled page.
  await window.waitForLoadState()
  return { app, window }
}

/**
 * A JSON file in the state folder, or `null` before the app first writes it. Any other failure
 * throws, so `expect.poll` keeps polling through a missing file and stops on a broken one.
 */
export async function readState<T>(stateDir: string, file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(stateDir, file), 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export const counts = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as WithFake).__fakeJira.counts)

/** Lets the fake Jira answer the oldest edit it holds. Call it once `counts().edits` shows the edit arrived. */
export const releaseEdit = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.releaseEdit()
  })

/** Lets the fake Jira answer the newest edit it holds, as a network may answer a later one first. */
export const releaseNewestEdit = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.releaseNewestEdit()
  })

/** The fields of an issue as the fake Jira holds them, by Jira's field ids. */
export const fieldsOf = (app: ElectronApplication, key: string) =>
  app.evaluate(
    (_electron, name) => (globalThis as unknown as WithFake).__fakeJira.fieldsOf(name),
    key,
  )

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

/** Makes the fake Jira answer 500 to the next read of one issue. */
export const failRead = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.failRead()
  })

/** Makes the fake Jira answer 400 to the next issue edit. */
export const refuseNextEdit = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.refuseNextEdit()
  })

/** Removes an issue from the fake Jira, as if someone else deleted it. The next refetch loses it. */
export const dropIssue = (app: ElectronApplication, key: string) =>
  app.evaluate((_electron, name) => {
    ;(globalThis as unknown as WithFake).__fakeJira.dropIssue(name)
  }, key)

/** Lets the fake Jira answer the oldest attachment upload it holds. Call it once `counts().uploads` shows it arrived. */
export const releaseUpload = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.releaseUpload()
  })

/** Makes the fake Jira answer 500 to the next attachment upload, without holding it. */
export const failUpload = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.failUpload()
  })

/** Replaces an issue's description in the fake Jira, as if someone else edited it. */
export const setDescription = (app: ElectronApplication, key: string, description: unknown) =>
  app.evaluate(
    (_electron, [name, adf]) => {
      ;(globalThis as unknown as WithFake).__fakeJira.setDescription(name as string, adf)
    },
    [key, description],
  )

/** Makes the fake Jira store each saved description with a `localId` on every paragraph. */
export const normaliseDescriptions = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.normaliseDescriptions()
  })

/** Makes the stand-in save dialog answer "cancelled" the next time an attachment is downloaded. */
export const cancelNextDownload = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.cancelNextDownload()
  })

export async function logIn(window: Page, token = TOKEN) {
  await window.getByLabel('Site URL').fill(SITE)
  await window.getByLabel('Project key').fill('PSAPAC')
  await window.getByLabel('Email').fill('me@example.com')
  await window.getByLabel('API token').fill(token)
  await window.getByRole('button', { name: 'Log in' }).click()
}

/** Moves an issue to another status in the fake Jira, as if someone else did. The next refetch sees it. */
export const moveIssue = (
  app: ElectronApplication,
  key: string,
  status: 'todo' | 'doing' | 'done',
) =>
  app.evaluate(
    (_electron, [name, to]) => {
      ;(globalThis as unknown as WithFake).__fakeJira.moveIssue(name ?? '', to as 'todo')
    },
    [key, status],
  )
