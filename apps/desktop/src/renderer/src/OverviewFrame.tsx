import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

/** Marks the control that opens a row, which the arrow keys move between and focus returns to. */
export const OVERVIEW_ROW = { 'data-overview-row': '' } as const

/** One column header, for a table that does not sort. */
export const TH = 'h-9 px-3 text-left text-[13px] font-normal text-muted'

/**
 * The page an overview table sits in: a header with the title and a status line, the table below.
 * The Epics and Customers pages share it. Esc and Back leave for the Tree. Like the Inbox it places
 * its own focus: on the row last used, else the first, else the page, whenever it comes to the front.
 */
export function OverviewFrame({
  title,
  front,
  pageRef,
  onBack,
  status,
  children,
}: {
  title: string
  /** False while an issue page covers this one. */
  front: boolean
  pageRef: RefObject<HTMLElement | null>
  onBack: () => void
  /** What the header says beside the title: a count, or that Done issues are still loading. */
  status: string
  children: ReactNode
}) {
  const last = useRef<string | null>(null)
  // Whether focus has been placed since the page came to the front.
  const placed = useRef(false)

  const rows = () => [
    ...(pageRef.current?.querySelectorAll<HTMLElement>('[data-overview-row]') ?? []),
  ]

  // Runs after every render, so the first row takes focus once rows load.
  useEffect(() => {
    if (!front) {
      placed.current = false
      return
    }
    if (placed.current) return
    const all = rows()
    const target = all.find((row) => row.dataset.overviewKey === last.current) ?? all[0]
    if (target === undefined) {
      pageRef.current?.focus()
      return
    }
    target.focus()
    placed.current = true
  })

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onBack()
      return
    }
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
      <header className="app-drag flex h-10 shrink-0 items-center gap-3 border-b border-line px-4">
        <button type="button" onClick={onBack} className="btn btn-sm app-no-drag">
          Back to issues
        </button>
        <h1 className="font-semibold">{title}</h1>
        <span role="status" className="text-xs text-muted">
          {status}
        </span>
      </header>
      {children}
    </section>
  )
}
