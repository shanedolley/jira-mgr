import type { Issue } from '@jira-mgr/core'
import type { CustomerOption } from '@jira-mgr/core/hierarchy'
import { useState } from 'react'

import { useEditIssue } from './queries'

export interface Mismatch {
  own: CustomerOption | null
  epic: CustomerOption | null
}

/**
 * The one-click fix of Q15: copies the Epic's Customer onto the child. It is an ordinary
 * optimistic edit, so it rolls back when Jira refuses. The caller keeps the hook mounted, because
 * a successful fix removes the mismatch, and the notice with it, while a refusal's message must
 * stay on screen.
 */
export function useMatchCustomer(issue: Issue) {
  const edit = useEditIssue()
  const [error, setError] = useState<string | null>(null)
  return {
    error,
    match(mismatch: Mismatch) {
      const epic = mismatch.epic
      if (epic === null) return
      setError(null)
      edit.mutate(
        {
          key: issue.key,
          changes: { customerId: epic.id },
          patch: { customer: { id: epic.id, value: epic.value } },
        },
        {
          onError: (failure) => {
            setError(
              `Could not set the Customer, so ${issue.key} shows ${mismatch.own?.value ?? 'none'} again. ${failure.message}`,
            )
          },
        },
      )
    },
  }
}

/**
 * Names both Customers when a child's differs from its Epic's, with the fix button. An Epic with
 * no Customer offers no fix, since core cannot clear the field.
 */
export function CustomerMismatch({
  mismatch,
  onMatch,
}: {
  mismatch: Mismatch
  onMatch: () => void
}) {
  return (
    <div className="space-y-2 rounded-md border border-line px-3 py-2 text-xs">
      <p>
        Customer differs from the Epic. Customer: {mismatch.own?.value ?? 'none'}. Epic&apos;s
        Customer: {mismatch.epic?.value ?? 'none'}.
      </p>
      {mismatch.epic !== null && (
        <button type="button" onClick={onMatch} className="btn btn-sm">
          Match Epic&apos;s Customer
        </button>
      )}
    </div>
  )
}
