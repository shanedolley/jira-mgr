import { detailOf } from './ipc'

/** The full message behind a disclosure, when the error's own text leaves out the request it names. */
export function Details({ error }: { error: Error }) {
  const detail = detailOf(error)
  if (detail === undefined) return null
  return (
    <details className="text-xs text-muted">
      <summary className="w-fit cursor-default">Details</summary>
      <p className="mt-1 break-words">{detail}</p>
    </details>
  )
}

/** A failed write: what failed and why, with the full message in Details when there is one. */
export function Failure({
  lead,
  error,
  className,
}: {
  lead?: string
  error: Error
  className: string
}) {
  return (
    <div role="alert" className="space-y-0.5">
      <p className={className}>
        {lead === undefined ? '' : `${lead} `}
        {error.message}
      </p>
      <Details error={error} />
    </div>
  )
}

/** The same for a note inside a picker. */
export function Reason({ lead, error }: { lead: string; error: Error }) {
  return (
    <>
      {lead} {error.message}
      <Details error={error} />
    </>
  )
}
