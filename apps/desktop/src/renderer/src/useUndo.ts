import { useQueryClient } from '@tanstack/react-query'

import type { Notice } from './create'
import type { IssueDetail } from '@jira-mgr/core/issue'

import { current, issueDetailKey } from './optimistic'
import { saveDescription, useEditIssue, useSetSprint, useSetStatus, useSetSummary } from './queries'
import { changedSince, describeUndo, undoStack, type UndoEntry } from './undo'

const plain = (title: string, notes: string[] = []): Notice => ({ title, notes, warned: false })
const warning = (title: string, notes: string[]): Notice => ({ title, notes, warned: true })

/**
 * Cmd+Z and the toast's Undo button (Q38). It takes the newest edit off the session's stack and
 * writes the old value back through the same mutation as the edit, so the Tree and the Peek show
 * it at once and a refusal from Jira rolls it back. It reports to `report`, never throws.
 *
 * An edit is refused, and dropped from the stack, when the issue no longer shows what the edit
 * set (Jira or someone else changed it since), when the issue has left the caches, or when core
 * cannot write the old value back. A write Jira refuses is dropped too, so the next Cmd+Z reaches
 * the edit before it instead of retrying a refusal.
 */
export function useUndo(report: (notice: Notice) => void) {
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

  return function undo(): void {
    const entry = undoStack(client).pop()
    if (entry === undefined) {
      report(plain('Nothing to undo'))
      return
    }
    if (entry.reversal === null) {
      report(
        warning(`Could not undo the ${entry.what} of ${entry.key}`, [
          'Jira has no way to put the old value back, so change it by hand.',
        ]),
      )
      return
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
      return
    }
    const changed = changedSince(entry, now)
    if (changed !== '') {
      report(
        warning(`Did not undo the ${entry.what} of ${entry.key}`, [
          `Its ${changed} changed since, and the undo would overwrite that.`,
        ]),
      )
      return
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
  }
}
