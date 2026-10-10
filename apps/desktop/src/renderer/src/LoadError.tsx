import type { JiraMgrError } from '@jira-mgr/core'

import { useLogout } from './queries'

/**
 * D1's error state: what failed, Retry, and Log in again when Jira refused the token. Jira's own
 * message, which names the request, sits behind Details.
 */
export function LoadError({
  what,
  error,
  onRetry,
}: {
  /** What did not load, after "Could not load": "this issue", "the description". */
  what: string
  error: JiraMgrError
  onRetry: () => void
}) {
  const logout = useLogout()
  const denied = error.code === 'permission_denied'
  return (
    <div role="alert" className="space-y-3 p-4">
      <p className="text-danger">
        Could not load {what}.{' '}
        {denied ? 'Retry, or log in again.' : 'Retry, or check your connection.'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-line px-3 py-1 hover:bg-hover"
        >
          Retry
        </button>
        {denied && (
          <button
            type="button"
            onClick={() => {
              logout.mutate()
            }}
            className="rounded-md border border-line px-3 py-1 hover:bg-hover"
          >
            Log in again
          </button>
        )}
      </div>
      <details className="text-xs text-muted">
        <summary className="w-fit cursor-default">Details</summary>
        <p className="mt-1 break-words">{error.message}</p>
      </details>
    </div>
  )
}
