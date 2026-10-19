import type { Issue } from '@jira-mgr/core'
import { useId, useState } from 'react'

import type { CurrentUser } from '../../shared/ipc'
import { CommentsSection } from './CommentsSection'
import type { Notice } from './create'
import { Modal } from './Modal'

interface CommentsModalProps {
  issue: Issue
  me: CurrentUser | undefined
  onClose: () => void
  returnFocus: () => void
}

/**
 * The modal behind the Comments slot: the issue page's comments section in a dialog, with focus in
 * the new-comment box. Esc and a leaving editor close it (a box holding text asks first, as the
 * page does), and the Close button closes it with any draft kept. A notice the section raises
 * shows in the dialog, since the toasts sit under its backdrop.
 */
export function CommentsModal({ issue, me, onClose, returnFocus }: CommentsModalProps) {
  const titleId = useId()
  const [notice, setNotice] = useState<Notice | null>(null)
  return (
    <Modal
      titleId={titleId}
      onClose={onClose}
      returnFocus={returnFocus}
      className="w-[min(40rem,calc(100vw-2rem))]"
    >
      <div className="space-y-3 p-5">
        <h2 id={titleId} className="text-base font-semibold">
          Comments on {issue.key}: {issue.summary}
        </h2>
        <CommentsSection
          issueKey={issue.key}
          me={me}
          // An edit that ends keeps focus in the dialog; the box closing it is the way out.
          onLeave={() => undefined}
          onBoxLeave={onClose}
          onNotice={setNotice}
          focusBox
        />
        {notice !== null && (
          <p role="alert" className="text-danger">
            {[notice.title, ...notice.notes].join(' ')}
          </p>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn">
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
