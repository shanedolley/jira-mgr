import type { Issue } from '@jira-mgr/core'
import { useId } from 'react'

import { blankWorklog } from './activity'
import { useAddWorklog } from './activityQueries'
import { Modal } from './Modal'
import { WorklogFormRow } from './WorklogsSection'

interface LogWorkModalProps {
  issue: Issue
  onClose: () => void
  returnFocus: () => void
}

/**
 * The modal behind the Logged slot, `W`, the menu's Log work and the palette's: the Peek's worklog
 * form in a dialog. It closes once Jira has the worklog and the issue is read again, so the row's
 * Logged, Remaining and Remaining % are already new. A refusal keeps it open with the text typed.
 */
export function LogWorkModal({ issue, onClose, returnFocus }: LogWorkModalProps) {
  const titleId = useId()
  const add = useAddWorklog(issue.key)
  return (
    <Modal titleId={titleId} onClose={onClose} closable={!add.isPending} returnFocus={returnFocus}>
      <div className="space-y-3 p-5">
        <h2 id={titleId} className="text-base font-semibold">
          Log work on {issue.key}
        </h2>
        <WorklogFormRow
          name="Log work"
          submitLabel="Log work"
          initial={blankWorklog()}
          hadComment={false}
          onSubmit={async (input) => {
            await add.mutateAsync(input)
            onClose()
          }}
          onCancel={onClose}
          holdEscapeWhileSaving
        />
      </div>
    </Modal>
  )
}
