import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'

import type { Session } from '../../shared/ipc'
import { DiscardDialog } from './DiscardDialog'
import { Avatar } from './Avatar'
import { INBOX, Icon, LIST, SIDEBAR } from './Icon'
import { useRail } from './narrow'
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

const OVERVIEWS = [
  { id: 'epics', label: 'Epics' },
  { id: 'customers', label: 'Customers' },
] as const

/** A rail link: a 28px icon square that keeps the full link's name for a screen reader. */
const RAIL_LINK = 'relative flex size-7 items-center justify-center rounded-md'

/**
 * The sidebar. Under 960px it is a 48px rail of icons (Inbox, Issues and a button that opens the
 * rest). That button lays the full sidebar over the Tree, with a scrim: Esc, a click outside, a
 * choice or Tab out of it closes it.
 */
export function Sidebar({
  session,
  count,
  issuesCurrent,
  unread,
  inboxOpen,
  onShowInbox,
  overview,
  onShowOverview,
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
  /** The overview page that is open, if any. */
  overview: 'epics' | 'customers' | null
  onShowOverview: (overview: 'epics' | 'customers') => void
  /** Leaves the Inbox, a sprint page or an overview for the issue list. */
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
  const rail = useRail()
  const [open, setOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const expandRef = useRef<HTMLButtonElement>(null)
  /** Esc closed the overlay, so focus goes back to the button that opened it. */
  const restore = useRef(false)
  // Widening the window ends the overlay, so it does not return unasked at the next narrowing.
  if (!rail && open) setOpen(false)
  const overlay = rail && open
  const compact = rail && !open

  useEffect(() => {
    if (overlay) navRef.current?.querySelector<HTMLElement>('a')?.focus()
  }, [overlay])
  useEffect(() => {
    if (!compact || !restore.current) return
    restore.current = false
    expandRef.current?.focus()
  }, [compact])

  if (compact) {
    return (
      <nav
        ref={navRef}
        aria-label="Main"
        className="col-start-1 row-start-1 flex min-h-0 flex-col items-center gap-1 border-r border-line bg-sidebar"
      >
        <div className="app-drag h-10 w-full shrink-0" />
        <button
          ref={expandRef}
          type="button"
          aria-label="Show sidebar"
          aria-expanded={false}
          title="Show sidebar"
          onClick={() => {
            setOpen(true)
          }}
          className="btn btn-icon btn-ghost"
        >
          <Icon path={SIDEBAR} className="size-4" />
        </button>
        <a
          href="#inbox"
          title="Inbox"
          aria-current={inboxOpen ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault()
            onShowInbox()
          }}
          className={`${RAIL_LINK} ${inboxOpen ? 'bg-selected' : 'hover:bg-hover'}`}
        >
          <Icon path={INBOX} className="size-4" />
          <span className="sr-only">
            Inbox{unread !== undefined && unread > 0 ? ` ${String(unread)} unread` : ''}
          </span>
          {unread !== undefined && unread > 0 && (
            <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-accent" />
          )}
        </a>
        <a
          href="#issues"
          title="Issues"
          aria-current={issuesCurrent ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault()
            onShowIssues()
          }}
          className={`${RAIL_LINK} ${issuesCurrent ? 'is-current' : 'hover:bg-hover'}`}
        >
          <Icon path={LIST} className="size-4" />
          <span className="sr-only">Issues</span>
        </a>
      </nav>
    )
  }

  function close(event: KeyboardEvent<HTMLElement>) {
    if (!overlay || event.key !== 'Escape') return
    // The Escape is the overlay's: it must not also close a Peek or a page behind it.
    event.preventDefault()
    event.stopPropagation()
    restore.current = true
    setOpen(false)
  }

  /** A choice that leaves the sidebar closes it; a button that edits something in it does not. */
  function chose(event: MouseEvent<HTMLElement>) {
    if (overlay && event.target instanceof Element && event.target.closest('a, [data-row]')) {
      setOpen(false)
    }
  }

  function leaving(event: FocusEvent<HTMLElement>) {
    if (
      overlay &&
      event.relatedTarget instanceof Node &&
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setOpen(false)
    }
  }

  return (
    <>
      {overlay && (
        <div
          aria-hidden
          onClick={() => {
            setOpen(false)
          }}
          className="fixed inset-0 z-30 bg-[var(--scrim)]"
        />
      )}
      <nav
        ref={navRef}
        aria-label="Main"
        onKeyDown={close}
        onClick={chose}
        onBlur={leaving}
        className={
          overlay
            ? 'absolute inset-y-0 left-0 z-40 flex min-h-0 w-[14.5rem] flex-col border-r border-line bg-sidebar shadow-[0_4px_40px_var(--dialog-shadow)]'
            : 'col-start-1 row-start-1 flex min-h-0 flex-col border-r border-line bg-sidebar'
        }
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
          {OVERVIEWS.map(({ id, label }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={overview === id ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  onShowOverview(id)
                }}
                className={`flex items-center rounded-md px-2 py-1 ${overview === id ? 'is-current' : 'hover:bg-hover'}`}
              >
                {label}
              </a>
            </li>
          ))}
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
    </>
  )
}
