import type { Issue } from '@jira-mgr/core'
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
  created: { title: string; created: CreatedIssue }[]
  failed: { title: string; message: string } | null
  left: string[]
}

/**
 * Creates `titles` one at a time, in order, and stops at the first refusal. Each create waits for
 * the one before it, so the Subtasks come out in the order pasted and a failure leaves nothing
 * half sent: what was created is never sent again, and what is left is exactly what to retry.
 * `onCreated` runs after each create, so the lists can show it at once.
 */
export async function createInOrder(
  titles: readonly string[],
  create: (title: string) => Promise<CreatedIssue>,
  onCreated: (title: string, created: CreatedIssue, done: number) => void = () => undefined,
): Promise<BulkResult> {
  const result: BulkResult = { created: [], failed: null, left: [] }
  for (const [index, title] of titles.entries()) {
    try {
      const created = await create(title)
      result.created.push({ title, created })
      onCreated(title, created, result.created.length)
    } catch (error) {
      result.failed = { title, message: error instanceof Error ? error.message : String(error) }
      result.left = titles.slice(index)
      break
    }
  }
  return result
}

const plural = (count: number) => `${String(count)} sub-issue${count === 1 ? '' : 's'}`

/** What to tell the user once a run ends. A run that stopped stays until dismissed and names what is left. */
export function bulkNotice(parentKey: string, result: BulkResult): Notice {
  const { created, failed, left } = result
  const warnings = created.flatMap(({ created: c }) => (c.warning === null ? [] : [c.warning]))
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
