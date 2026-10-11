import { useState, useSyncExternalStore, type ReactNode } from 'react'

import type { Session } from '../../shared/ipc'
import { DiscardDialog } from './DiscardDialog'
import { Avatar } from './Avatar'
import { ThemeToggle } from './ThemeToggle'
import { TimerClock } from './TimerClock'
import { draftCount, subscribeDrafts } from './drafts'
import { useLogout, useMe } from './queries'
import { useTimer } from './timerQueries'

/** The count that sits beside a sidebar link, and what a screen reader hears after it. */
function Badge({ count, what }: { count: number; what: string }) {
  return (
    <span className="rounded bg-accent px-1.5 text-[11px] font-medium leading-5 text-accent-ink">
      {count}
      <span className="sr-only"> {what}</span>
    </span>
  )
}

export function Sidebar({
  session,
  count,
  issuesCurrent,
  unread,
  inboxOpen,
  onShowInbox,
  onShowIssues,
  sprints,
  views,
  onOpenIssue,
  onStopTimer,
}: {
  session: Session
  count: number | undefined
  /** No saved view matches the filters, so Issues is the one highlighted item. */
  issuesCurrent: boolean
  unread: number | undefined
  inboxOpen: boolean
  onShowInbox: () => void
  /** Leaves the Inbox or a sprint page for the issue list. */
  onShowIssues: () => void
  /** The Sprints section, under the main links. */
  sprints?: ReactNode
  /** The saved views section, which sits under the sprints. */
  views?: ReactNode
  /** Opens the page of the issue the timer runs on. */
  onOpenIssue: (key: string) => void
  /** Opens the stop dialog. */
  onStopTimer: () => void
}) {
  const timer = useTimer().data?.timer ?? null
  const logout = useLogout()
  const unsaved = useSyncExternalStore(subscribeDrafts, draftCount)
  const [confirming, setConfirming] = useState(false)
  const me = useMe().data
  const site = new URL(session.siteUrl).hostname
  return (
    <nav
      aria-label="Main"
      className="col-start-1 row-start-1 flex min-h-0 flex-col border-r border-line bg-sidebar"
    >
      <div className="app-drag h-10 shrink-0" />
      <div className="px-3 pb-3">
        <p className="font-semibold">{session.projectKey}</p>
        <p className="truncate text-xs text-muted">{site}</p>
      </div>
      <ul className="space-y-0.5 px-2">
        <li>
          <a
            href="#inbox"
            aria-current={inboxOpen ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              onShowInbox()
            }}
            className={`flex items-center justify-between rounded-md px-2 py-1 ${inboxOpen ? 'bg-selected' : 'hover:bg-hover'}`}
          >
            <span>Inbox</span>
            {unread !== undefined && unread > 0 && <Badge count={unread} what="unread" />}
          </a>
        </li>
        <li>
          <a
            href="#issues"
            aria-current={issuesCurrent ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              onShowIssues()
            }}
            className={`flex items-center justify-between rounded-md px-2 py-1 ${issuesCurrent ? 'is-current' : 'hover:bg-hover'}`}
          >
            <span>Issues</span>
            {count !== undefined && <span className="text-xs text-muted">{count}</span>}
          </a>
        </li>
      </ul>
      {sprints}
      <div className="min-h-0 flex-1 overflow-y-auto">{views}</div>
      {timer !== null && (
        <section aria-label="Timer" className="space-y-1.5 border-t border-line p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">Timer</h2>
            <TimerClock />
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onOpenIssue(timer.issueKey)
              }}
              data-row
              className="min-w-0 truncate font-mono text-xs hover:text-accent"
            >
              {timer.issueKey}
            </button>
            <button type="button" onClick={onStopTimer} className="btn btn-sm">
              Stop
            </button>
          </div>
        </section>
      )}
      <div className="space-y-2 border-t border-line p-3">
        <ThemeToggle />
        <div className="flex items-center gap-2">
          {me !== undefined && <Avatar person={me} />}
          <p className="min-w-0 truncate text-xs text-muted" title={session.email}>
            {session.email}
          </p>
        </div>
        <button
          type="button"
          disabled={logout.isPending}
          onClick={() => {
            if (unsaved > 0) setConfirming(true)
            else logout.mutate()
          }}
          className="btn w-full"
        >
          Log out
        </button>
        {logout.isError && (
          <p role="alert" className="text-xs text-danger">
            {logout.error.message}
          </p>
        )}
      </div>
      {confirming && (
        <DiscardDialog
          title={`Log out and discard ${String(unsaved)} unsaved ${unsaved === 1 ? 'draft' : 'drafts'}?`}
          keepLabel="Keep editing"
          discardLabel="Discard and log out"
          onKeep={() => {
            setConfirming(false)
          }}
          onDiscard={() => {
            setConfirming(false)
            logout.mutate()
          }}
        />
      )}
    </nav>
  )
}
