const REQUEST = /(?:(?: to)? )?(?:GET|POST|PUT|DELETE|PATCH|HEAD) \/\S*?(?=[:.]?(?:\s|$))/g

/**
 * Jira's message with the request it names ("GET /rest/api/3/issue/PSAPAC-2") left out:
 * "Jira answered 500 to GET /rest/...: Boom." reads "Jira answered 500: Boom."
 */
export const plainMessage = (message: string): string =>
  message.replace(REQUEST, (match, offset: number) =>
    match.startsWith(' to ') ? '' : offset === 0 ? 'The request' : ' the request',
  )

/** Jira's full message behind a disclosure, when it names a request the plain text leaves out. */
export function Details({ message }: { message: string }) {
  if (plainMessage(message) === message) return null
  return (
    <details className="text-xs text-muted">
      <summary className="w-fit cursor-default">Details</summary>
      <p className="mt-1 break-words">{message}</p>
    </details>
  )
}

/** A failed write: what failed and Jira's reason without the request, with the full message in Details. */
export function Failure({
  lead,
  message,
  className,
}: {
  lead?: string
  message: string
  className: string
}) {
  return (
    <div role="alert" className="space-y-0.5">
      <p className={className}>
        {lead === undefined ? '' : `${lead} `}
        {plainMessage(message)}
      </p>
      <Details message={message} />
    </div>
  )
}

/** The same for a note inside a picker. */
export function Reason({ lead, message }: { lead: string; message: string }) {
  return (
    <>
      {lead} {plainMessage(message)}
      <Details message={message} />
    </>
  )
}
