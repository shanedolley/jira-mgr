import { JiraMgrError, type ErrorCode, type Issue } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'

import type { CreateIssueArgs, CreatedIssue } from '../../shared/ipc'
import { fitsParent, type Notice } from './create'

/**
 * The pure model behind the Subtasks section: which issues take Subtasks, how a pasted list
 * becomes titles, the create request for each, how a run that stops part way reads, and the count
 * in the heading. Every create goes through `issues:create`, so Jira access stays in core.
 */

/** Titles one paste may create. Each is one write to Jira, one after another. */
export const MAX_NEW_SUBTASKS = 50

/** The longest summary `issues:create` accepts. */
export const MAX_TITLE = 255

/** Whether `issue` takes Subtasks: a Story, Task or Bug. An Epic does not, and a Subtask cannot hold one. */
export const takesSubtasks = (issue: Issue): boolean => fitsParent('Subtask', issue)

/** One title per line. Blank lines and the spaces around a title are dropped; nothing else is changed. */
export const parseTitles = (text: string): string[] =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

/** Done and total, for the heading's "2/5". */
export function progressOf(subtasks: IssueDetail['subtasks']): { done: number; total: number } {
  return { done: subtasks.filter((subtask) => subtask.done).length, total: subtasks.length }
}

/** Why the list cannot be sent, or `null`. */
export function titlesProblem(titles: readonly string[]): string | null {
  if (titles.length > MAX_NEW_SUBTASKS) {
    return `Paste at most ${String(MAX_NEW_SUBTASKS)} titles at a time. This has ${String(titles.length)}.`
  }
  const long = titles.find((title) => title.length > MAX_TITLE)
  return long === undefined
    ? null
    : `A title is longer than ${String(MAX_TITLE)} characters: "${long.slice(0, 40)}..."`
}

/** Why `parent` cannot take Subtasks yet: Jira requires its Customer and Engagement on every issue. */
export function parentProblem(parent: Issue): string | null {
  const missing = [
    ...(parent.customer === null ? ['Customer'] : []),
    ...(parent.engagement === null ? ['Engagement'] : []),
  ]
  return missing.length === 0 ? null : `${parent.key} needs its ${missing.join(' and ')} set first.`
}

/** The create request for one Subtask under `parent`, with the parent's Customer and Engagement. */
export function subtaskArgs(parent: Issue, title: string): CreateIssueArgs | null {
  if (parent.customer === null || parent.engagement === null) return null
  return {
    type: 'Subtask',
    summary: title,
    parentKey: parent.key,
    customerId: parent.customer.id,
    engagementId: parent.engagement.id,
  }
}

/** What one run did. `left` holds the title that failed and every title after it, still to create. */
export interface BulkResult {
  /** `confirmed` marks a Subtask Jira made although its reply was lost, found by reading the parent. */
  created: { title: string; created: CreatedIssue; confirmed?: true }[]
  /** `unconfirmed` means the create may have reached Jira and the read that would tell failed too. */
  failed: { title: string; message: string; unconfirmed: boolean } | null
  left: string[]
}

/**
 * The codes of a failed create that may still have reached Jira: the network failed, the request
 * timed out, Jira answered 5xx or sent a reply core could not read (`jira_error`), or the app broke
 * after sending (`internal`). A refusal (`validation_failed`, `not_found`, `permission_denied`) and
 * an error thrown before any send mean nothing was made.
 */
const MAY_HAVE_LANDED: readonly ErrorCode[] = ['jira_error', 'internal']

const mayHaveLanded = (error: unknown): boolean =>
  error instanceof JiraMgrError && MAY_HAVE_LANDED.includes(error.code)

/**
 * The key of the Subtask a lost create made, or `null`. It is the one whose summary equals `title`
 * exactly and whose key is not in `skip`: the parent's Subtasks before the run, and every Subtask
 * this run made or confirmed. The skip set keeps a Subtask that already had the title, or an
 * earlier copy of it in the same paste, from standing in for this one.
 */
export function landedKey(
  subtasks: IssueDetail['subtasks'],
  title: string,
  skip: ReadonlySet<string>,
): string | null {
  return subtasks.find((s) => s.summary === title && !skip.has(s.key))?.key ?? null
}

/**
 * Reads the parent's Subtasks and returns the key `landedKey` finds, skipping `before` (the keys
 * the page held when the run began) and `made` (the keys this run made or confirmed). Throws when
 * there is no `before` to compare with, since any match could be an older Subtask.
 */
export async function confirmLanded(
  before: readonly string[] | undefined,
  read: () => Promise<IssueDetail['subtasks']>,
  title: string,
  made: ReadonlySet<string>,
): Promise<string | null> {
  if (before === undefined) throw new Error('The page held no Subtasks list to compare with.')
  return landedKey(await read(), title, new Set([...before, ...made]))
}

/**
 * Creates `titles` one at a time, in order, and stops at the first refusal. Each create waits for
 * the one before it, so the Subtasks come out in the order pasted and a failure leaves nothing
 * half sent: what was created is never sent again, and what is left is exactly what to retry.
 * `onCreated` runs after each create, so the lists can show it at once; if it throws, the title
 * still counts as created.
 *
 * When a create fails in a way that may have reached Jira, `confirm` reads the parent first, given
 * the keys made so far. It returns the key of a Subtask that now holds the title, which counts as
 * created, or `null` for none. If it throws, the title stays in `left` and the failure is
 * `unconfirmed`, so the notice can warn that it may exist.
 */
export async function createInOrder(
  titles: readonly string[],
  create: (title: string) => Promise<CreatedIssue>,
  onCreated: (title: string, created: CreatedIssue, done: number) => void = () => undefined,
  confirm?: (title: string, made: ReadonlySet<string>) => Promise<string | null>,
): Promise<BulkResult> {
  const result: BulkResult = { created: [], failed: null, left: [] }
  for (const [index, title] of titles.entries()) {
    let created: CreatedIssue
    let confirmed = false
    try {
      created = await create(title)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      let unconfirmed = false
      let key: string | null = null
      if (confirm !== undefined && mayHaveLanded(error)) {
        try {
          key = await confirm(title, new Set(result.created.map((made) => made.created.key)))
        } catch {
          unconfirmed = true
        }
      }
      if (key === null) {
        result.failed = { title, message, unconfirmed }
        result.left = titles.slice(index)
        break
      }
      created = { key, issue: null, warning: null }
      confirmed = true
    }
    result.created.push(confirmed ? { title, created, confirmed } : { title, created })
    try {
      onCreated(title, created, result.created.length)
    } catch {
      // The Subtask exists. Showing it is the caller's affair, and must never turn it into a retry.
    }
  }
  return result
}

const plural = (count: number) => `${String(count)} sub-issue${count === 1 ? '' : 's'}`

/** What to tell the user once a run ends. A run that stopped stays until dismissed and names what is left. */
export function bulkNotice(parentKey: string, result: BulkResult): Notice {
  const { created, failed, left } = result
  const lost = created.flatMap((made) =>
    made.confirmed === true
      ? [`"${made.title}" reached Jira as ${made.created.key} although its reply was lost.`]
      : [],
  )
  const warnings = [
    ...lost,
    ...created.flatMap(({ created: c }) => (c.warning === null ? [] : [c.warning])),
  ]
  if (failed === null) {
    return {
      title: `Created ${plural(created.length)} under ${parentKey}`,
      notes: warnings,
      warned: warnings.length > 0,
    }
  }
  const total = created.length + left.length
  const untried = left.length - 1
  return {
    title:
      created.length === 0
        ? `Could not create sub-issues under ${parentKey}`
        : `Created ${String(created.length)} of ${plural(total)} under ${parentKey}`,
    notes: [
      `Could not create "${failed.title}". ${failed.message}`,
      ...(failed.unconfirmed
        ? [`"${failed.title}" may already exist. Check the Subtasks before creating it again.`]
        : []),
      ...(untried > 0 ? [`${String(untried)} more not tried.`] : []),
      ...warnings,
    ],
    warned: true,
  }
}

/** The subtask list with one more entry, from the issue Jira holds. A repeated key replaces its entry. */
export function withSubtask(
  subtasks: IssueDetail['subtasks'],
  issue: Pick<IssueDetail, 'key' | 'summary' | 'status'>,
): IssueDetail['subtasks'] {
  const entry = {
    key: issue.key,
    summary: issue.summary,
    status: issue.status.name,
    done: issue.status.category === 'done',
  }
  return subtasks.some((held) => held.key === entry.key)
    ? subtasks.map((held) => (held.key === entry.key ? entry : held))
    : [...subtasks, entry]
}
