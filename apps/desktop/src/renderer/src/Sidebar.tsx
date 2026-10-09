import type { Session } from '../../shared/ipc'
import { ThemeToggle } from './ThemeToggle'
import { useLogout } from './queries'

export function Sidebar({ session, count }: { session: Session; count: number | undefined }) {
  const logout = useLogout()
  const site = new URL(session.siteUrl).hostname
  return (
    <nav aria-label="Main" className="flex min-h-0 flex-col border-r border-line bg-sidebar">
      <div className="app-drag h-10 shrink-0" />
      <div className="px-3 pb-3">
        <p className="font-semibold">{session.projectKey}</p>
        <p className="truncate text-xs text-muted">{site}</p>
      </div>
      <ul className="flex-1 px-2">
        <li>
          <a
            href="#issues"
            aria-current="page"
            onClick={(event) => {
              event.preventDefault()
            }}
            className="flex items-center justify-between rounded-md bg-selected px-2 py-1"
          >
            <span>Issues</span>
            {count !== undefined && <span className="text-xs text-muted">{count}</span>}
          </a>
        </li>
      </ul>
      <div className="space-y-2 border-t border-line p-3">
        <ThemeToggle />
        <p className="truncate text-xs text-muted" title={session.email}>
          {session.email}
        </p>
        <button
          type="button"
          disabled={logout.isPending}
          onClick={() => {
            logout.mutate()
          }}
          className="w-full rounded-md border border-line px-2 py-1 hover:bg-hover disabled:opacity-60"
        >
          Log out
        </button>
        {logout.isError && (
          <p role="alert" className="text-xs text-danger">
            {logout.error.message}
          </p>
        )}
      </div>
    </nav>
  )
}
