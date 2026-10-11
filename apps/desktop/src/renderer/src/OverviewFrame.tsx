import type { JiraMgrError } from '@jira-mgr/core'
import {
  useEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import { Banner } from './Banner'
import { LoadError } from './LoadError'

/** Marks the control that opens a row, which the arrow keys move between and focus returns to. */
export const OVERVIEW_ROW = { 'data-overview-row': '' } as const

/**
 * Puts a focused control wholly in view in the table's scroll region. The browser leaves a control
 * that shows in part where it is, which in a narrow window is a sort header cut by the window's edge.
 */
export function keepInView(event: FocusEvent<HTMLElement>) {
  event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/** One column header, for a table that does not sort. */
export const TH = 'h-9 px-3 text-left text-[13px] font-normal text-muted'

/** What the overview pages need to know of the Tree's two loads, which the pages cannot see. */
export interface OverviewLoad {
  /** The open issues have loaded. Until then the page shows a loading line, not empty counts. */
  ready: boolean
  /** Why the open issues failed to load, while they hold no copy. */
  error: JiraMgrError | null
  onRetry: () => void
  /** The Done load failed and holds no copy, so every figure that counts Done issues is unknown. */
  doneFailed: boolean
  onRetryDone: () => void
}

/**
 * The page an overview table sits in: a header with the title and a status line, the table below.
 * The Epics and Customers pages share it. Back leaves for the Tree, and so does Esc, through the
 * Shell's key handler. It stands in for the Tree's own banners, which sit under the inert list: a
 * loading line or the load error until the open issues arrive, then a banner while Done is
 * missing. Like the Inbox it places its own focus, once each time it comes to the front: on the
 * row last used, else the first, else the page, and on the first row when rows arrive late.
 */
export function OverviewFrame({
  title,
  front,
  pageRef,
  onBack,
  count,
  doneLoading,
  load,
  children,
}: {
  title: string
  /** False while an issue page covers this one. */
  front: boolean
  pageRef: RefObject<HTMLElement | null>
  onBack: () => void
  /** "4 Epics", or empty while the page has nothing to count yet. */
  count: string
  /** The Done issues are still loading, so the counts are not final. */
  doneLoading: boolean
  load: OverviewLoad
  children: ReactNode
}) {
  const last = useRef<string | null>(null)
  // How far focus has been placed since the page came to the front: nowhere, on the page, on a row.
  const placed = useRef<'none' | 'page' | 'row'>('none')

  const rows = () => [
    ...(pageRef.current?.querySelectorAll<HTMLElement>('[data-overview-row]') ?? []),
  ]

  // Runs after every render, so the first row takes focus once rows load.
  useEffect(() => {
    if (!front) {
      placed.current = 'none'
      return
    }
    if (placed.current === 'row') return
    const all = rows()
    const target = all.find((row) => row.dataset.overviewKey === last.current) ?? all[0]
    if (target === undefined) {
      if (placed.current === 'none') pageRef.current?.focus()
      placed.current = 'page'
      return
    }
    // Rows that arrive after focus moved on, to Back say, leave it there.
    const moved = placed.current === 'page' && document.activeElement !== pageRef.current
    if (!moved) target.focus()
    placed.current = 'row'
  })

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const all = rows()
    if (event.key === 'ArrowDown' && target === event.currentTarget) {
      // Focus on the page itself, before any rows have loaded, still reaches them.
      event.preventDefault()
      all[0]?.focus()
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const next = all[all.indexOf(target) + step]
    if (step === 0 || !all.includes(target) || next === undefined) return
    event.preventDefault()
    next.focus()
  }

  const status =
    !load.ready || count === ''
      ? ''
      : load.doneFailed
        ? `${count}. Done counts are hidden.`
        : doneLoading
          ? `${count}. Loading Done issues, so counts may grow.`
          : count

  return (
    <section
      ref={pageRef}
      aria-label={title}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const key = event.target.dataset.overviewKey
        if (key !== undefined) last.current = key
      }}
      className="relative z-10 flex h-full min-h-0 min-w-0 flex-col bg-canvas outline-none"
    >
      <header className="app-drag flex h-10 shrink-0 items-center gap-3 border-b border-line px-4 max-rail:pl-6">
        <button type="button" onClick={onBack} className="btn btn-sm app-no-drag">
          Back to issues
        </button>
        <h1 className="font-semibold">{title}</h1>
        <span role="status" className="text-xs text-muted">
          {status}
        </span>
      </header>
      {!load.ready ? (
        load.error === null ? (
          <p role="status" className="p-4 text-muted">
            Loading issues
          </p>
        ) : (
          <LoadError what="issues" error={load.error} onRetry={load.onRetry} />
        )
      ) : (
        <>
          {load.doneFailed && (
            <Banner onRetry={load.onRetryDone}>
              Could not load Done issues. Done counts are hidden.
            </Banner>
          )}
          {children}
        </>
      )}
    </section>
  )
}
