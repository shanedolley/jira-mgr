import type { ReactNode } from 'react'

/** One property of a form or sidebar: a muted name beside its control. */
export function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-1">
      <span aria-hidden className="truncate px-2 text-muted">
        {name}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
