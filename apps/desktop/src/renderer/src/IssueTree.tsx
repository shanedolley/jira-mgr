import type { RowProperty } from '@jira-mgr/core/display'
import type { OpenBlocks } from '@jira-mgr/core/view-filter'
import type { Progress } from '@jira-mgr/core/hierarchy'
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
  layoutRows,
  moveActive,
  rowAtOffset,
  windowRange,
  type MoveResult,
  type TreeRow as Row,
  type TreeState,
} from './tree'

/**
 * With no rows the Tree has no active row to show focus, and the "No issues match" panel covers
 * the Tree, so the ring is a pseudo-element above the panel, drawn while the Tree has focus.
 */
const RING =
  'has-[[role=tree]:focus-visible]:after:pointer-events-none has-[[role=tree]:focus-visible]:after:absolute has-[[role=tree]:focus-visible]:after:inset-0 has-[[role=tree]:focus-visible]:after:z-10 has-[[role=tree]:focus-visible]:after:outline-2 has-[[role=tree]:focus-visible]:after:-outline-offset-2 has-[[role=tree]:focus-visible]:after:outline-accent'

interface IssueTreeProps {
  rows: readonly Row[]
  /** Active row, collapsed and revealed sets and the Peek: everything `moveActive` reads. */
  state: TreeState
  /** The key of the issue the Peek shows, whose row is `aria-selected`. */
  peekedKey: string | null
  /** The key of the issue the shared timer runs on, or `null`. */
  timerKey: string | null
  /** The row properties the Display menu chose. */
  properties: readonly RowProperty[]
  /** Today's local date, for the dates a row shows. */
  today: string
  /** The open blockers of each loaded issue, by key. */
  blocks: ReadonlyMap<string, OpenBlocks>
  /** Every expandable row id, for Collapse all. */
  expandable: readonly string[]
  /** Called with the next state after a key or a click. */
  onChange: (next: MoveResult) => void
  /** A click on an issue row's status dot or avatar, made after the row became active. */
  onPick: (key: string, property: 'status' | 'assignee') => void
  /** A click on a group header's "+". */
  onAdd: (row: Row) => void
  /** Done over total of each parent's children, of which an Epic's row shows its own. */
  progress: ReadonlyMap<string, Progress>
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
 * The virtual window over the flat rows. A row is `ROW_HEIGHT` tall and a Customer header a little
 * taller, so the window reads each row's top from one layout: an inner element as tall as all the
 * rows, and only the rows in view, plus overscan and the active row, are mounted. The Tree is one focusable `role="tree"` that points at the
 * active row with `aria-activedescendant`, since the window unmounts rows.
 */
export function IssueTree({
  rows,
  state,
  peekedKey,
  timerKey,
  properties,
  today,
  blocks,
  expandable,
  onChange,
  onPick,
  onAdd,
  progress,
  treeRef,
  empty,
}: IssueTreeProps) {
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)
  const anchor = useRef<Anchor | null>(null)
  const ensured = useRef<string | null>(null)

  const layout = useMemo(() => layoutRows(rows), [rows])
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
    const wanted = (layout.tops[index] ?? 0) - held.offset
    if (Math.abs(tree.scrollTop - wanted) > 0.5) tree.scrollTop = wanted
    // The scroll event comes after paint, so the window must not wait for it.
    setScrollTop(tree.scrollTop)
  }, [indexById, layout, treeRef])

  // A keyboard move scrolls the active row into view. Only a new active row does, so a rebuild
  // never pulls the view back from where the mouse wheel left it.
  useLayoutEffect(() => {
    const tree = treeRef.current
    if (tree === null || state.activeId === ensured.current) return
    ensured.current = state.activeId
    if (activeIndex < 0) return
    const top = layout.tops[activeIndex] ?? 0
    const bottom = layout.tops[activeIndex + 1] ?? layout.total
    if (top < tree.scrollTop) tree.scrollTop = top
    else if (bottom > tree.scrollTop + tree.clientHeight) {
      tree.scrollTop = bottom - tree.clientHeight
    }
    setScrollTop(tree.scrollTop)
  }, [state.activeId, activeIndex, layout, treeRef])

  const indices = useMemo(
    () => windowRange(layout, scrollTop, height, activeIndex),
    [layout, scrollTop, height, activeIndex],
  )

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const top = event.currentTarget.scrollTop
    setScrollTop(top)
    const first = rowAtOffset(layout, top)
    const row = rows[first]
    anchor.current =
      row === undefined ? null : { id: row.id, offset: (layout.tops[first] ?? 0) - top }
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
    <div
      data-tree-pane
      className={`@container relative min-h-0 flex-1 ${rows.length === 0 ? RING : ''}`}
    >
      <div
        ref={treeRef}
        role="tree"
        data-key-scope
        aria-label="Issues"
        tabIndex={0}
        aria-activedescendant={activeRow === undefined ? undefined : rowDomId(activeRow.id)}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        className="group absolute inset-0 overflow-y-auto overflow-x-hidden focus-visible:outline-none"
      >
        <div className="relative" style={{ height: layout.total }}>
          {indices.map((index) => {
            const row = rows[index]
            if (row === undefined) return null
            const held = row.kind === 'issue' ? blocks.get(row.node.issue.key) : undefined
            // Only an Epic's row shows its progress.
            const children =
              row.kind === 'issue' && row.node.issue.issueType.hierarchyLevel >= 1
                ? progress.get(row.node.issue.key)
                : undefined
            return (
              <TreeRow
                key={row.id}
                row={row}
                top={layout.tops[index] ?? 0}
                active={row.id === state.activeId}
                selected={row.id === selectedId}
                timing={row.kind === 'issue' && row.node.issue.key === timerKey}
                properties={properties}
                today={today}
                blockedBy={held?.blockedBy.length ?? 0}
                blocking={held?.blocking.length ?? 0}
                onClick={onRowClick}
                onPick={onPick}
                onAdd={onAdd}
                done={children?.done}
                total={children?.total}
              />
            )
          })}
        </div>
      </div>
      {empty}
    </div>
  )
}
