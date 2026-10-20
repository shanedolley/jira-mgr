import type { Issue } from '@jira-mgr/core'

import type { DeleteIssueArgs } from '../../shared/ipc'
import { LoadError } from './LoadError'
import { Modal } from './Modal'
import { StatusDot } from './StatusDot'
import { useIssueDetails } from './queries'

/** Children named in the dialog before "and N more". */
const SHOWN_CHILDREN = 5

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`

interface DeleteIssueDialogProps {
  /** The issues to delete: the one the menu or Peek names, or the checked set. */
  targets: readonly Issue[]
  /** Every loaded issue, which says what children the issues have besides their subtasks. */
  issues: readonly Issue[]
  onCancel: () => void
  /** The user confirmed. The caller sends them and closes the dialog. */
  onConfirm: (args: DeleteIssueArgs[]) => void
  returnFocus: () => void
}

/**
 * The delete confirmation (Q9). It reads each issue afresh and lists every subtask Jira deletes
 * with it, since Jira deletes subtasks only when told to. Cancel has focus, so Enter never
 * deletes, and the destructive button names what goes: the issues alone, or the issues and their
 * subtasks. Child issues that are not subtasks, such as an Epic's Stories, are not deleted, and
 * the dialog says they lose their parent. Several targets (the checked set, #339) list the issues
 * too, and a checked subtask is listed once, as an issue.
 */
export function DeleteIssueDialog({
  targets,
  issues,
  onCancel,
  onConfirm,
  returnFocus,
}: DeleteIssueDialogProps) {
  const details = useIssueDetails(targets.map((t) => t.key))
  const [only] = targets
  const many = targets.length > 1
  const checked = new Set(targets.map((t) => t.key))
  const failed = details.find((d) => d.isError && d.data === undefined)
  // The reads must be fresh: a subtask added a moment ago has to be in the list the user confirms.
  const ready = details.every((d) => d.data !== undefined && !d.isFetching)
  const subtasks = [
    ...new Map(
      details
        .flatMap((d) => d.data?.subtasks ?? [])
        .filter((s) => !checked.has(s.key))
        .map((s) => [s.key, s]),
    ).values(),
  ]
  const children = issues
    .filter((i) => i.parentKey !== null && checked.has(i.parentKey))
    .filter((i) => !i.issueType.subtask && !checked.has(i.key))
    .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }))
  const them = many ? 'them' : 'it'

  return (
    <Modal
      titleId="delete-title"
      onClose={onCancel}
      returnFocus={returnFocus}
      className="w-[min(30rem,calc(100vw-2rem))]"
    >
      <div className="space-y-3 p-5">
        <h2 id="delete-title" className="text-base font-semibold">
          {many ? `Delete ${plural(targets.length, 'issue')}?` : `Delete ${only?.key ?? ''}?`}
        </h2>
        {many ? (
          <ul
            aria-label="Issues to delete"
            className="max-h-48 divide-y divide-line overflow-y-auto rounded-md border border-line"
          >
            {targets.map((target) => (
              <li key={target.key} className="flex h-8 items-center gap-3 px-3">
                <span className="w-20 shrink-0 font-mono text-xs text-muted">{target.key}</span>
                <span className="min-w-0 flex-1 truncate">{target.summary}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="break-words">{only?.summary}</p>
        )}
        <p className="text-muted">Jira deletes {them} permanently. This cannot be undone.</p>

        {failed !== undefined ? (
          <LoadError
            what="the subtasks"
            error={failed.error}
            onRetry={() => {
              for (const detail of details) void detail.refetch()
            }}
          />
        ) : !ready ? (
          <p role="status" className="text-muted">
            Checking for subtasks
          </p>
        ) : (
          subtasks.length > 0 && (
            <section aria-label={`Subtasks deleted with ${them}`} className="space-y-1">
              <p className="font-medium">
                {plural(subtasks.length, 'subtask')} will be deleted with {them}:
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
              lose{children.length === 1 ? 's' : ''} {many ? 'their' : 'this'} parent:
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
              onConfirm(
                targets.map((target, at) => {
                  const own = (details[at]?.data?.subtasks ?? []).map((s) => s.key)
                  return { key: target.key, deleteSubtasks: own.length > 0, subtasks: own }
                }),
              )
            }}
            className="btn btn-danger"
          >
            {many ? `Delete ${plural(targets.length, 'issue')}` : 'Delete issue'}
            {subtasks.length > 0 && ` and ${plural(subtasks.length, 'subtask')}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
