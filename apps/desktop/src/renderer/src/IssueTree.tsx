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
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import { extrasWidth, fittingCount } from './propertyFit'
import { TreeRow, rowDomId, rowProgress } from './TreeRow'
import {
  ROW_HEIGHT,
  canDropOn,
  clickRow,
  dropIndicator,
  layoutRows,
  moveActive,
  orderStep,
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

/** Room under the last row while the bulk bar floats over the foot of the Tree. */
const BAR_CLEARANCE = 64

/** The drag payload's type, so a drop on a text field inserts nothing and a file or text from outside is never taken for a row. */
const ISSUE_DRAG = 'application/x-jm-issue'

/** Where a moved issue goes among its siblings: to the place of another, or one step up or down. */
export type MoveTarget = { over: string } | { step: -1 | 1 }

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
  /** Called with the next state after a key or a click. */
  onChange: (next: MoveResult) => void
  /** A click on an issue row's status dot or avatar, made after the row became active. */
  onPick: (key: string, property: 'status' | 'assignee') => void
  /** A click on a group header's "+". */
  onAdd: (row: Row) => void
  /** A drag dropped an issue on a sibling, or Alt+Shift with Up or Down moved the active one. */
  onMove: (key: string, to: MoveTarget) => void
  /** Done over total of each parent's children, of which a Story, Task or Bug row shows its own. */
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
  onChange,
  onPick,
  onAdd,
  onMove,
  progress,
  treeRef,
  empty,
}: IssueTreeProps) {
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)
  const [width, setWidth] = useState(0)
  const anchor = useRef<Anchor | null>(null)
  const ensured = useRef<string | null>(null)
  /** The issue row being dragged, and the sibling it hovers. */
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null)

  const layout = useMemo(() => layoutRows(rows), [rows])
  const indexById = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows])
  const activeIndex = state.activeId === null ? -1 : (indexById.get(state.activeId) ?? -1)
  // The deepest row and the widest extras decide how many properties every row shows, so the
  // columns line up whatever a row holds.
  const shown = useMemo(() => {
    let level = 1
    let extras = 0
    for (const row of rows) {
      if (row.kind !== 'issue') continue
      level = Math.max(level, row.level)
      const held = blocks.get(row.node.issue.key)
      extras = Math.max(
        extras,
        extrasWidth({
          blocked: (held?.blockedBy.length ?? 0) > 0,
          blocking: (held?.blocking.length ?? 0) > 0,
          differs: row.node.customerMismatch !== null,
          timer: row.node.issue.key === timerKey,
          progress: rowProgress(row, progress) !== undefined,
        }),
      )
    }
    return fittingCount(properties, width - 16, level, extras)
  }, [rows, blocks, progress, timerKey, properties, width])
  const pageSize = Math.max(1, Math.floor(height / ROW_HEIGHT))
  const selecting = state.checked.size > 0

  // Takes focus when it first renders, unless the user already put it somewhere.
  useEffect(() => {
    if (document.activeElement === document.body) treeRef.current?.focus()
  }, [treeRef])

  useLayoutEffect(() => {
    const tree = treeRef.current
    if (tree === null) return
    const observer = new ResizeObserver(() => {
      setHeight(tree.clientHeight)
      setWidth(tree.clientWidth)
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
    // The bulk bar covers the foot of the Tree, so a row must clear it to count as in view.
    const inset = selecting ? BAR_CLEARANCE : 0
    if (top < tree.scrollTop) tree.scrollTop = top
    else if (bottom > tree.scrollTop + tree.clientHeight - inset) {
      tree.scrollTop = bottom - tree.clientHeight + inset
    }
    setScrollTop(tree.scrollTop)
  }, [state.activeId, activeIndex, layout, treeRef, selecting])

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
    const input = {
      key: event.key,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
    }
    const step = orderStep(input)
    if (step !== null) {
      event.preventDefault()
      const row = rows[activeIndex]
      if (row?.kind === 'issue') {
        // The move can carry the row far from where it was, so the view follows it.
        ensured.current = null
        onMove(row.node.issue.key, { step })
      }
      return
    }
    const next = moveActive(rows, state, input, { pageSize })
    if (next === null) return
    // Space and the page keys would otherwise scroll the container by themselves.
    event.preventDefault()
    onChange(next)
  }

  /** The id of the row an event happened in. */
  const rowIdOf = (event: DragEvent<HTMLDivElement>) =>
    (event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-row-id]')?.dataset.rowId
      : undefined) ?? null

  function onDragStart(event: DragEvent<HTMLDivElement>) {
    const id = rowIdOf(event)
    const row = rows.find((r) => r.id === id)
    if (id === null || row?.kind !== 'issue') return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(ISSUE_DRAG, row.node.issue.key)
    setDrag({ id, over: null })
    // The dragged row stays active, which keeps it mounted if the drag scrolls it out of the window.
    onChange({ ...state, activeId: id, openPage: false })
  }

  /**
   * Follows the pointer over the rows. A row that refuses the drag still has to accept its
   * `dragenter`, or the browser sends the following `dragover`s to the body and the line would
   * stay on the last row that accepted it. Only a `dragover` on a sibling accepts the drop.
   */
  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (drag === null) return
    const id = rowIdOf(event)
    const allowed = id !== null && canDropOn(rows, drag.id, id)
    if (event.type === 'dragenter' || allowed) event.preventDefault()
    if (allowed) event.dataTransfer.dropEffect = 'move'
    // Dragover is a continuous event, so the state it reads may be a render behind: set it from the latest.
    const over = allowed ? id : null
    setDrag((held) => (held === null || held.over === over ? held : { ...held, over }))
  }

  /** The pointer left the Tree: no drop would land, so no line shows. */
  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDrag((held) => (held?.over == null ? held : { ...held, over: null }))
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (drag === null) return
    const id = rowIdOf(event)
    const row = rows.find((r) => r.id === id)
    setDrag(null)
    if (id === null || row?.kind !== 'issue' || !canDropOn(rows, drag.id, id)) return
    event.preventDefault()
    const from = rows.find((r) => r.id === drag.id)
    if (from?.kind === 'issue') onMove(from.node.issue.key, { over: row.node.issue.key })
  }

  const indicator = drag?.over == null ? null : dropIndicator(rows, drag.id, drag.over)

  const armed = useRef<string | null>(null)
  const onRowClick = useCallback(
    (id: string, onChevron: boolean, select: 'toggle' | 'range' | undefined, detail: number) => {
      // The second click of a double-click on an issue is inert: the Peek may have moved a header or
      // another row under it, and the double-click opens the first click's issue.
      if (detail > 1 && armed.current !== null) return
      // The click also focuses the Tree, the nearest focusable ancestor of the row.
      onChange({ ...clickRow(rows, state, id, onChevron, select), openPage: false })
    },
    [rows, state, onChange],
  )

  const onRowArm = useCallback((id: string | null) => {
    armed.current = id
  }, [])
  const onRowOpen = useCallback(() => {
    const id = armed.current
    // The armed row may have left the Tree since, with a filter or a collapse.
    if (id !== null && rows.some((r) => r.id === id)) {
      onChange({ ...state, activeId: id, openPage: true })
    }
  }, [rows, state, onChange])

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
        onDragStart={onDragStart}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={() => {
          setDrag(null)
        }}
        className="group absolute inset-0 overflow-y-auto overflow-x-hidden focus-visible:outline-none"
      >
        <div
          className="relative"
          style={{ height: layout.total + (selecting ? BAR_CLEARANCE : 0) }}
        >
          {indices.map((index) => {
            const row = rows[index]
            if (row === undefined) return null
            const held = row.kind === 'issue' ? blocks.get(row.node.issue.key) : undefined
            const children = rowProgress(row, progress)
            return (
              <TreeRow
                key={row.id}
                row={row}
                top={layout.tops[index] ?? 0}
                active={row.id === state.activeId}
                selected={row.id === selectedId}
                checked={row.kind === 'issue' && state.checked.has(row.node.issue.key)}
                selecting={selecting}
                timing={row.kind === 'issue' && row.node.issue.key === timerKey}
                dragging={drag?.id === row.id}
                dropEdge={indicator?.id === row.id ? indicator.edge : undefined}
                properties={properties}
                shown={shown}
                today={today}
                blockedBy={held?.blockedBy.length ?? 0}
                blocking={held?.blocking.length ?? 0}
                onClick={onRowClick}
                onArm={onRowArm}
                onOpen={onRowOpen}
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
