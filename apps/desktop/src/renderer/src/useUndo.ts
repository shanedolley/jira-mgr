import { useQueryClient } from '@tanstack/react-query'

import type { Notice } from './create'
import type { IssueDetail } from '@jira-mgr/core/issue'

import { issues, namedKeys } from './batch'
import { current, issueDetailKey } from './optimistic'
import {
  saveDescription,
  useBatch,
  useEditIssue,
  useSetSprint,
  useSetStatus,
  useSetSummary,
} from './queries'
import {
  changedSince,
  describeUndo,
  isBatch,
  planBatchUndo,
  undoStack,
  type BatchEntry,
  type StackEntry,
  type UndoEntry,
} from './undo'
import { refusedBatchNotice } from './batch'

const plain = (title: string, notes: string[] = []): Notice => ({ title, notes, warned: false })
const warning = (title: string, notes: string[]): Notice => ({ title, notes, warned: true })

/**
 * Cmd+Z and the toast's Undo button (Q38). It takes the newest edit off the session's stack, or
 * the one a toast offers when that is an older one, and writes the old value back through the
 * same mutation as the edit, so the Tree and the Peek show it at once and a refusal from Jira
 * rolls it back. It reports to `report`, never throws.
 *
 * A batch comes back as one batch: each issue goes back to its own prior value, and an issue that
 * changed since, or left the caches, is skipped and named instead of overwritten.
 *
 * An edit is refused, and dropped from the stack, when the issue no longer shows what the edit
 * set (Jira or someone else changed it since), when the issue has left the caches, or when core
 * cannot write the old value back. A write Jira refuses is dropped too, so the next Cmd+Z reaches
 * the edit before it instead of retrying a refusal.
 */
export function useUndo(report: (notice: Notice) => void, batch: ReturnType<typeof useBatch>) {
  const client = useQueryClient()
  const edit = useEditIssue()
  const status = useSetStatus()
  const sprint = useSetSprint()
  const summary = useSetSummary()

  async function send(entry: UndoEntry): Promise<void> {
    const { key, before, reversal } = entry
    switch (reversal?.kind) {
      case 'edit':
        await edit.mutateAsync({ key, changes: reversal.changes, patch: before, undoing: true })
        return
      case 'status':
        await status.mutateAsync({ key, statusId: reversal.statusId, patch: before, undoing: true })
        return
      case 'sprint':
        await sprint.mutateAsync({ key, sprintId: reversal.sprintId, patch: before, undoing: true })
        return
      case 'summary':
        await summary.mutateAsync({ key, summary: reversal.summary, undoing: true })
        return
      case 'description':
        // Written against the description Jira holds now, which the stale check just compared.
        await saveDescription(client, {
          key,
          description: reversal.description,
          base: client.getQueryData<IssueDetail>(issueDetailKey(key))?.description ?? null,
          undoing: true,
        })
        return
      case undefined:
        return
    }
  }

  /** Sends the issues of a batch back as one batch, skipping and naming those that changed since. */
  function undoBatch(entry: BatchEntry): void {
    const { items, skipped } = planBatchUndo(entry, (key) => current(client, key))
    const skippedNote = `Did not undo ${namedKeys(skipped)}: changed since, and the undo would overwrite that.`
    if (items.length === 0) {
      report(warning(`Did not undo the ${entry.what} of ${issues(skipped.length)}`, [skippedNote]))
      return
    }
    batch.run({ items, title: (n) => `Undid ${entry.what} on ${issues(n)}`, undoing: true }).then(
      ({ done, refused }) => {
        const title = `Undid the ${entry.what} of ${issues(done.length)}`
        const notes = [...(skipped.length === 0 ? [] : [skippedNote])]
        if (refused.length > 0) {
          const { title: head, notes: why } = refusedBatchNotice(`The ${entry.what}`, refused)
          report(warning(`${title}. ${head}`, [...notes, ...why]))
        } else if (notes.length > 0) report(warning(title, notes))
        else report(plain(title))
      },
      (failure: unknown) => {
        report(
          warning(`Could not undo the ${entry.what} of ${issues(items.length)}`, [
            failure instanceof Error ? failure.message : 'Jira refused the change.',
          ]),
        )
      },
    )
  }

  /** Returns the edit it took off the stack, so the caller can drop the toasts that offered it. */
  return function undo(offered?: StackEntry): StackEntry | undefined {
    const entry = offered === undefined ? undoStack(client).pop() : undoStack(client).take(offered)
    if (entry === undefined) {
      report(plain('Nothing to undo'))
      return undefined
    }
    if (isBatch(entry)) {
      undoBatch(entry)
      return entry
    }
    if (entry.reversal === null) {
      report(
        warning(`Could not undo the ${entry.what} of ${entry.key}`, [
          'Jira has no way to put the old value back, so change it by hand.',
        ]),
      )
      return entry
    }
    // The description lives only on the page's own read; every other field on the lists.
    const now =
      entry.reversal.kind === 'description'
        ? client.getQueryData<IssueDetail>(issueDetailKey(entry.key))
        : current(client, entry.key)
    if (now === undefined) {
      report(
        warning(`Could not undo the ${entry.what} of ${entry.key}`, [
          `${entry.key} is no longer loaded.`,
        ]),
      )
      return entry
    }
    const changed = changedSince(entry, now)
    if (changed !== '') {
      report(
        warning(`Did not undo the ${entry.what} of ${entry.key}`, [
          `Its ${changed} changed since, and the undo would overwrite that.`,
        ]),
      )
      return entry
    }
    send(entry).then(
      () => {
        report(plain(describeUndo(entry)))
      },
      (failure: unknown) => {
        report(
          warning(`Could not undo the ${entry.what} of ${entry.key}`, [
            failure instanceof Error ? failure.message : 'Jira refused the change.',
            `${entry.key} shows its current value again.`,
          ]),
        )
      },
    )
    return entry
  }
}
