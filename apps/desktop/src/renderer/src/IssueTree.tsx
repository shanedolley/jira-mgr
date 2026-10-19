import type { Issue } from '@jira-mgr/core'
import type { PropertyWidths, RowProperty } from '@jira-mgr/core/display'
import type { OpenBlocks } from '@jira-mgr/core/view-filter'
import type { Progress } from '@jira-mgr/core/hierarchy'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import type { CellProperty } from './cell'
import { ColumnHeader } from './ColumnHeader'
import { keepsLetters } from './keymap'
import { colVars, extrasWidth, fitWidths, stripRoom } from './propertyFit'
import { TreeRow, rowDomId, rowProgress } from './TreeRow'
import {
  ROW_HEIGHT,
  canDropOn,
  clickRow,
  dropIndicator,
  hoverRow,
  layoutRows,
  moveActive,
  orderStep,
  pointerMoved,
  rowAtOffset,
  windowRange,
  type MoveResult,
  type Point,
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

/** What the Shell can ask of the Tree. */
export interface TreeControl {
  /** Scrolls the row with this id into view, as a keyboard move does. */
  reveal: (id: string) => void
}

interface IssueTreeProps {
  rows: readonly Row[]
  /** Active row, collapsed and revealed sets and the Peek: everything `moveActive` reads. */
  state: TreeState
  /** The key of the issue the Peek shows, whose row is `aria-current`. */
  peekedKey: string | null
  /** The key of the issue the shared timer runs on, or `null`. */
  timerKey: string | null
  /** The row properties the Display menu chose. */
  properties: readonly RowProperty[]
  /** The widths the user set for them, in pixels. A property with none takes its default. */
  widths: PropertyWidths
  /** A column was resized to `width` pixels, or removed when that is 0. */
  onResize: (property: RowProperty, width: number) => void
  /** Today's local date, for the dates a row shows. */
  today: string
  /** The open blockers of each loaded issue, by key. */
  blocks: ReadonlyMap<string, OpenBlocks>
  /** Called with the next state after a key or a click. */
  onChange: (next: MoveResult) => void
  /** The pointer moved over a row: it becomes the active row, and the Peek stays on its issue. */
  onHover: (id: string) => void
  /** A click on a cell with its own editor, such as the status dot or avatar, made after the row became active. */
  onCell: (issue: Issue, property: CellProperty, cell: HTMLElement) => void
  /** A single click on an issue row's summary, which asks for the summary editor. */
  onEditSummary: (issue: Issue) => void
  /** Lets the Shell scroll a row into view before a cell editor opens on it. */
  control: RefObject<TreeControl | null>
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
  widths,
  onResize,
  today,
  blocks,
  onChange,
  onHover,
  onEditSummary,
  onCell,
  control,
  onAdd,
  onMove,
  progress,
  treeRef,
  empty,
}: IssueTreeProps) {
  /** Where the pointer last was, so a scroll under a still pointer is not a move. */
  const pointer = useRef<Point | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)
  const [width, setWidth] = useState(0)
  const [scrollbar, setScrollbar] = useState(0)
  const anchor = useRef<Anchor | null>(null)
  const ensured = useRef<string | null>(null)
  /** The issue row being dragged, and the sibling it hovers. */
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null)

  const layout = useMemo(() => layoutRows(rows), [rows])
  const indexById = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows])
  const activeIndex = state.activeId === null ? -1 : (indexById.get(state.activeId) ?? -1)
  // The deepest row and the widest extras decide how much room the strip has, so the columns line
  // up whatever a row holds.
  const room = useMemo(() => {
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
    return stripRoom(width - 16, level, extras)
  }, [rows, blocks, progress, timerKey, width])
  // The widths the user set, less what a narrow Tree cannot hold, taken from the trailing column.
  const fitted = useMemo(() => fitWidths(properties, widths, room), [properties, widths, room])
  const showHeader = properties.length > 0 && rows.length > 0
  const pageSize = Math.max(1, Math.floor(height / ROW_HEIGHT))
  const selecting = state.checked.size > 0

  // Takes focus when it first renders, unless the user already put it somewhere.
  useEffect(() => {
    if (document.activeElement === document.body) treeRef.current?.focus()
  }, [treeRef])

  const measure = useCallback(() => {
    const tree = treeRef.current
    if (tree === null) return
    setHeight(tree.clientHeight)
    setWidth(tree.clientWidth)
    // The rows stop short of the scrollbar, so the header must too.
    setScrollbar(tree.offsetWidth - tree.clientWidth)
  }, [treeRef])

  useLayoutEffect(() => {
    const tree = treeRef.current
    if (tree === null) return
    const observer = new ResizeObserver(measure)
    observer.observe(tree)
    return () => {
      observer.disconnect()
    }
  }, [treeRef, measure])

  // A commit elsewhere can resize the Tree (the Peek opening or closing). The observer reports it a
  // frame later, and the columns would sit at their old fit until then, so read it after every
  // commit: a changed width renders again before the browser paints. Unchanged values bail out.
  useLayoutEffect(measure)

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

  // Scrolls a row into view, clear of the bulk bar. A keyboard move does it for the active row, and
  // a cell editor for the row it opens on, so its popover finds the cell where the user can see it.
  const reveal = useCallback(
    (id: string | null) => {
      const tree = treeRef.current
      const index = id === null ? -1 : (indexById.get(id) ?? -1)
      if (tree === null || index < 0) return
      const top = layout.tops[index] ?? 0
      const bottom = layout.tops[index + 1] ?? layout.total
      // The bulk bar covers the foot of the Tree, so a row must clear it to count as in view.
      const inset = selecting ? BAR_CLEARANCE : 0
      if (top < tree.scrollTop) tree.scrollTop = top
      else if (bottom > tree.scrollTop + tree.clientHeight - inset) {
        tree.scrollTop = bottom - tree.clientHeight + inset
      }
      setScrollTop(tree.scrollTop)
    },
    [indexById, layout, selecting, treeRef],
  )
  useImperativeHandle(
    control,
    () => ({
      reveal: (id) => {
        ensured.current = id
        reveal(id)
      },
    }),
    [reveal],
  )

  // A keyboard move scrolls the active row into view. Only a new active row does, so a rebuild
  // never pulls the view back from where the mouse wheel left it.
  useLayoutEffect(() => {
    if (state.activeId === ensured.current) return
    ensured.current = state.activeId
    reveal(state.activeId)
  }, [state.activeId, reveal])

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
    // A field in a row (the estimate) keeps its keys: Arrows, Enter and Space are its own.
    if (event.target instanceof Element && keepsLetters(event.target)) return
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
  const rowIdOf = (event: { target: EventTarget }) =>
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

  /**
   * The pointer moving over a row makes it the active row, the last input winning over the keys:
   * `J` and `K` move the active row from there, and the pointer takes it back when it moves again.
   * A scroll under a still pointer sends the pointer events from the same spot and moves nothing.
   */
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const now = { x: event.clientX, y: event.clientY }
    const moved = pointerMoved(pointer.current, now)
    pointer.current = now
    // A cell editor, picker or menu holds the row it opened on, so the pointer passing over others moves nothing.
    if (!moved || document.querySelector(':popover-open') !== null) return
    // With focus on the page body no letter would reach the Tree, so the pointer over it takes focus there.
    if (document.activeElement === document.body) treeRef.current?.focus({ preventScroll: true })
    const next = hoverRow(rows, state, rowIdOf(event))
    if (next === null) return
    // The row is under the pointer already, so the view must not scroll it into place.
    ensured.current = next
    onHover(next)
  }

  /** A pointer that left the Tree moves again on re-entering, even at the spot it left from. */
  function forgetPointer() {
    pointer.current = null
  }

  const armed = useRef<string | null>(null)
  const onRowClick = useCallback(
    (id: string, onChevron: boolean, select: 'toggle' | 'range' | undefined, detail: number) => {
      // The second click of a double-click on an issue is inert: a header's click may have moved
      // another row under it, and the double-click opens the first click's issue.
      if (detail > 1 && armed.current !== null) return
      // The click also focuses the Tree, the nearest focusable ancestor of the row.
      const next = clickRow(rows, state, id, onChevron, select)
      // A click on blank row space changes nothing, and a stale state must not undo a hover.
      if (next !== state) onChange({ ...next, openPage: false })
    },
    [rows, state, onChange],
  )

  const onRowCell = useCallback(
    (issue: Issue, property: CellProperty, cell: HTMLElement) => {
      // A click on a row clipped at the foot scrolls it into view; do it now, so the scroll is over before the editor opens.
      const id = `i:${issue.key}`
      ensured.current = id
      reveal(id)
      onCell(issue, property, cell)
    },
    [reveal, onCell],
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
  const peekedId = peekedKey === null ? null : `i:${peekedKey}`

  return (
    <div
      data-tree-pane
      style={colVars(properties, fitted)}
      className={`@container relative min-h-0 flex-1 ${rows.length === 0 ? RING : ''}`}
    >
      {showHeader && (
        <ColumnHeader
          properties={properties}
          fitted={fitted}
          room={room}
          scrollbar={scrollbar}
          onResize={onResize}
        />
      )}
      <div
        ref={treeRef}
        role="tree"
        data-key-scope
        aria-label="Issues"
        tabIndex={0}
        aria-activedescendant={activeRow === undefined ? undefined : rowDomId(activeRow.id)}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={forgetPointer}
        onScroll={onScroll}
        onDragStart={onDragStart}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={() => {
          setDrag(null)
        }}
        className={`group absolute inset-0 overflow-y-auto overflow-x-hidden focus-visible:outline-none ${showHeader ? '@tree:top-6' : ''}`}
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
                peeked={row.id === peekedId}
                checked={row.kind === 'issue' && state.checked.has(row.node.issue.key)}
                selecting={selecting}
                timing={row.kind === 'issue' && row.node.issue.key === timerKey}
                dragging={drag?.id === row.id}
                dropEdge={indicator?.id === row.id ? indicator.edge : undefined}
                properties={properties}
                today={today}
                blockedBy={held?.blockedBy.length ?? 0}
                blocking={held?.blocking.length ?? 0}
                onClick={onRowClick}
                onArm={onRowArm}
                onOpen={onRowOpen}
                onEdit={onEditSummary}
                onCell={onRowCell}
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
