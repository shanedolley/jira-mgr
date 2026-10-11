import type { Issue } from '@jira-mgr/core'

import type { DeleteIssueArgs } from '../../shared/ipc'
import { LoadError } from './LoadError'
import { Modal } from './Modal'
import { StatusDot } from './StatusDot'
import { useIssueDetail } from './queries'

/** Children named in the dialog before "and N more". */
const SHOWN_CHILDREN = 5

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`

interface DeleteIssueDialogProps {
  issue: Issue
  /** Every loaded issue, which says what children the issue has besides its subtasks. */
  issues: readonly Issue[]
  onCancel: () => void
  /** The user confirmed. The caller sends it and closes the dialog. */
  onConfirm: (args: DeleteIssueArgs) => void
  returnFocus: () => void
}

/**
 * The delete confirmation (Q9). It reads the issue afresh and lists every subtask Jira deletes
 * with it, since Jira deletes subtasks only when told to. Cancel has focus, so Enter never
 * deletes, and the destructive button names what goes: the issue alone, or the issue and its
 * subtasks. Child issues that are not subtasks, such as an Epic's Stories, are not deleted, and
 * the dialog says they lose their parent.
 */
export function DeleteIssueDialog({
  issue,
  issues,
  onCancel,
  onConfirm,
  returnFocus,
}: DeleteIssueDialogProps) {
  const detail = useIssueDetail(issue.key)
  const subtasks = detail.data?.subtasks ?? []
  // The read must be fresh: a subtask added a moment ago has to be in the list the user confirms.
  const ready = detail.data !== undefined && !detail.isFetching
  const children = issues
    .filter((i) => i.parentKey === issue.key && !i.issueType.subtask)
    .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }))

  return (
    <Modal
      titleId="delete-title"
      onClose={onCancel}
      returnFocus={returnFocus}
      className="w-[min(30rem,calc(100vw-2rem))]"
    >
      <div className="space-y-3 p-5">
        <h2 id="delete-title" className="text-base font-semibold">
          Delete {issue.key}?
        </h2>
        <p className="break-words">{issue.summary}</p>
        <p className="text-muted">Jira deletes it permanently. This cannot be undone.</p>

        {detail.isError && detail.data === undefined ? (
          <LoadError
            what="the subtasks"
            error={detail.error}
            onRetry={() => void detail.refetch()}
          />
        ) : !ready ? (
          <p role="status" className="text-muted">
            Checking for subtasks
          </p>
        ) : (
          subtasks.length > 0 && (
            <section aria-label="Subtasks deleted with it" className="space-y-1">
              <p className="font-medium">
                {plural(subtasks.length, 'subtask')} will be deleted with it:
              </p>
              <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-md border border-line">
                {subtasks.map((subtask) => (
                  <li key={subtask.key} className="flex h-8 items-center gap-3 px-3">
                    <span className="w-20 shrink-0 font-mono text-xs text-muted">
                      {subtask.key}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{subtask.summary}</span>
                    <span className="shrink-0 text-xs text-muted">{subtask.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        )}

        {children.length > 0 && (
          <section aria-label="Child issues that stay" className="space-y-1">
            <p className="font-medium">
              {plural(children.length, 'child issue')} stay{children.length === 1 ? 's' : ''} and
              lose{children.length === 1 ? 's' : ''} this parent:
            </p>
            <ul className="space-y-0.5 text-muted">
              {children.slice(0, SHOWN_CHILDREN).map((child) => (
                <li key={child.key} className="flex items-center gap-2">
                  <StatusDot status={child.status} />
                  <span className="font-mono text-xs">{child.key}</span>
                  <span className="min-w-0 truncate">{child.summary}</span>
                </li>
              ))}
              {children.length > SHOWN_CHILDREN && (
                <li>and {String(children.length - SHOWN_CHILDREN)} more</li>
              )}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" autoFocus onClick={onCancel} className="btn">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              onConfirm({
                key: issue.key,
                deleteSubtasks: subtasks.length > 0,
                subtasks: subtasks.map((s) => s.key),
              })
            }}
            className="btn btn-danger"
          >
            {subtasks.length > 0
              ? `Delete issue and ${plural(subtasks.length, 'subtask')}`
              : 'Delete issue'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
