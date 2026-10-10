import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import { TreeRow, rowDomId } from './TreeRow'
import {
  ROW_HEIGHT,
  clickRow,
  moveActive,
  windowRange,
  type MoveResult,
  type TreeRow as Row,
  type TreeState,
} from './tree'

interface IssueTreeProps {
  rows: readonly Row[]
  /** Active row, collapsed and revealed sets and the Peek: everything `moveActive` reads. */
  state: TreeState
  /** The key of the issue the Peek shows, whose row is `aria-selected`. */
  peekedKey: string | null
  /** The key of the issue the shared timer runs on, or `null`. */
  timerKey: string | null
  /** Every expandable row id, for Collapse all. */
  expandable: readonly string[]
  /** Called with the next state after a key or a click. */
  onChange: (next: MoveResult) => void
  treeRef: RefObject<HTMLDivElement | null>
  /** Shown over a Tree with no issues, which stays mounted so focus is not lost. */
  empty: ReactNode
}

interface Anchor {
  id: string
  /** Distance from the top of the viewport to the top of the row. */
  offset: number
}

/**
 * The virtual window over the flat rows. Every row is `ROW_HEIGHT` tall, so the window is
 * arithmetic: one inner element as tall as all the rows, and only the rows in view, plus overscan
 * and the active row, are mounted. The Tree is one focusable `role="tree"` that points at the
 * active row with `aria-activedescendant`, since the window unmounts rows.
 */
export function IssueTree({
  rows,
  state,
  peekedKey,
  timerKey,
  expandable,
  onChange,
  treeRef,
  empty,
}: IssueTreeProps) {
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)
  const anchor = useRef<Anchor | null>(null)
  const ensured = useRef<string | null>(null)

  const indexById = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows])
  const activeIndex = state.activeId === null ? -1 : (indexById.get(state.activeId) ?? -1)
  const pageSize = Math.max(1, Math.floor(height / ROW_HEIGHT))

  // Takes focus when it first renders, unless the user already put it somewhere.
  useEffect(() => {
    if (document.activeElement === document.body) treeRef.current?.focus()
  }, [treeRef])

  useLayoutEffect(() => {
    const tree = treeRef.current
    if (tree === null) return
    const observer = new ResizeObserver(() => {
      setHeight(tree.clientHeight)
    })
    observer.observe(tree)
    return () => {
      observer.disconnect()
    }
  }, [treeRef])

  // Scroll anchoring: a rebuild above the viewport (chips arriving, a Story moving under its
  // Epic) must not shift the rows in view, so the first visible row keeps its offset.
  useLayoutEffect(() => {
    const tree = treeRef.current
    const held = anchor.current
    if (tree === null || held === null) return
    const index = indexById.get(held.id)
    if (index === undefined) return
    const wanted = index * ROW_HEIGHT - held.offset
    if (Math.abs(tree.scrollTop - wanted) > 0.5) tree.scrollTop = wanted
    // The scroll event comes after paint, so the window must not wait for it.
    setScrollTop(tree.scrollTop)
  }, [indexById, treeRef])

  // A keyboard move scrolls the active row into view. Only a new active row does, so a rebuild
  // never pulls the view back from where the mouse wheel left it.
  useLayoutEffect(() => {
    const tree = treeRef.current
    if (tree === null || state.activeId === ensured.current) return
    ensured.current = state.activeId
    if (activeIndex < 0) return
    const top = activeIndex * ROW_HEIGHT
    if (top < tree.scrollTop) tree.scrollTop = top
    else if (top + ROW_HEIGHT > tree.scrollTop + tree.clientHeight) {
      tree.scrollTop = top + ROW_HEIGHT - tree.clientHeight
    }
    setScrollTop(tree.scrollTop)
  }, [state.activeId, activeIndex, treeRef])

  const indices = useMemo(
    () => windowRange(scrollTop, height, rows.length, activeIndex),
    [scrollTop, height, rows.length, activeIndex],
  )

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const top = event.currentTarget.scrollTop
    setScrollTop(top)
    const first = Math.floor(top / ROW_HEIGHT)
    const row = rows[first]
    anchor.current = row === undefined ? null : { id: row.id, offset: first * ROW_HEIGHT - top }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = moveActive(
      rows,
      state,
      {
        key: event.key,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
      },
      { pageSize, expandable },
    )
    if (next === null) return
    // Space and the page keys would otherwise scroll the container by themselves.
    event.preventDefault()
    onChange(next)
  }

  const onRowClick = useCallback(
    (id: string, onChevron: boolean) => {
      // The click also focuses the Tree, the nearest focusable ancestor of the row.
      onChange({ ...clickRow(rows, state, id, onChevron), openPage: false })
    },
    [rows, state, onChange],
  )

  const activeRow = activeIndex < 0 ? undefined : rows[activeIndex]
  const selectedId = peekedKey === null ? null : `i:${peekedKey}`

  return (
    <div className="@container relative min-h-0 flex-1">
      <div
        ref={treeRef}
        role="tree"
        aria-label="Issues"
        tabIndex={0}
        aria-activedescendant={activeRow === undefined ? undefined : rowDomId(activeRow.id)}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        className="group absolute inset-0 overflow-y-auto overflow-x-hidden focus-visible:outline-none"
      >
        <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
          {indices.map((index) => {
            const row = rows[index]
            if (row === undefined) return null
            return (
              <TreeRow
                key={row.id}
                row={row}
                index={index}
                active={row.id === state.activeId}
                selected={row.id === selectedId}
                timing={row.kind === 'issue' && row.node.issue.key === timerKey}
                onClick={onRowClick}
              />
            )
          })}
        </div>
      </div>
      {empty}
    </div>
  )
}
