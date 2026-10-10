import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { LoadError } from './LoadError'

interface SectionProps {
  title: string
  /** Buttons that sit beside the heading. */
  actions?: ReactNode
  children: ReactNode
}

/** One block of the issue page: the small heading D3 and D4 use, and what it holds. */
export function Section({ title, actions, children }: SectionProps) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <div className="flex min-h-6 items-center gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

interface QueryBodyProps<T> {
  query: UseQueryResult<T>
  /** Shown while the first read runs: "Loading comments". */
  loading: string
  children: (data: T) => ReactNode
}

/** The data when it is there, the error with Retry when the first read failed, else the loading text. */
export function QueryBody<T>({ query, loading, children }: QueryBodyProps<T>) {
  if (query.data !== undefined) return <>{children(query.data)}</>
  if (query.isError) {
    return (
      <LoadError
        error={query.error}
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }
  return (
    <p role="status" className="text-muted">
      {loading}
    </p>
  )
}

/** A small button as the page's sections use them. */
export const BUTTON =
  'rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover disabled:opacity-60'
export const DANGER_BUTTON =
  'rounded-md border border-danger px-2 py-0.5 text-xs text-danger hover:bg-hover disabled:opacity-60'
export const PRIMARY_BUTTON =
  'rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50'
export const FIELD = 'h-7 rounded-md border border-field-border bg-panel px-2 text-ink'
