import type { ReactNode } from 'react'

import { Spinner } from './Spinner'

/**
 * One property of a form or sidebar: a muted name beside its control, 32px tall. While `pending`,
 * an edit of it waits on Jira: the value shows dimmed with a spinner (`styles.css`). `field` names
 * the issue field it edits, so the row can flash when Jira refuses the edit.
 */
export function Row({
  name,
  field,
  pending = false,
  children,
}: {
  name: string
  field?: string
  pending?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-field={field}
      className="grid min-h-8 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-1"
    >
      <span aria-hidden className="truncate px-2 text-muted">
        {name}
      </span>
      <div aria-busy={pending || undefined} data-pending={pending || undefined} className="min-w-0">
        {children}
        {pending && <Spinner />}
      </div>
    </div>
  )
}
