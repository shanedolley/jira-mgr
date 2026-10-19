import type { Issue } from '@jira-mgr/core'
import type { PropertyWidths, RowProperty } from '@jira-mgr/core/display'
import type { SprintReport } from '@jira-mgr/core/sprints'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { flushSync } from 'react-dom'

import { Avatar } from './Avatar'
import { BulkBar, type BulkBarProps } from './BulkBar'
import type { CellProperty } from './cell'
import { nameFade } from './ColumnHeader'
import { keepsLetters, resolveKey } from './keymap'
import { LoadError } from './LoadError'
import {
  checkAll,
  extendBy,
  NO_SELECTION,
  prune,
  rangeTo,
  togglesCheck,
  type Selection,
} from './multiSelect'
import { STATE_LABELS } from './properties'
import { colVars, colWidth, floorWidths } from './propertyFit'
import { SECTION_HEADING } from './Section'
import { Slot, SLOT } from './Slot'
import { holdFade, StatusDot } from './StatusDot'
import {
  BREAKDOWNS,
  formatDay,
  groupByStatus,
  percentOf,
  shareText,
  type BreakdownId,
  type StatusGroup,
} from './sprintView'
import { useSprintReport } from './sprintQueries'
import { CheckGlyph, PrioritySlot, Properties } from './TreeRow'
import { PROPERTY_LABELS } from './TreeToolbar'
import { clearSelection, pointerMoved, toggleChecked, type Point } from './tree'

/**
 * A slot that turns into a field in place (the estimate and Logged). A click in one is the field's;
 * the Comments slot is a button, so Shift+click and Cmd+click on it check like anywhere on the row.
 */
const FIELD = '[data-edit]:not([data-edit="comments"])'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-line py-3 last:border-b-0">
      <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-1">
      <dt className="truncate px-2 text-muted">{name}</dt>
      <dd className="min-w-0 truncate px-2">{children}</dd>
    </div>
  )
}

/** One number of the progress block: its name, the count and, for started and completed, the share. */
function Count({ name, value, share }: { name: string; value: number; share?: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{name}</dt>
      <dd className="text-[15px] font-semibold">
        {value}{' '}
        {share !== undefined && (
          <span className="ml-1 text-xs font-normal text-muted">{`${String(share)}%`}</span>
        )}
      </dd>
    </div>
  )
}

/** The tabs of the breakdowns. Arrow keys, Home and End move between them and select as they go. */
function Breakdowns({ stats }: { stats: SprintReport['stats'] }) {
  const [selected, setSelected] = useState<BreakdownId>('assignees')
  const tabs = useRef(new Map<BreakdownId, HTMLButtonElement>())

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = BREAKDOWNS.findIndex((tab) => tab.id === selected)
    const to =
      event.key === 'ArrowRight'
        ? (at + 1) % BREAKDOWNS.length
        : event.key === 'ArrowLeft'
          ? (at + BREAKDOWNS.length - 1) % BREAKDOWNS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? BREAKDOWNS.length - 1
              : -1
    const next = BREAKDOWNS[to]
    if (next === undefined) return
    event.preventDefault()
    setSelected(next.id)
    tabs.current.get(next.id)?.focus()
  }

  const groups = stats[selected]
  return (
    <div className="space-y-2 pt-3">
      <div
        role="tablist"
        aria-label="Breakdown"
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1.5"
      >
        {BREAKDOWNS.map((tab) => (
          <button
            key={tab.id}
            ref={(button) => {
              if (button === null) tabs.current.delete(tab.id)
              else tabs.current.set(tab.id, button)
            }}
            type="button"
            role="tab"
            id={`sprint-tab-${tab.id}`}
            aria-selected={selected === tab.id}
            aria-controls="sprint-tabpanel"
            tabIndex={selected === tab.id ? 0 : -1}
            onClick={() => {
              setSelected(tab.id)
            }}
            className={`btn btn-sm ${selected === tab.id ? 'is-current' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="sprint-tabpanel" aria-labelledby={`sprint-tab-${selected}`}>
        {groups.length === 0 ? (
          <p className="px-2 text-muted">Nothing to show.</p>
        ) : (
          <ul>
            {groups.map((group) => (
              <li key={group.id} className="flex min-h-8 items-center gap-2 px-2">
                {selected === 'assignees' && (
                  <Avatar
                    person={
                      group.id === ''
                        ? null
                        : {
                            accountId: group.id,
                            displayName: group.name,
                            avatarUrl: group.avatarUrl ?? null,
                          }
                    }
                  />
                )}
                <span className="min-w-0 flex-1 truncate" title={group.name}>
                  {group.name}
                </span>
                <span className="shrink-0 text-xs text-muted">{shareText(group)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** The right panel: dates, goal, and the counts with their progress bar and breakdown tabs. */
function Panel({ report }: { report: SprintReport }) {
  const { sprint, stats } = report
  const completed = percentOf(stats.completed, stats.scope)
  const started = percentOf(stats.started, stats.scope)
  return (
    <aside
      aria-label="Sprint details"
      className="min-h-0 overflow-y-auto border-l border-line bg-panel px-3 max-stack:min-h-auto max-stack:overflow-y-visible max-stack:border-l-0 max-stack:border-t"
    >
      <Group title="Dates">
        <dl>
          <Field name="Status">{STATE_LABELS[sprint.state]}</Field>
          <Field name="Start">{formatDay(sprint.startDate)}</Field>
          <Field name="End">{formatDay(sprint.endDate)}</Field>
        </dl>
      </Group>
      <Group title="Goal">
        {sprint.goal === null ? (
          <p className="px-2 text-muted">No goal set</p>
        ) : (
          <p className="whitespace-pre-wrap break-words px-2">{sprint.goal}</p>
        )}
      </Group>
      <Group title="Progress">
        <dl className="grid grid-cols-3 gap-2 px-2">
          <Count name="Scope" value={stats.scope} />
          <Count name="Started" value={stats.started} share={started} />
          <Count name="Completed" value={stats.completed} share={completed} />
        </dl>
        <div
          role="progressbar"
          aria-label="Sprint progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completed}
          aria-valuetext={`${String(completed)}% completed, ${String(started)}% started`}
          className="mx-2 mt-3 flex h-2 overflow-hidden rounded-full bg-line"
        >
          <div className="bg-status-done" style={{ width: `${String(completed)}%` }} />
          <div className="bg-status-doing" style={{ width: `${String(started)}%` }} />
        </div>
        <Breakdowns key={sprint.id} stats={stats} />
      </Group>
    </aside>
  )
}

/**
 * What a row leaves right of its property strip, in pixels: the row's `pr-2.5` (10), the avatar (20),
 * the gap before it (12) and the list's border (1).
 */
const AFTER_STRIP = 43

/**
 * The names of the properties above the first status section, at the widths the rows use, each
 * column's separator on its left edge as the Tree's header draws it. The widths are set in the Tree,
 * so this header only names them, at least `MIN_CELL` wide as the cells are. A row whose properties
 * wrap onto a line of their own still ends them under it; one whose properties wrap among themselves (a narrow page) no longer lines up. It is drawn only: the rows name each value themselves.
 */
function ColumnNames({ properties }: { properties: readonly RowProperty[] }) {
  return (
    <div
      aria-hidden
      data-column-names
      style={{ ...nameFade, paddingRight: AFTER_STRIP }}
      className="flex max-w-[64rem] select-none justify-end gap-x-2"
    >
      {properties.map((property) => (
        <div
          key={property}
          data-col={property}
          style={colWidth(property)}
          className="relative shrink-0"
        >
          <span
            title={PROPERTY_LABELS[property]}
            data-col-name={property}
            className="block truncate text-right text-xs leading-6 text-muted"
          >
            {PROPERTY_LABELS[property]}
          </span>
          <span data-col-sep={property} className="absolute inset-y-0 -left-1 w-px bg-line" />
        </div>
      ))}
      {/* Reaches down the sections below: the wrapper in `Issues` is its containing block. */}
      <span aria-hidden data-col-highlight />
    </div>
  )
}

/** The sprint's issues, grouped by status. A double-click on a row opens its page. */
function Issues({
  report,
  groups,
  checked,
  properties,
  showPriority,
  widths,
  today,
  active,
  onOpen,
  onPeek,
  onEditSummary,
  onEditCell,
}: {
  report: SprintReport
  /** The issues by status, in the order a Shift+click range runs. */
  groups: readonly StatusGroup[]
  /** The keys of the checked issues. */
  checked: ReadonlySet<string>
  properties: readonly RowProperty[]
  showPriority: boolean
  widths: PropertyWidths
  today: string
  /** The key of the active row, which the pointer made active last. */
  active: string | null
  onOpen: (key: string) => void
  onPeek: (key: string) => void
  onEditSummary: (issue: Issue) => void
  onEditCell: (issue: Issue, property: CellProperty, cell: HTMLElement) => void
}) {
  const { sprint, issues } = report
  const selecting = checked.size > 0
  return (
    <article className="min-h-0 overflow-y-auto px-8 pb-6 pt-4 text-sm leading-[22px] max-stack:min-h-auto max-stack:overflow-y-visible max-stack:px-4">
      <div
        // A cell here is a button, so a column saved narrower than a click can hit draws at `MIN_CELL`.
        style={colVars(properties, floorWidths(properties, widths))}
        className="space-y-6"
      >
        <div className="max-w-[40rem] space-y-1">
          <h1 className="text-xl font-semibold leading-7">{sprint.name}</h1>
          <p role="status" className="text-muted">
            {issues.length === 1 ? '1 issue' : `${String(issues.length)} issues`}
          </p>
        </div>
        {groups.length === 0 && <p className="text-muted">No issues in this sprint.</p>}
        {groups.length > 0 && (
          <div className="relative space-y-6">
            {properties.length > 0 && <ColumnNames properties={properties} />}
            {groups.map(({ status, issues: inGroup }) => (
              <section key={status.id} aria-label={status.name} className="space-y-1">
                <h2 className={`${SECTION_HEADING} flex max-w-[40rem] items-center gap-2`}>
                  <StatusDot status={status} />
                  {status.name}
                  <span className="font-normal text-muted">{inGroup.length}</span>
                </h2>
                <ul
                  className={`divide-y divide-line rounded-md border border-line ${properties.length === 0 ? 'max-w-[40rem]' : 'max-w-[64rem]'}`}
                >
                  {inGroup.map((issue) => (
                    <li
                      key={issue.key}
                      data-issue-key={issue.key}
                      data-active={issue.key === active}
                      data-checked={checked.has(issue.key) ? 'true' : undefined}
                      className="sprint-row group/row relative data-[active=true]:bg-hover"
                    >
                      {/* The row's target, under the content: a button cannot hold the slots, so they sit beside it. A double-click, or Enter or Space on the button, opens the issue; a single click does nothing. */}
                      <button
                        type="button"
                        data-row
                        aria-label={`${issue.key} ${issue.summary}`}
                        // The property values, which the name leaves out.
                        aria-describedby={
                          properties.length === 0 ? undefined : `props-${issue.key}`
                        }
                        onClick={(event) => {
                          if (event.detail === 0) onOpen(issue.key)
                        }}
                        onDoubleClick={(event) => {
                          // A Shift+click or Cmd+click checks, so its double-click opens nothing.
                          if (!event.shiftKey && !togglesCheck(event)) onOpen(issue.key)
                        }}
                        className="absolute inset-0 text-left"
                      />
                      {/* Ignores the pointer, so a click outside a slot reaches the button under it. Each slot takes it back (Slot). */}
                      <div className="pointer-events-none relative flex min-h-8 items-start gap-x-2.5 py-1 pl-7 pr-2.5">
                        {/* The page reads the click (`onClickCapture`), so this holds no handler. It shows under the pointer, on the active row and, once any row is checked, on every row. */}
                        <Slot
                          data-check
                          role="checkbox"
                          aria-checked={checked.has(issue.key)}
                          aria-label={`Select ${issue.key}`}
                          tabIndex={-1}
                          className={`absolute left-1.5 top-2 flex size-4 items-center justify-center group-hover/row:opacity-100 group-data-[active=true]/row:opacity-100 ${selecting ? 'opacity-100' : 'opacity-0'}`}
                        >
                          <CheckGlyph checked={checked.has(issue.key)} />
                        </Slot>
                        <Slot
                          data-pick="status"
                          title="Change status"
                          aria-label={`Status of ${issue.key}: ${issue.status.name}`}
                          aria-haspopup="listbox"
                          onClick={(event) => {
                            onEditCell(issue, 'status', event.currentTarget)
                          }}
                          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-line"
                        >
                          <StatusDot status={issue.status} />
                        </Slot>
                        {/* `pr-8` holds the avatar's 20px and the 12px gap before it: the avatar sits on the key's line however the rest wraps. */}
                        <span
                          {...holdFade(status)}
                          className="relative flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 pr-8"
                        >
                          {/* A click on the key peeks the issue (#299). It is text that takes a click, not button chrome, so it is a span with a role; the `o` key is the keyboard route. A Shift+click or Cmd+click checks, through `onClickCapture`. */}
                          <span
                            role="button"
                            title="Peek"
                            aria-label={`Peek ${issue.key}`}
                            onClick={() => {
                              onPeek(issue.key)
                            }}
                            onDoubleClick={(event) => {
                              if (!event.shiftKey && !togglesCheck(event)) onOpen(issue.key)
                            }}
                            className={`${SLOT} sprint-key w-20 shrink-0 cursor-pointer font-mono text-xs text-muted`}
                          >
                            {issue.key}
                          </span>
                          <Slot
                            data-summary
                            aria-label={`Edit summary of ${issue.key}`}
                            title="Edit summary"
                            onClick={() => {
                              onEditSummary(issue)
                            }}
                            className={`flex-1 truncate text-left text-muted ${properties.length === 0 ? 'min-w-0' : 'min-w-[10rem]'}`}
                          >
                            {issue.summary}
                          </Slot>
                          {showPriority && (
                            <Slot
                              data-pick="priority"
                              title="Change priority"
                              aria-label={`Priority of ${issue.key}: ${issue.priority?.name ?? 'none'}`}
                              aria-haspopup="listbox"
                              onClick={(event) => {
                                onEditCell(issue, 'priority', event.currentTarget)
                              }}
                              className="-m-0.5 inline-flex shrink-0 rounded p-0.5 hover:outline hover:outline-1 hover:outline-line"
                            >
                              <PrioritySlot priority={issue.priority} />
                            </Slot>
                          )}
                          <Properties
                            id={`props-${issue.key}`}
                            issue={issue}
                            properties={properties}
                            today={today}
                            always
                            onEditCell={onEditCell}
                          />
                          <Slot
                            data-pick="assignee"
                            title="Change assignee"
                            aria-label={`Assignee of ${issue.key}: ${issue.assignee?.displayName ?? 'Unassigned'}`}
                            aria-haspopup="listbox"
                            onClick={(event) => {
                              onEditCell(issue, 'assignee', event.currentTarget)
                            }}
                            className="absolute right-0 top-0.5 -m-0.5 flex rounded-full p-0.5 hover:bg-line"
                          >
                            <Avatar person={issue.assignee} />
                          </Slot>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

interface SprintPageProps {
  sprintId: number
  /** The row properties the Display menu chose, which the Tree shows too. */
  properties: readonly RowProperty[]
  /** False when the Display menu turned the priority slot off. */
  showPriority: boolean
  /** The widths the user set for them in the Tree, which the rows and the header here use. */
  widths: PropertyWidths
  /** Today's local date, which the short dates and the due date's colour read. */
  today: string
  pageRef: RefObject<HTMLElement | null>
  onBack: () => void
  /** Opens the page of one of the sprint's issues. */
  onOpenIssue: (key: string) => void
  /** Opens the Peek on one of the sprint's issues, beside the page. */
  onPeekIssue: (key: string) => void
  /** The Peek is open beside the page, so the first Esc closes it. */
  peekOpen: boolean
  /** Opens the summary editor of one of the sprint's issues. */
  onEditSummary: (issue: Issue) => void
  /** A click on a row's cell button: the cell editor opens the editor of `property` against `cell`. */
  onEditCell: (issue: Issue, property: CellProperty, cell: HTMLElement) => void
  /** What the bulk bar needs beyond the page's own checked issues. */
  bulk: Omit<BulkBarProps, 'checked' | 'onClear'>
  /** How many issues the page has checked, so the Shell can lift its notices above the bar. */
  onCheckedChange: (count: number) => void
}

/**
 * The page of one sprint: its issues by status beside a panel of dates, goal, counts and
 * breakdowns. Completed means the status category is Done. It shows the last copy it read at
 * once and reads again on opening. It holds its own checked set (`X`, `Shift+Up`, `Shift+Down`,
 * `Cmd+A`, the gutter checkbox, `Shift+click`, `Cmd+click`), which Esc clears before it returns to
 * the Tree, and which leaving the page drops.
 */
export function SprintPage({
  sprintId,
  properties,
  showPriority,
  widths,
  today,
  pageRef,
  onBack,
  onOpenIssue,
  onPeekIssue,
  peekOpen,
  onEditSummary,
  onEditCell,
  bulk,
  onCheckedChange,
}: SprintPageProps) {
  const report = useSprintReport(sprintId)
  // The row the pointer last moved over stays active when it leaves, so `o` and `O` keep a target.
  const [active, setActive] = useState<string | null>(null)
  const pointer = useRef<Point | null>(null)

  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  // The rows in page order, across the status sections, which a range runs through.
  const groups = useMemo(() => groupByStatus(report.data?.issues ?? []), [report.data])
  const order = useMemo(() => groups.flatMap((g) => g.issues.map((i) => i.key)), [groups])
  // Only the rows shown stay checked, except while a batch runs: its optimistic changes can take
  // rows off the page that return if Jira refuses them.
  const pruned = bulk.progress === null ? prune(order, selection) : selection
  if (pruned !== selection) setSelection(pruned)
  const { checked } = selection
  useEffect(() => {
    onCheckedChange(checked.size)
    return () => {
      onCheckedChange(0)
    }
  }, [checked.size, onCheckedChange])
  const checkedIssues = useMemo(() => {
    const byKey = new Map((report.data?.issues ?? []).map((i) => [i.key, i]))
    return [...checked].flatMap((key) => byKey.get(key) ?? [])
  }, [report.data, checked])

  function clearChecked() {
    setSelection(clearSelection(selection))
    pageRef.current?.focus()
  }

  /** Makes `key` the active row at once, so a key pressed right after acts on it. */
  function activate(key: string) {
    flushSync(() => {
      setActive(key)
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      // The checked issues go first, as on the Tree.
      if (checked.size > 0) {
        event.preventDefault()
        clearChecked()
        return
      }
      // With the Peek open beside the page, the next Esc is the Peek's: the Shell closes it.
      if (peekOpen) return
      event.preventDefault()
      onBack()
      return
    }
    const modifier = event.metaKey || event.ctrlKey
    const own = event.target instanceof Element && keepsLetters(event.target)
    if (!own && !event.altKey) {
      if (modifier && !event.shiftKey && /^a$/i.test(event.key)) {
        event.preventDefault()
        setSelection(checkAll(order, selection))
        return
      }
      if (!modifier && /^x$/i.test(event.key) && active !== null) {
        event.preventDefault()
        setSelection(toggleChecked(selection, active))
        return
      }
      // Shift with Up or Down moves the active row and checks the rows it crosses.
      if (!modifier && event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault()
        const moved = extendBy(order, selection, active, event.key === 'ArrowDown' ? 1 : -1)
        if (moved === null) return
        setSelection(moved.selection)
        activate(moved.active)
        event.currentTarget
          .querySelector(`[data-issue-key="${moved.active}"]`)
          ?.scrollIntoView({ block: 'nearest' })
        return
      }
    }
    // `o` and `O` act on the active row as on the Tree. The page has no other letter keys.
    const command = resolveKey(
      event.nativeEvent,
      event.target instanceof Element ? event.target : null,
    )
    const found = report.data?.issues.find((i) => i.key === active)
    if (found === undefined || (command !== 'peek' && command !== 'openPage')) return
    event.preventDefault()
    if (command === 'peek') onPeekIssue(found.key)
    else onOpenIssue(found.key)
  }

  /** The key of the issue row `target` is in, or `undefined` outside the rows. */
  const rowKeyOf = (target: EventTarget) =>
    target instanceof Element
      ? target.closest<HTMLElement>('[data-issue-key]')?.dataset.issueKey
      : undefined

  /**
   * A Shift+click checks a range and a Cmd+click (Ctrl off macOS) toggles the issue, wherever on
   * its row they land: the capture phase takes them before a slot opens its editor, so they open
   * nothing. A click on a row's checkbox toggles it, by key or screen reader too. Any other key's
   * click (`detail` 0) is left alone, and so is a click in an open field.
   */
  function onClickCapture(event: MouseEvent<HTMLElement>) {
    const key = rowKeyOf(event.target)
    if (key === undefined) return
    const target = event.target as Element
    const check = target.closest('[data-check]') !== null
    // Enter or Space on a row's button opens the issue, but on the checkbox it toggles.
    if (event.detail === 0 && !check) return
    if (!check && target.closest(FIELD) !== null) return
    const toggle = check || togglesCheck(event)
    if (!toggle && !event.shiftKey) return
    event.stopPropagation()
    activate(key)
    setSelection(toggle ? toggleChecked(selection, key) : rangeTo(order, selection, key, active))
  }

  /** The press of such a click must not select the text it crosses, nor take the focus off the page. */
  function onMouseDown(event: MouseEvent<HTMLElement>) {
    if (!event.shiftKey && !togglesCheck(event)) return
    if (rowKeyOf(event.target) === undefined) return
    if (event.target instanceof Element && event.target.closest(FIELD) !== null) return
    event.preventDefault()
    event.currentTarget.focus()
  }

  /** The pointer moving over a row makes it active. A scroll under a still pointer moves nothing. */
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const now = { x: event.clientX, y: event.clientY }
    const moved = pointerMoved(pointer.current, now)
    pointer.current = now
    if (!moved || document.querySelector(':popover-open') !== null) return
    // With focus on the page body no key would reach the page, so the pointer over it takes focus there.
    if (document.activeElement === document.body) pageRef.current?.focus({ preventScroll: true })
    const row = event.target instanceof Element ? event.target.closest('[data-issue-key]') : null
    const key = row instanceof HTMLElement ? row.dataset.issueKey : undefined
    // Flushed at once, so a key pressed right after the move acts on this row.
    if (key === undefined) return
    flushSync(() => {
      setActive(key)
    })
  }

  return (
    <section
      ref={pageRef}
      tabIndex={-1}
      aria-label="Sprint page"
      data-key-scope
      onKeyDown={onKeyDown}
      onClickCapture={onClickCapture}
      onMouseDown={onMouseDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        pointer.current = null
      }}
      className="relative z-10 grid h-full min-h-0 grid-cols-[minmax(0,1fr)_21rem] grid-rows-[auto_minmax(0,1fr)] bg-canvas focus-visible:outline-none max-stack:grid-cols-[minmax(0,1fr)] max-stack:grid-rows-[auto] max-stack:content-start max-stack:overflow-y-auto"
    >
      <header className="app-drag col-span-2 flex h-10 items-center gap-3 border-b border-line px-4 max-rail:pl-6 max-stack:sticky max-stack:top-0 max-stack:z-10 max-stack:col-span-1 max-stack:bg-canvas">
        <button type="button" onClick={onBack} className="btn btn-sm app-no-drag">
          Back to issues
        </button>
      </header>
      {report.data === undefined ? (
        <div className="col-span-2 max-stack:col-span-1">
          {report.isError ? (
            <LoadError
              what="this sprint"
              error={report.error}
              onRetry={() => void report.refetch()}
            />
          ) : (
            <p role="status" className="p-6 text-muted">
              Loading sprint
            </p>
          )}
        </div>
      ) : (
        <>
          <Issues
            report={report.data}
            groups={groups}
            checked={checked}
            properties={properties}
            showPriority={showPriority}
            widths={widths}
            today={today}
            active={active}
            onOpen={onOpenIssue}
            onPeek={onPeekIssue}
            onEditSummary={onEditSummary}
            onEditCell={onEditCell}
          />
          <Panel report={report.data} />
        </>
      )}
      <BulkBar {...bulk} checked={checkedIssues} onClear={clearChecked} />
    </section>
  )
}
