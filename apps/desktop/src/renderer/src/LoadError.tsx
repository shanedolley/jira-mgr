import type { JiraMgrError } from '@jira-mgr/core'

import { useLogout } from './queries'

/** D1's error state: the message, Retry, and Log in again when Jira refused the token. */
export function LoadError({ error, onRetry }: { error: JiraMgrError; onRetry: () => void }) {
  const logout = useLogout()
  return (
    <div role="alert" className="space-y-3 p-4">
      <p className="text-danger">{error.message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-line px-3 py-1 hover:bg-hover"
        >
          Retry
        </button>
        {error.code === 'permission_denied' && (
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
    </div>
  )
}
