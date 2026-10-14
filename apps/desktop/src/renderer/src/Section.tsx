import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode, Ref } from 'react'

import { Icon, PLUS } from './Icon'
import { LoadError } from './LoadError'

interface SectionProps {
  title: string
  /** Buttons that sit beside the heading. */
  actions?: ReactNode
  /** Drops the rule above, for a section that follows the description as part of its body. */
  plain?: boolean
  children: ReactNode
}

/** A page section's heading: 13/600 in sentence case. Properties groups keep the small uppercase one. */
export const SECTION_HEADING = 'text-[13px] font-semibold leading-5 text-ink'

/** The "+" at a section heading's right edge: how a section adds its first or next item. */
export function AddAction({
  label,
  onClick,
  ref,
}: {
  label: string
  onClick: () => void
  /** Lets the caller return focus here when the form it opened closes. */
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="btn btn-sm btn-icon btn-ghost ml-auto"
    >
      <Icon path={PLUS} />
    </button>
  )
}

/** One block of the issue page: its heading, a 1px rule above, and what it holds. */
export function Section({ title, actions, plain = false, children }: SectionProps) {
  return (
    <section
      aria-label={title}
      className={plain ? 'space-y-1.5' : 'space-y-1.5 border-t border-line pt-4'}
    >
      <div className="flex min-h-6 items-center gap-2">
        <h2 className={SECTION_HEADING}>{title}</h2>
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
  /** What failed to load: "the comments". */
  what: string
  children: (data: T) => ReactNode
}

/** The data when it is there, the error with Retry when the first read failed, else the loading text. */
export function QueryBody<T>({ query, loading, what, children }: QueryBodyProps<T>) {
  if (query.data !== undefined) return <>{children(query.data)}</>
  if (query.isError) {
    return (
      <LoadError
        what={what}
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

export const FIELD = 'h-7 rounded-md border border-field-border bg-panel px-2 text-ink'
