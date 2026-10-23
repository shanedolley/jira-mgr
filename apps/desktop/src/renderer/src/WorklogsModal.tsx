import type { Issue } from '@jira-mgr/core'
import { formatEstimate } from '@jira-mgr/core/issue'
import { useId, useState, type KeyboardEvent } from 'react'

import type { CurrentUser } from '../../shared/ipc'
import { newestFirst, totalSpent } from './activity'
import { useWorklogs } from './activityQueries'
import type { Notice } from './create'
import { keyOf } from './keymap'
import { Modal } from './Modal'
import { QueryBody } from './Section'
import { WorklogList } from './WorklogsSection'

interface WorklogsModalProps {
  issue: Issue
  me: CurrentUser | undefined
  onClose: () => void
  /** Opens the Log work form over this list: the button and `Shift+T` both call it. */
  onLogWork: () => void
  returnFocus: () => void
}

/** Shift+T alone, typed anywhere in the modal but a field, which keeps its letters. */
function asksToLog(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== 't' || !event.shiftKey) return false
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return false
  if (event.defaultPrevented || event.nativeEvent.isComposing) return false
  const target = event.target instanceof Element ? event.target : null
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') ==
    null
  )
}

/**
 * The modal behind `W`, the menu's Worklogs and the palette's: every worklog of the issue, newest
 * start first, with the total logged. The rows are the issue page's, so Edit and Delete work on
 * your own. The header, the Log work button and Close stay in view: only the list scrolls.
 */
export function WorklogsModal({ issue, me, onClose, onLogWork, returnFocus }: WorklogsModalProps) {
  const titleId = useId()
  const worklogs = useWorklogs(issue.key)
  const [notice, setNotice] = useState<Notice | null>(null)
  const total = worklogs.data === undefined ? 0 : totalSpent(worklogs.data)
  return (
    <Modal
      titleId={titleId}
      onClose={onClose}
      returnFocus={returnFocus}
      className="w-[min(40rem,calc(100vw-2rem))] open:flex open:flex-col"
    >
      <div
        // A click on blank space lands here, so Shift+T still reaches the handler.
        tabIndex={-1}
        onKeyDown={(event) => {
          if (!asksToLog(event)) return
          event.preventDefault()
          onLogWork()
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 p-5 outline-none"
      >
        <div className="space-y-0.5">
          <h2 id={titleId} className="text-base font-semibold">
            Worklogs on {issue.key}: {issue.summary}
          </h2>
          {total > 0 && <p className="text-xs text-muted">Logged {formatEstimate(total)}</p>}
        </div>
        <QueryBody query={worklogs} loading="Loading worklogs" what="the worklogs">
          {(list) =>
            list.length === 0 ? (
              <p className="text-muted">No work logged</p>
            ) : (
              <WorklogList
                worklogs={newestFirst(list)}
                issueKey={issue.key}
                me={me}
                onNotice={setNotice}
                className="min-h-0 overflow-y-auto"
              />
            )
          }
        </QueryBody>
        {notice !== null && (
          <p role="alert" className="text-danger">
            {[notice.title, ...notice.notes].join(' ')}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn">
            Close
          </button>
          <button
            type="button"
            // Not `autoFocus`: showModal() runs after this mounts and focuses the element with the
            // `autofocus` attribute, else the first control, which here is a row's Edit button.
            ref={(button) => button?.setAttribute('autofocus', '')}
            aria-keyshortcuts={keyOf('logWork')}
            onClick={onLogWork}
            className="btn btn-primary"
          >
            Log work
          </button>
        </div>
      </div>
    </Modal>
  )
}
