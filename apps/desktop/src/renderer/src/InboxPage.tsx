import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

import type { InboxEntry } from '../../shared/ipc'
import { Banner } from './Banner'
import { Failure } from './Failure'
import {
  age,
  newestUpdated,
  unreadCount,
  useInbox,
  useMarkInboxAllRead,
  useMarkInboxRead,
} from './inboxQueries'
import { LoadError } from './LoadError'

/** What the second line of an entry says: the change since the user looked, or where the issue stands. */
function subtitle({ issue, change }: InboxEntry): string {
  if (change === null) return `${issue.key} · ${issue.status.name}`
  // A comment's summary already names its writer.
  const by = change.summary.includes(change.by) ? '' : ` · ${change.by}`
  return `${issue.key} · ${change.summary}${by}`
}

function Row({
  entry,
  now,
  onOpen,
}: {
  entry: InboxEntry
  now: number
  onOpen: (entry: InboxEntry) => void
}) {
  const { issue, unread, change } = entry
  const at = change?.at ?? issue.updated
  return (
    <li>
      <button
        type="button"
        data-row
        data-inbox-row
        data-inbox-key={issue.key}
        data-issue-key={issue.key}
        data-unread={unread ? '' : undefined}
        onClick={() => {
          onOpen(entry)
        }}
        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-hover"
      >
        <span
          aria-hidden
          className={`size-2 shrink-0 rounded-full ${unread ? 'bg-accent' : 'bg-transparent'}`}
        />
        <span className="min-w-0 flex-1">
          {unread && <span className="sr-only">Unread. </span>}
          <span className={`block truncate ${unread ? 'font-semibold' : 'text-muted'}`}>
            {issue.summary}
          </span>
          <span className="block truncate text-xs text-muted">{subtitle(entry)}</span>
        </span>
        <time dateTime={at} className="shrink-0 text-xs text-muted">
          {age(at, now)}
        </time>
      </button>
    </li>
  )
}

/**
 * The Inbox: the issues the user is assigned to, reported or watches that changed lately, the
 * unread ones first marked. Opening an entry marks it read and opens its page; Mark all read
 * clears every mark up to the newest change in the list.
 */
export function InboxPage({
  front,
  onOpen,
  pageRef,
}: {
  /** False while an issue page covers this one. Focus comes back to the row the user opened. */
  front: boolean
  /** Opens the page of the issue. */
  onOpen: (key: string) => void
  pageRef: RefObject<HTMLElement | null>
}) {
  // The Shell's own read polls, so the page adds no timer.
  const inbox = useInbox(false)
  const markRead = useMarkInboxRead()
  const markAll = useMarkInboxAllRead()
  const list = useRef<HTMLUListElement>(null)
  const opened = useRef<string | null>(null)
  // Whether focus has been placed since the page came to the front.
  const placed = useRef(false)
  const entries = inbox.data
  const unread = entries === undefined ? 0 : unreadCount(entries)

  // Focus goes to the row the user opened, else the first, so the arrow keys work at once. With
  // no rows yet it waits on the page itself, and lands on the first row when they load.
  useEffect(() => {
    if (!front) {
      placed.current = false
      return
    }
    if (placed.current) return
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-inbox-row]') ?? [])]
    const target = rows.find((row) => row.dataset.inboxKey === opened.current) ?? rows[0]
    if (target === undefined) {
      pageRef.current?.focus()
      return
    }
    target.focus()
    placed.current = true
  }, [front, entries, pageRef])

  function open(entry: InboxEntry) {
    opened.current = entry.issue.key
    markRead.mutate({ key: entry.issue.key, updated: entry.issue.updated })
    onOpen(entry.issue.key)
  }

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0 || !(event.target instanceof HTMLElement)) return
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-inbox-row]')]
    const next = rows[rows.indexOf(event.target) + step]
    if (next === undefined) return
    event.preventDefault()
    next.focus()
  }

  function markAllRead() {
    const through = entries === undefined ? null : newestUpdated(entries)
    if (through === null) return
    markAll.mutate({ through })
    // The button disables once nothing is unread, and focus must not fall to the page behind.
    list.current?.querySelector<HTMLElement>('[data-inbox-row]')?.focus()
  }

  const failed = markRead.isError ? markRead : markAll.isError ? markAll : null
  let body
  if (entries === undefined) {
    body = inbox.isError ? (
      <LoadError what="the Inbox" error={inbox.error} onRetry={() => void inbox.refetch()} />
    ) : (
      <p role="status" className="p-4 text-muted">
        Loading the Inbox
      </p>
    )
  } else if (entries.length === 0) {
    body = (
      <p className="p-4 text-muted">
        Nothing has changed lately on the issues you are assigned to, reported or watch.
      </p>
    )
  } else {
    // The ages are as of the last read, which is when the list was true.
    const now = inbox.dataUpdatedAt
    body = (
      <ul
        ref={list}
        aria-label="Inbox items"
        onKeyDown={onListKey}
        className="min-h-0 flex-1 divide-y divide-line overflow-y-auto"
      >
        {entries.map((entry) => (
          <Row key={entry.issue.key} entry={entry} now={now} onOpen={open} />
        ))}
      </ul>
    )
  }

  return (
    <section
      ref={pageRef}
      aria-label="Inbox"
      tabIndex={-1}
      onKeyDown={(event) => {
        // Focus on the page itself, before any rows have loaded, still reaches them.
        if (event.key !== 'ArrowDown' || event.target !== event.currentTarget) return
        event.preventDefault()
        list.current?.querySelector<HTMLElement>('[data-inbox-row]')?.focus()
      }}
      className="relative z-10 flex h-full min-h-0 min-w-0 flex-col bg-canvas outline-none"
    >
      <header className="app-drag flex h-10 shrink-0 items-center justify-between border-b border-line px-4 max-rail:pl-6">
        <h1 className="font-semibold">Inbox</h1>
        <div className="flex items-center gap-3">
          <span role="status" className="text-xs text-muted">
            {inbox.isFetching && entries !== undefined ? 'Updating...' : ''}
          </span>
          <button
            type="button"
            disabled={unread === 0 || markAll.isPending}
            onClick={markAllRead}
            className="btn btn-sm app-no-drag"
          >
            Mark all read
          </button>
        </div>
      </header>
      {inbox.isError && entries !== undefined && (
        <Banner onRetry={() => void inbox.refetch()}>Could not refresh the Inbox.</Banner>
      )}
      {failed !== null && (
        <Failure
          lead="Could not save the read mark."
          error={failed.error}
          className="shrink-0 border-b border-line px-4 py-1.5 text-xs text-danger"
        />
      )}
      {body}
    </section>
  )
}
