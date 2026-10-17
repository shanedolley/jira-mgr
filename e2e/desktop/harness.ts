import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'

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
  /** Every bulk POST received, in order, as its path and body. Bulk calls are not held. */
  bulk: { path: string; body: unknown }[]
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
  holdMe: () => void
  releaseMe: () => void
  holdUnresolved: () => void
  releaseUnresolved: () => void
  failRead: () => void
  failTransitions: () => void
  holdTextSearch: () => void
  releaseTextSearch: () => void
  dropIssue: (key: string) => void
  refuseNextEdit: () => void
  refuseNextBulk: () => void
  refuseKeys: (keys: string[]) => void
  moveIssue: (key: string, status: 'todo' | 'doing' | 'done' | 'hold') => void
  releaseUpload: () => void
  failUpload: () => void
  failComments: (status: 404 | 500) => void
  setDescription: (key: string, description: unknown) => void
  joinSprint: (keys: string[], sprintId: number) => void
  normaliseDescriptions: () => void
  setComment: (key: string, id: number, body: unknown) => void
  removeComment: (key: string, id: number) => void
  addWorklog: (key: string, comment: unknown) => void
  logWork: (key: string, started: string, seconds: number) => void
  setEstimate: (key: string, estimate: number | null) => void
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

let display: Promise<string> | undefined

/**
 * On Linux each worker starts its own Xvfb, so apps in two workers never share an X clipboard.
 * `-noreset` keeps it up between apps: Xvfb resets when its last client closes, and refuses an app
 * that connects during the reset.
 */
function workerDisplay(): Promise<string> {
  display ??= new Promise((resolve, reject) => {
    const args = ['-displayfd', '3', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp', '-noreset']
    const xvfb = spawn('Xvfb', args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
    process.on('exit', () => xvfb.kill())
    xvfb.on('error', reject)
    xvfb.on('exit', (code) => {
      reject(new Error(`Xvfb exited with ${String(code)}`))
    })
    xvfb.stdio[3]?.once('data', (number) => {
      resolve(`:${String(number).trim()}`)
    })
  })
  return display
}

/** Launches the e2e entry on `stateDir`. `env` adds to the app's environment, such as `JM_E2E_BULK`. */
export async function launch(
  stateDir: string,
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; window: Page }> {
  const own: Record<string, string> =
    process.platform === 'linux' ? { DISPLAY: await workerDisplay() } : {}
  const app = await electron.launch({
    // GitHub's Linux runners lack the setuid sandbox helper, so CI runs without it.
    args: process.env.CI ? ['--no-sandbox', entry] : [entry],
    env: { ...process.env, ...own, ...env, JM_STATE_DIR: stateDir },
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

/**
 * The open list `popover` sits below `cell`, aligned to its left edge or, where the cell is near the
 * window's right edge and the list flips (`flip-inline`), to its right edge, and stays inside the window.
 */
export async function expectBeside(window: Page, cell: Locator, popover: Locator) {
  const cellBox = await cell.boundingBox()
  const list = await popover.boundingBox()
  if (cellBox === null || list === null) throw new Error('the cell or the list is not drawn')
  expect(list.y).toBeGreaterThanOrEqual(cellBox.y + cellBox.height - 1)
  const leftAligned = Math.abs(list.x - cellBox.x) <= 4
  const rightAligned = Math.abs(list.x + list.width - (cellBox.x + cellBox.width)) <= 4
  expect(leftAligned || rightAligned).toBe(true)
  const width = await window.evaluate(() => globalThis.innerWidth)
  expect(list.x + list.width).toBeLessThanOrEqual(width)
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

/** Makes the fake Jira answer 500 to the next open-issues search page. Call it before logging in. */
export const failUnresolved = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.failUnresolved()
  })

/** Holds the app's read of the current user until `releaseMe`; the login's own read passes. Call it before logging in. */
export const holdMe = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.holdMe()
  })

export const releaseMe = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.releaseMe()
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

/** Makes the fake Jira answer 400 to the next bulk POST, so the app falls back to one call per issue. */
export const refuseNextBulk = (app: ElectronApplication) =>
  app.evaluate(() => {
    ;(globalThis as unknown as WithFake).__fakeJira.refuseNextBulk()
  })

/** Makes the fake Jira refuse every write to these issues, in a bulk task and one at a time. */
export const refuseKeys = (app: ElectronApplication, keys: string[]) =>
  app.evaluate((_electron, names) => {
    ;(globalThis as unknown as WithFake).__fakeJira.refuseKeys(names)
  }, keys)

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

/** Logs `seconds` of work started at the ISO time `started`, before the page opens. */
export const logWork = (app: ElectronApplication, key: string, started: string, seconds: number) =>
  app.evaluate(
    (_electron, [name, when, length]) => {
      ;(globalThis as unknown as WithFake).__fakeJira.logWork(
        name as string,
        when as string,
        length as number,
      )
    },
    [key, started, seconds],
  )

/** Sets an issue's original estimate in seconds, or clears it with `null`, as if someone else did. */
export const setEstimate = (app: ElectronApplication, key: string, estimate: number | null) =>
  app.evaluate(
    (_electron, [name, seconds]) => {
      ;(globalThis as unknown as WithFake).__fakeJira.setEstimate(
        name as string,
        seconds as number | null,
      )
    },
    [key, estimate],
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

/** Opens the Tree to its deepest level from the Groups menu, which shows the Subtasks a first launch hides. */
export async function showEverything(window: Page) {
  await window.getByRole('button', { name: 'Groups', exact: true }).click()
  await window.getByRole('button', { name: 'Everything', exact: true }).click()
}

/** Moves an issue to another status in the fake Jira, as if someone else did. The next refetch sees it. */
export const moveIssue = (
  app: ElectronApplication,
  key: string,
  status: 'todo' | 'doing' | 'done' | 'hold',
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
