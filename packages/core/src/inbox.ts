import { z } from 'zod'

import { JiraMgrError, type ErrorCode } from './errors.js'
import type { HttpClient } from './http.js'
import { jiraTime, type Issue } from './issue.js'
import { getCurrentUser } from './lookups.js'
import { searchJqlPages } from './search.js'
import { stateFile } from './state.js'
import { issueKey, parseInput, parseResponse, projectKeyOrSettings } from './validate.js'

/**
 * How far back the Inbox looks. The search (`updated >= -14d`) and the pruning of read marks use
 * this one number, so they cannot disagree.
 */
export const INBOX_DAYS = 14

const DAY_MS = 86_400_000

/** The time before every issue's `updated`: the mark of an Inbox that nothing has read. */
const NEVER = '1970-01-01T00:00:00.000Z'

/** The most changelog histories one read asks for, and the most issues read at once. */
const HISTORY_PAGE = 100
const READ_AT_ONCE = 5

/** The errors that mean one issue's history cannot be read, as opposed to Jira being down. */
const GONE: readonly ErrorCode[] = ['not_found', 'permission_denied']

/** The values Jira's text for a change shows before cutting it. */
const VALUE_MAX = 40

const instant = z.iso.datetime({ offset: true }).transform((time) => new Date(time).toISOString())

const inboxSchema = z.object({
  version: z.literal(1),
  /** Everything updated at or before this time is read. */
  allReadAt: instant,
  /** The `updated` time of each issue the user opened, from after `allReadAt`. */
  reads: z.record(issueKey, instant),
})

/** `inbox.json`: the read marks of the Inbox. The app writes it. */
export type InboxState = z.output<typeof inboxSchema>

const inboxFile = stateFile('inbox.json', inboxSchema, (): InboxState => ({
  version: 1,
  allReadAt: NEVER,
  reads: {},
}))

/** Returns an Inbox with nothing read when `inbox.json` does not exist. */
export const readInbox = inboxFile.read
export const writeInbox = inboxFile.write

const time = (text: string) => Date.parse(text)

/** The issue's read mark: the later of `allReadAt` and its own mark. */
export function readMark(inbox: InboxState, key: string): string {
  const own = inbox.reads[key]
  return own !== undefined && time(own) > time(inbox.allReadAt) ? own : inbox.allReadAt
}

/** True when the issue changed after its read mark. Own changes are not weighed here: see `listInbox`. */
export function isUnread(inbox: InboxState, issue: Pick<Issue, 'key' | 'updated'>): boolean {
  return time(issue.updated) > time(readMark(inbox, issue.key))
}

/**
 * Drops each mark that `allReadAt` already covers and each older than the Inbox window, so the
 * file holds at most the issues read in the last `INBOX_DAYS`. A dropped mark loses nothing: an
 * issue outside the search window is not listed, and one updated again is unread anyway.
 */
export function pruned(inbox: InboxState, now: Date): InboxState {
  const oldest = Math.max(time(inbox.allReadAt), now.getTime() - INBOX_DAYS * DAY_MS)
  return {
    ...inbox,
    reads: Object.fromEntries(
      Object.entries(inbox.reads).filter(([, mark]) => time(mark) > oldest),
    ),
  }
}

const markInput = z.object({ key: issueKey, updated: instant })
const throughInput = z.object({ through: instant })

/** `updated` is the issue's own, as Jira sent it, so a change that lands after it stays unread. */
export function withRead(inbox: InboxState, key: string, updated: string, now: Date): InboxState {
  const input = parseInput(markInput, { key, updated }, 'mark the issue read')
  const kept = inbox.reads[input.key]
  const later = kept !== undefined && time(kept) > time(input.updated) ? kept : input.updated
  return pruned({ ...inbox, reads: { ...inbox.reads, [input.key]: later } }, now)
}

/** `through` is the newest `updated` in the list the user saw. */
export function withAllRead(inbox: InboxState, through: string, now: Date): InboxState {
  const input = parseInput(throughInput, { through }, 'mark everything read')
  const allReadAt = time(input.through) > time(inbox.allReadAt) ? input.through : inbox.allReadAt
  return pruned({ ...inbox, allReadAt }, now)
}

/**
 * Marks one issue read and writes the file. Read, change and write happen in one call with no
 * lock, so the caller runs the writes one at a time (the app's main process queues them).
 */
export async function markRead(key: string, updated: string, now = new Date()): Promise<void> {
  await writeInbox(withRead(await readInbox(), key, updated, now))
}

/** Marks everything up to `through` read and writes the file. The caller orders the writes. */
export async function markAllRead(through: string, now = new Date()): Promise<void> {
  await writeInbox(withAllRead(await readInbox(), through, now))
}

/** The issues the user is assigned to, reported or watches, updated in the last `INBOX_DAYS`, newest first. */
export function inboxJql(projectKey: string): string {
  return `project = "${projectKey}" AND (assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= -${String(INBOX_DAYS)}d ORDER BY updated DESC`
}

const person = z.object({ accountId: z.string(), displayName: z.string() })

const historiesPage = z.object({
  startAt: z.number().optional(),
  maxResults: z.number(),
  total: z.number(),
  values: z.array(
    z.object({
      created: jiraTime,
      author: person.nullish(),
      items: z.array(
        z.object({
          field: z.string(),
          fromString: z.string().nullish(),
          toString: z.string().nullish(),
        }),
      ),
    }),
  ),
})

type History = z.output<typeof historiesPage>['values'][number]

const newestComment = z.object({
  comments: z.array(
    z.object({
      created: jiraTime,
      updated: jiraTime,
      author: person.nullish(),
      updateAuthor: person.nullish(),
    }),
  ),
})

type Comment = z.output<typeof newestComment>['comments'][number]

/** What one issue's changelog and newest comment held at one `updated` time. Each loads on first use. */
interface Facts {
  histories: () => Promise<History[]>
  comment: () => Promise<Comment | null>
}

/** Holds what was read, so a poll that finds an issue unchanged asks Jira for nothing more. */
export interface InboxCache {
  facts: Map<string, Facts>
  me: Promise<string> | undefined
}

/** One per account: the app creates a new one on login and logout. */
export function createInboxCache(): InboxCache {
  return { facts: new Map(), me: undefined }
}

/** Runs `load` once and keeps the promise, unless it fails: a failure is read again next time. */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let held: Promise<T> | undefined
  return () =>
    (held ??= load().catch((error: unknown) => {
      held = undefined
      throw error
    }))
}

/**
 * The newest histories of the issue, oldest first. Jira lists oldest first and sends no order
 * option, so an issue with more than a page reads its last page.
 */
// ponytail: a user with over 100 own changes after the mark hides an older change by someone else.
async function readHistories(
  http: HttpClient,
  key: string,
  signal: AbortSignal | undefined,
): Promise<History[]> {
  const read = async (startAt: number) =>
    parseResponse(
      historiesPage,
      await http.request(
        'GET',
        `/rest/api/3/issue/${key}/changelog?startAt=${String(startAt)}&maxResults=${String(HISTORY_PAGE)}`,
        { signal },
      ),
      'changelog',
    )
  const first = await read(0)
  if (first.values.length >= first.total) return first.values
  return (await read(Math.max(0, first.total - first.maxResults))).values
}

async function readNewestComment(
  http: HttpClient,
  key: string,
  signal: AbortSignal | undefined,
): Promise<Comment | null> {
  const raw = await http.request(
    'GET',
    `/rest/api/3/issue/${key}/comment?orderBy=-created&maxResults=1`,
    { signal },
  )
  return parseResponse(newestComment, raw, 'comments').comments[0] ?? null
}

/** The names Jira gives fields in a changelog that read badly in a list. */
const FIELD_LABELS: Record<string, string> = {
  IssueParentAssociation: 'Parent',
  timeestimate: 'Remaining estimate',
  timeoriginalestimate: 'Original estimate',
  timespent: 'Time spent',
  duedate: 'Due date',
}

const label = (field: string) =>
  FIELD_LABELS[field] ?? `${field.charAt(0).toUpperCase()}${field.slice(1)}`

const cut = (text: string) => (text.length > VALUE_MAX ? `${text.slice(0, VALUE_MAX)}...` : text)

/** "Status: To Do to In Progress", with "and 2 more" when the change touched more fields. */
function describe(history: History): string {
  const [first, ...more] = history.items
  if (first === undefined) return 'Changed'
  const name = label(first.field)
  const from = first.fromString ?? ''
  const to = first.toString ?? ''
  let text: string
  if (first.field === 'description' || (from === '' && to === '')) text = `${name} changed`
  else if (from === '') text = `${name}: set to ${cut(to)}`
  else if (to === '') text = `${name}: ${cut(from)} cleared`
  else text = `${name}: ${cut(from)} to ${cut(to)}`
  return more.length === 0 ? text : `${text} and ${String(more.length)} more`
}

/** What changed on an issue since the user last looked, and who changed it. */
export interface InboxChange {
  by: string
  summary: string
  /** When the change was made. */
  at: string
}

export interface InboxEntry {
  issue: Issue
  /** The issue changed after its read mark, by someone else. */
  unread: boolean
  /** The newest change by someone else after the read mark. `null` when the entry is read. */
  change: InboxChange | null
}

/**
 * The newest change after `mark` that someone else made: a changelog history, else the newest
 * comment (a comment writes no history). `null` when every change since was the user's own.
 */
async function changeSince(facts: Facts, mark: number, me: string): Promise<InboxChange | null> {
  const others = (await facts.histories()).filter(
    (h) => time(h.created) > mark && h.author?.accountId !== me,
  )
  const newest = others.reduce<History | undefined>(
    (best, h) => (best === undefined || time(h.created) > time(best.created) ? h : best),
    undefined,
  )
  if (newest !== undefined) {
    return {
      by: newest.author?.displayName ?? 'Jira',
      summary: describe(newest),
      at: newest.created,
    }
  }
  const comment = await facts.comment()
  const writer = comment?.updateAuthor ?? comment?.author
  if (comment === null || time(comment.updated) <= mark || writer?.accountId === me) return null
  return {
    by: writer?.displayName ?? 'Jira',
    summary: `Comment by ${writer?.displayName ?? 'Jira'}`,
    at: comment.updated,
  }
}

async function inPool<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const at = next++
      results[at] = await run(items[at] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return results
}

export interface ListInboxOptions {
  /** The read marks, as `readInbox` returned them. */
  inbox: InboxState
  cache: InboxCache
  signal?: AbortSignal
  /** The moment the Inbox window ends. Defaults to now. */
  now?: Date
}

/**
 * The project issues the user is assigned to, reported or watches that changed in the last
 * `INBOX_DAYS`, newest first. An issue changed after its read mark is unread only when someone
 * else made the change, which costs a changelog read (and sometimes a comment read) per unread
 * issue, kept in `cache` while the issue's `updated` stays the same. Throws like the search and
 * the reads do, and keeps no partial answer.
 */
export async function listInbox(
  http: HttpClient,
  options: ListInboxOptions,
): Promise<InboxEntry[]> {
  const { inbox, cache, signal, now = new Date() } = options
  // A change from before the window is not news, whatever the read mark says.
  const windowStart = now.getTime() - INBOX_DAYS * DAY_MS
  const projectKey = await projectKeyOrSettings()
  const issues: Issue[] = []
  for await (const page of searchJqlPages(http, inboxJql(projectKey), { signal })) {
    issues.push(...page)
  }
  /** Asked for only once an issue needs weighing, so a poll that finds nothing unread never asks. */
  const whoAmI = () =>
    (cache.me ??= getCurrentUser(http, { signal }).then(
      (user) => user.accountId,
      (error: unknown) => {
        cache.me = undefined
        throw error
      },
    ))

  const entries = await inPool(issues, READ_AT_ONCE, async (issue): Promise<InboxEntry> => {
    const read: InboxEntry = { issue, unread: false, change: null }
    if (!isUnread(inbox, issue)) return read
    // The key goes into a request path, so it must be an issue key, whatever Jira sent.
    if (!issueKey.safeParse(issue.key).success) return read
    const id = `${issue.key} ${issue.updated}`
    let facts = cache.facts.get(id)
    if (facts === undefined) {
      facts = {
        histories: lazy(() => readHistories(http, issue.key, signal)),
        comment: lazy(() => readNewestComment(http, issue.key, signal)),
      }
      cache.facts.set(id, facts)
    }
    const mark = Math.max(time(readMark(inbox, issue.key)), windowStart)
    const me = await whoAmI()
    try {
      const change = await changeSince(facts, mark, me)
      return { issue, unread: change !== null, change }
    } catch (error) {
      // An issue the user cannot read the history of, or that was deleted since the search, must
      // not fail the whole Inbox. It shows read, and is tried again when it next changes.
      if (error instanceof JiraMgrError && GONE.includes(error.code)) return read
      throw error
    }
  })

  // An issue that moved on, or left the window, never needs its old facts again.
  const current = new Set(issues.map((issue) => `${issue.key} ${issue.updated}`))
  for (const id of cache.facts.keys()) if (!current.has(id)) cache.facts.delete(id)
  return entries
}
