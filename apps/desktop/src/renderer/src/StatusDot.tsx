import type { Issue } from '@jira-mgr/core'

const COLOURS: Record<Issue['status']['category'], string> = {
  new: 'var(--status-new)',
  indeterminate: 'var(--status-doing)',
  done: 'var(--status-done)',
  undefined: 'var(--status-new)',
}

/** The status category as a ring, filled for work in progress and Done. The name is the accessible label. */
export function StatusDot({ status }: { status: Issue['status'] }) {
  const colour = COLOURS[status.category]
  return (
    <svg
      role="img"
      aria-label={status.name}
      viewBox="0 0 14 14"
      className="size-3.5 shrink-0"
      fill={status.category === 'new' || status.category === 'undefined' ? 'none' : colour}
      stroke={colour}
      strokeWidth="1.5"
    >
      <circle cx="7" cy="7" r="5.5" />
    </svg>
  )
}
