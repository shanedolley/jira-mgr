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
  /** Every `text ~` search, in order of arrival, with whether the app aborted it. */
  textSearches: { query: string; aborted: boolean }[]
  /** Every timer reminder the app raised, in order. */
  notifications: { title: string; body: string }[]
  /** The Inbox's searches, and each changelog and newest-comment read it made, as path and query. */
  inbox: { searches: number; reads: string[] }
}

/** One field of a changelog history. */
export interface InboxItem {
  field: string
  fromString: string | null
  toString: string | null
}

interface FakeJira {
  counts: Counts
  releaseEdit: () => void
  releaseNewestEdit: () => void
  fieldsOf: (key: string) => Record<string, unknown> | undefined
  releaseDone: () => void
  failDone: () => void
  failUnresolved: () => void
  holdUnresolved: () => void
  releaseUnresolved: () => void
  failRead: () => void
  failTransitions: () => void
  holdTextSearch: () => void
  releaseTextSearch: () => void
  dropIssue: (key: string) => void
  refuseNextEdit: () => void
  moveIssue: (key: string, status: 'todo' | 'doing' | 'done') => void
  releaseUpload: () => void
  failUpload: () => void
  failComments: (status: 404 | 500) => void
  setDescription: (key: string, description: unknown) => void
  joinSprint: (keys: string[], sprintId: number) => void
  normaliseDescriptions: () => void
  setComment: (key: string, id: number, body: unknown) => void
  removeComment: (key: string, id: number) => void
  addWorklog: (key: string, comment: unknown) => void
  holdReads: () => void
  releaseReads: () => void
  cancelNextDownload: () => void
  inboxChange: (key: string, by: 'me' | 'other', items: InboxItem[]) => void
  inboxComment: (key: string, by: 'me' | 'other') => void
  inboxWatch: (key: string) => void
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

/** The toasts on screen, newest last. Each is one list item; a refusal's item holds an alert. */
export const notices = (window: Page) => window.getByRole('list', { name: 'Notices' })

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

/** Makes the fake Jira answer 500 to the next open-issues search page. Call it before logging in. */
export const failUnresolved = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.failUnresolved()
  })

/** Holds the open-issues search until `releaseUnresolved`. Call it before logging in. */
export const holdUnresolved = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.holdUnresolved()
  })

export const releaseUnresolved = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.releaseUnresolved()
  })

/** Makes the fake Jira answer 500 to the next read of one issue. */
export const failRead = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.failRead()
  })

/** Makes the fake Jira answer 500 to the next read of an issue's transitions, the Status picker's lookup. */
export const failTransitions = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.failTransitions()
  })

/** Makes the fake Jira answer `status` to the next read of an issue's comments, the Comments section's load. */
export const failComments = (app: ElectronApplication, status: 404 | 500) =>
  app.evaluate((_electron, code) => {
    ;(globalThis as unknown as WithFake).__fakeJira.failComments(code)
  }, status)

/** Holds each text search in the fake Jira until `releaseTextSearch`, or until the app aborts it. */
export const holdTextSearch = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.holdTextSearch()
  })

/** Answers the held text searches and stops holding. */
export const releaseTextSearch = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.releaseTextSearch()
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

/** Puts issues into a sprint of the fake Jira, as if someone else moved them. */
export const joinSprint = (app: ElectronApplication, keys: string[], sprintId: number) =>
  app.evaluate(
    (_electron, [names, id]) => {
      ;(globalThis as unknown as WithFake).__fakeJira.joinSprint(names as string[], id as number)
    },
    [keys, sprintId],
  )

/** Makes the fake Jira store each saved description with a `localId` on every paragraph. */
export const normaliseDescriptions = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.normaliseDescriptions()
  })

/** Replaces a comment's body in the fake Jira, as if someone else edited it. */
export const setComment = (app: ElectronApplication, key: string, id: number, body: unknown) =>
  app.evaluate(
    (_electron, [name, commentId, adf]) => {
      ;(globalThis as unknown as WithFake).__fakeJira.setComment(
        name as string,
        commentId as number,
        adf,
      )
    },
    [key, id, body],
  )

/** Removes a comment from the fake Jira, as if someone else deleted it. */
export const removeComment = (app: ElectronApplication, key: string, id: number) =>
  app.evaluate(
    (_electron, [name, commentId]) => {
      ;(globalThis as unknown as WithFake).__fakeJira.removeComment(
        name as string,
        commentId as number,
      )
    },
    [key, id],
  )

/** Adds a worklog by the signed-in user whose comment is this document, before the page opens. */
export const addWorklog = (app: ElectronApplication, key: string, comment: unknown) =>
  app.evaluate(
    (_electron, [name, adf]) => {
      ;(globalThis as unknown as WithFake).__fakeJira.addWorklog(name as string, adf)
    },
    [key, comment],
  )

/** Holds each comment and link list read until `releaseReads`, so a test sees the page before a refetch lands. */
export const holdReads = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.holdReads()
  })

/** Answers the held list reads and stops holding. */
export const releaseReads = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.releaseReads()
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

/** Records a change to an issue in the fake Jira's changelog, by the signed-in user or by someone else, and adds it to the Inbox search. */
export const inboxChange = (
  app: ElectronApplication,
  key: string,
  by: 'me' | 'other',
  items: InboxItem[],
) =>
  app.evaluate(
    (_electron, [name, who, changed]) => {
      ;(globalThis as unknown as WithFake).__fakeJira.inboxChange(
        name as string,
        who as 'me',
        changed as InboxItem[],
      )
    },
    [key, by, items],
  )

/** Adds a comment to an issue in the fake Jira, by the signed-in user or by someone else, and adds it to the Inbox search. */
export const inboxComment = (app: ElectronApplication, key: string, by: 'me' | 'other') =>
  app.evaluate(
    (_electron, [name, who]) => {
      ;(globalThis as unknown as WithFake).__fakeJira.inboxComment(name ?? '', who as 'me')
    },
    [key, by],
  )

/** Adds an issue to the Inbox search with no change on it. */
export const inboxWatch = (app: ElectronApplication, key: string) =>
  app.evaluate((_electron, name) => {
    ;(globalThis as unknown as WithFake).__fakeJira.inboxWatch(name)
  }, key)
