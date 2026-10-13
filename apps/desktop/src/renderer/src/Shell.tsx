import type { Issue } from '@jira-mgr/core'
import {
  buildHierarchy,
  childProgress,
  type CustomerOption,
  type Progress,
} from '@jira-mgr/core/hierarchy'
import { assertTimeable, type RunningTimer } from '@jira-mgr/core/timer-calc'
import {
  applyViewToggles,
  filtersNeedMe,
  issueMatcher,
  openBlocks,
  type ViewFilters,
} from '@jira-mgr/core/view-filter'
import { useQueryClient } from '@tanstack/react-query'
import {
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

import type {
  CreateType,
  DeleteIssueArgs,
  SavedView,
  Session,
  TimerSnapshot,
  Toggles,
  TreeLevel,
} from '../../shared/ipc'
import { issueUrl } from '../../shared/links'
import { Banner } from './Banner'
import { BulkBar } from './BulkBar'
import { copyText } from './clipboard'
import { CommandPalette } from './CommandPalette'
import { CreateIssueDialog } from './CreateIssueDialog'
import { CustomersPage } from './CustomersPage'
import { DeleteIssueDialog } from './DeleteIssueDialog'
import { EpicsPage } from './EpicsPage'
import { InboxPage } from './InboxPage'
import { IssueDetail } from './IssueDetail'
import { IssuePage } from './IssuePage'
import { IssueTree } from './IssueTree'
import { Kbd } from './Kbd'
import { useTreeTop } from './narrow'
import { type OverviewLoad } from './OverviewFrame'
import { unreadCount, useInbox } from './inboxQueries'
import { LoadError } from './LoadError'
import { ShortcutHelp } from './ShortcutHelp'
import { Sidebar } from './Sidebar'
import { SprintPage } from './SprintPage'
import { SprintsList } from './SprintsList'
import { useViews } from './viewQueries'
import { activeView } from './views'
import { TimerDialog } from './TimerDialog'
import { Toast } from './Toast'
import { pushToast, spoken, type ToastItem } from './toasts'
import { pressOf } from './timer'
import { useToday } from './today'
import { useStartTimer, useTimer } from './timerQueries'
import { rowDomId } from './TreeRow'
import { TreeToolbar, activeToggleNames } from './TreeToolbar'
import { ViewsList } from './ViewsList'
import { ViewTabs } from './ViewTabs'
import {
  createContext,
  deleteFailureNotes,
  describeLate,
  type CreateDraft,
  type Notice,
} from './create'
import {
  filterChoices,
  hasFilters,
  noMatchTitle,
  sentence,
  type Choice,
  type FilterField,
} from './filters'
import { PROPERTY_KEYS, resolveKey, type PropertyCommand } from './keymap'
import type { ActionId } from './paletteActions'
import { assignMeOutcome, assigneePatch } from './properties'
import { attemptWith } from './PropertyPickers'
import {
  useBatch,
  useCustomers,
  useDeleteIssue,
  useEditIssue,
  useDoneIssues,
  useLoadedCount,
  useMe,
  useDisplay,
  useSetDisplay,
  useSetTreeLevel,
  useSetToggles,
  useToggles,
  useTreeLevel,
  treeLevelKey,
  useUnresolvedIssues,
} from './queries'
import { NotifyContext, type Notify } from './notify'
import { applyUnaskedRead } from './optimistic'
import { describeEdit, isBatch, reversible, undoStack, type StackEntry } from './undo'
import { useUndo } from './useUndo'
import {
  ancestorIds,
  levelCollapsed,
  changeOverrides,
  withOverrides,
  fallbackRow,
  flattenTree,
  indexNodes,
  issuesShown,
  mergeIssues,
  moveActive,
  pruneChecked,
  type ExpansionOverrides,
  type MoveResult,
  type TreeRow,
  type TreeState,
} from './tree'

/** The pages that list Epics or Customers rather than issues. */
type Overview = 'epics' | 'customers'

/** The "N issues shown" announcement waits this long after a toggle or filter settles. */
const ANNOUNCE_MS = 500

/** The message, once it has held still for `ANNOUNCE_MS`. Empty until the first change. */
function useSettledMessage(message: string): string {
  const [settled, setSettled] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(message)
    }, ANNOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [message])
  return settled
}

/** The empty Tree area. It sits over the Tree, which stays mounted. */
function NoMatch({
  toggles,
  filters,
  choices,
  onClear,
}: {
  toggles: Toggles
  filters: ViewFilters
  choices: Record<FilterField, Choice[]>
  onClear: () => void
}) {
  const on = activeToggleNames(toggles)
  const filtered = hasFilters(filters)
  return (
    <div className="absolute inset-0 grid place-items-center bg-canvas p-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="size-6 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4M8.5 11h5" />
        </svg>
        <p className="text-[15px] font-semibold">{noMatchTitle(filters, choices)}</p>
        {on.length > 0 && (
          <p className="text-muted">
            {sentence(on)} {on.length === 1 ? 'is' : 'are'}
            {filtered ? ' also' : ''} on.
          </p>
        )}
        {filtered && (
          <button type="button" onClick={onClear} className="btn btn-primary mt-1">
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

/** Restarts the 1s flash on `element`. */
function flash(element: Element) {
  element.removeAttribute('data-flash')
  // Reading the layout restarts the animation when the element is flashed again within the second.
  element.getBoundingClientRect()
  element.setAttribute('data-flash', '')
  element.addEventListener(
    'animationend',
    () => {
      element.removeAttribute('data-flash')
    },
    { once: true },
  )
}

/**
 * Flashes the rows of an edit Jira refused: the issue's Tree row, if it is on screen, and the row
 * of each field in the Peek or on the page, if they show that issue.
 */
function flashRows(key: string, fields: readonly string[]) {
  const row = document.getElementById(rowDomId(`i:${key}`))
  if (row !== null) flash(row)
  for (const field of fields) {
    const selector = `[data-issue="${CSS.escape(key)}"] [data-field="${CSS.escape(field)}"]`
    for (const property of document.querySelectorAll(selector)) flash(property)
  }
}

/**
 * Sidebar, Tree and, while it is open, the Peek. The Shell owns the tree state: the filters, the
 * collapsed and revealed sets, the active row and the Peek. The rows derive from the query caches
 * during render, so an edit anywhere shows in the Tree and the Peek alike.
 */
export function Shell({ session }: { session: Session }) {
  const togglesQuery = useToggles()
  const setToggles = useSetToggles()
  const displayQuery = useDisplay()
  const setDisplay = useSetDisplay()
  const levelQuery = useTreeLevel()
  const setLevel = useSetTreeLevel()
  const meQuery = useMe()
  const unresolved = useUnresolvedIssues()
  const done = useDoneIssues(unresolved.data !== undefined)
  const toggles = togglesQuery.data
  const display = displayQuery.data
  const level = levelQuery.data
  const savedViews = useViews().data
  /** The view applied last, so a duplicate of the view the bar matches can be the lit one. */
  const [appliedViewId, setAppliedViewId] = useState<string>()
  // A deleted view's id can come back on a new view, so forget it as soon as it leaves the list.
  if (
    appliedViewId !== undefined &&
    savedViews !== undefined &&
    !savedViews.some((v) => v.id === appliedViewId)
  ) {
    setAppliedViewId(undefined)
  }

  const [filters, setFilters] = useState<ViewFilters>({})
  const deferredFilters = useDeferredValue(filters)
  // The rows opened or closed by hand this session, on top of the stored level.
  const [overrides, setOverrides] = useState<ExpansionOverrides>(() => new Map())
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())
  const [peekOpen, setPeekOpen] = useState(false)
  // The issues checked for a bulk action, by key, and the one a Shift+click range starts from.
  const batch = useBatch()
  const [selection, setSelection] = useState<{
    checked: ReadonlySet<string>
    anchor: string | null
  }>({ checked: new Set(), anchor: null })
  // Enter in the filter asked for the first issue row, which waits for the deferred rows.
  const [enterPending, setEnterPending] = useState(false)
  const [lastIssueKey, setLastIssueKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  // The issue whose full page is open. The Tree stays mounted under it, so its scroll survives.
  const [pageKey, setPageKey] = useState<string | null>(null)
  // The Inbox page, over the Tree like an issue page and under any issue page opened from it.
  const [inboxOpen, setInboxOpen] = useState(false)
  const inboxQuery = useInbox()
  // The Epics table or the Customers page, over the Tree like the Inbox and exclusive with it.
  const [overview, setOverview] = useState<Overview | null>(null)
  // The sprint whose page is open. It covers the Tree like an issue page, which opens above it.
  const [sprintId, setSprintId] = useState<number | null>(null)
  // The create modal, opened by `C` or the New issue button, with the selection it started from
  // and, from the palette's Create sub-issue, the type it starts as.
  const [creating, setCreating] = useState<
    (ReturnType<typeof createContext> & { type?: CreateType }) | null
  >(null)
  // The issue whose delete modal is open, held whole: the lists may not hold it (a Done parent
  // opened from a page before Done loads) or may drop it while the modal is open.
  const [deleting, setDeleting] = useState<Issue | null>(null)
  // The Cmd+K palette (D7).
  const [searching, setSearching] = useState(false)
  // The `?` shortcut list.
  const [helping, setHelping] = useState(false)
  // The stop dialog, or with `to` the switch dialog, over the timer file as it was when `T` opened it.
  const [timing, setTiming] = useState<{
    snapshot: TimerSnapshot & { timer: RunningTimer }
    to: Issue | null
  } | null>(null)
  const timerQuery = useTimer()
  const startTimer = useStartTimer()
  const client = useQueryClient()
  // The last two notices, newest last, and what a screen reader last heard of a plain one.
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [heard, setHeard] = useState('')
  const nextToast = useRef(0)
  const notify = useCallback<Notify>((notice, options = {}) => {
    const { openKey = null, entry, retry, flash } = options
    const id = nextToast.current++
    setToasts((held) => pushToast(held, { id, notice, openKey, entry, retry }))
    // A refusal is an alert and announces itself; the rest go to the one live region below.
    if (!notice.warned) setHeard(spoken(notice))
    if (flash !== undefined) flashRows(flash.key, flash.fields)
  }, [])
  // A created issue to make active once its row exists.
  const [pendingSelect, setPendingSelect] = useState<string | null>(null)
  const deleteIssue = useDeleteIssue()
  const editIssue = useEditIssue()
  const treeRef = useRef<HTMLDivElement>(null)
  const peekRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLElement>(null)
  const pageRef = useRef<HTMLElement>(null)
  const inboxRef = useRef<HTMLElement>(null)
  const sprintRef = useRef<HTMLElement>(null)
  const overviewRef = useRef<HTMLElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  // The Customer list loads for empty Customers in the Tree, and once the Filter menu has opened,
  // for its Customer choices.
  const [filterMenuOpened, setFilterMenuOpened] = useState(false)
  const showEmptyCustomers = toggles?.hideEmptyCustomers === false
  const customersQuery = useCustomers(
    showEmptyCustomers || filterMenuOpened || overview === 'customers',
  )
  // Only the Tree needs the list to place empty Customers, so only then does a failure matter.
  const customersFailed =
    showEmptyCustomers && customersQuery.isError && customersQuery.data === undefined
  const accountId = meQuery.data?.accountId
  const needsMe = toggles?.assigneeMe === true || filtersNeedMe(deferredFilters)
  const treeReady =
    unresolved.data !== undefined &&
    toggles !== undefined &&
    display !== undefined &&
    (!needsMe || accountId !== undefined)

  const issues = useMemo(
    () => (unresolved.data === undefined ? [] : mergeIssues(unresolved.data, done.data ?? [])),
    [unresolved.data, done.data],
  )
  // Read from the loaded issues, so a blocker moved to Done in the app clears its pills at once.
  const blocks = useMemo(() => {
    const byKey = new Map(issues.map((i) => [i.key, i]))
    return new Map(issues.map((i) => [i.key, openBlocks(i, byKey)]))
  }, [issues])
  const doneFailed = done.isError && done.data === undefined
  // Done over total of each parent's children, which Story, Task and Bug rows and the issue page show. With no
  // Done issues to count, a total of the open ones alone would mislead, so the Tree hides them.
  const progress = useMemo(
    () => (doneFailed ? new Map<string, Progress>() : childProgress(issues)),
    [issues, doneFailed],
  )
  const customerNames = useMemo(
    () => customersQuery.data?.map((c) => c.value) ?? [],
    [customersQuery.data],
  )
  const today = useToday()
  const choices = useMemo(() => filterChoices(issues, customerNames), [issues, customerNames])

  const order = display?.order
  // Overdue and the date windows read `today`, so the matcher rebuilds at local midnight.
  const match = useMemo(
    () =>
      treeReady
        ? issueMatcher(deferredFilters, {
            accountId: accountId ?? '',
            issues,
            now: new Date(`${today}T12:00:00`),
          })
        : undefined,
    [treeReady, deferredFilters, accountId, issues, today],
  )
  // Only the filter bar counts: "Assignee: me" is on in daily use, and the level must still apply.
  const filtering = match !== undefined
  const groups = useMemo(() => {
    if (!treeReady) return []
    return buildHierarchy(issues, {
      ...toggles,
      // Without the Customer list, empty Customers stay hidden.
      hideEmptyCustomers: customersFailed || toggles.hideEmptyCustomers,
      accountId: accountId ?? '',
      customers: showEmptyCustomers ? customersQuery.data : undefined,
      order,
      ...(match === undefined ? {} : { match }),
    })
  }, [
    treeReady,
    issues,
    toggles,
    order,
    match,
    accountId,
    customersFailed,
    showEmptyCustomers,
    customersQuery.data,
  ])

  const levelRows = useMemo(
    () => levelCollapsed(groups, level ?? 'stories', filtering),
    [groups, level, filtering],
  )
  const collapsed = useMemo(() => withOverrides(levelRows, overrides), [levelRows, overrides])
  const rows = useMemo(
    () => flattenTree(groups, { collapsed, revealed }),
    [groups, collapsed, revealed],
  )
  const nodes = useMemo(() => indexNodes(groups), [groups])

  // The active row survives a rebuild by falling back to a neighbour (state adjusted in render).
  const [track, setTrack] = useState<{ rows: readonly TreeRow[]; activeId: string | null }>({
    rows: [],
    activeId: null,
  })
  if (track.rows !== rows) {
    setTrack({ rows, activeId: fallbackRow(track.rows, rows, track.activeId) })
  }
  const activeId = track.activeId

  // A created issue becomes the active row. Its ancestors open first when a collapsed group hides it.
  if (pendingSelect !== null && issues.some((i) => i.key === pendingSelect)) {
    setPendingSelect(null)
    const hidden = ancestorIds(groups, revealed, pendingSelect).filter((id) => collapsed.has(id))
    if (hidden.length > 0) {
      setOverrides(
        changeOverrides(
          overrides,
          collapsed,
          new Set([...collapsed].filter((id) => !hidden.includes(id))),
        ),
      )
    }
    if (nodes.has(pendingSelect)) {
      setTrack((t) => ({ ...t, activeId: `i:${pendingSelect}` }))
      setLastIssueKey(pendingSelect)
    }
  }

  // Only the rows shown stay checked: a collapse, a filter or a move out of view drops its issues.
  // Not while a batch runs: its optimistic changes can hide rows that come back if Jira refuses
  // them, and the bar must stay up to show the progress. The batch's end prunes what left.
  const pruned = batch.progress === null ? pruneChecked(rows, selection) : selection
  if (pruned !== selection) setSelection(pruned)
  const { checked, anchor } = selection

  const state = useMemo<TreeState>(
    () => ({ activeId, collapsed, revealed, peekOpen, checked, anchor }),
    [activeId, collapsed, revealed, peekOpen, checked, anchor],
  )

  function apply(next: MoveResult) {
    setEnterPending(false)
    setTrack((t) => ({ ...t, activeId: next.activeId }))
    if (next.level !== undefined) chooseLevel(next.level)
    else if (next.collapsed !== collapsed) {
      setOverrides(changeOverrides(overrides, collapsed, next.collapsed))
    }
    setRevealed(next.revealed)
    setPeekOpen(next.peekOpen)
    setSelection((held) =>
      held.checked === next.checked && held.anchor === next.anchor
        ? held
        : { checked: next.checked, anchor: next.anchor },
    )
    if (!next.peekOpen) setEditingKey(null)
    const row = rows.find((r) => r.id === next.activeId)
    if (row?.kind === 'issue') {
      setLastIssueKey(row.node.issue.key)
      if (next.openPage) setPageKey(row.node.issue.key)
    }
  }

  /**
   * Stores a level and reshapes the Tree to it, dropping the rows opened or closed by hand and,
   * short of Everything, the revealed chips.
   */
  function chooseLevel(next: TreeLevel) {
    setOverrides(new Map())
    if (next !== 'all') setRevealed(new Set())
    if (next === level) return
    // At once, so no render shows the old level between dropping the hand toggles and the write.
    client.setQueryData<TreeLevel>(treeLevelKey, next)
    setLevel.mutate(next)
  }

  /** A level from the Groups menu. Customers also makes the row's Customer header active, as Shift+Left does. */
  function pickLevel(next: TreeLevel) {
    chooseLevel(next)
    if (next !== 'customers') return
    const input = {
      key: 'ArrowLeft',
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }
    const placed = moveActive(rows, state, input, { pageSize: 1 })
    if (placed !== null) setTrack((t) => ({ ...t, activeId: placed.activeId }))
  }

  function focusTree() {
    treeRef.current?.focus()
  }

  /**
   * Enter or Down in the filter: the first issue row becomes active, skipping group headers, and
   * takes focus. With no issue row the first row does. The query stays. The rows follow the
   * filters a render late (`useDeferredValue`), so the choice waits until they match the query.
   */
  function enterTree() {
    setEnterPending(true)
    focusTree()
  }

  if (enterPending && filters === deferredFilters) {
    setEnterPending(false)
    const first = rows.find((r) => r.kind === 'issue') ?? rows[0]
    if (first !== undefined) apply({ ...state, activeId: first.id, openPage: false })
  }

  // Focus follows the page: into it whenever it opens or shows another issue, whose controls
  // replace the last page's, and back to the Tree when it closes.
  const pageOpen = pageKey !== null
  // The list is out of reach under any page.
  const sprintOpen = sprintId !== null
  // The Inbox, a Sprint page and the overviews cover the Tree, so its active row is out of sight and out of play.
  const covered = inboxOpen || sprintOpen || overview !== null
  const listCovered = pageOpen || covered
  const surface = pageOpen
    ? 'page'
    : inboxOpen
      ? 'inbox'
      : sprintOpen
        ? 'sprint'
        : overview !== null
          ? 'overview'
          : 'tree'
  const wasSurface = useRef<typeof surface>('tree')
  useEffect(() => {
    if (surface === 'page') pageRef.current?.focus()
    // The sprint page takes focus when it opens, shows another sprint, or an issue page above it closes.
    else if (surface === 'sprint') sprintRef.current?.focus()
    // The Inbox and the overviews place their own focus, on a row once they have rows.
    else if (wasSurface.current !== surface && surface === 'tree') treeRef.current?.focus()
    wasSurface.current = surface
  }, [surface, pageKey, sprintId])

  /**
   * A view replaces the bar's filters and sets the toggles. The toggles go through the same write
   * as a press on a toggle button, so they stay as the view left them after a restart (Q28: each
   * toggle remembers its last state). A view's display, when it has one, goes the same way. The sidebar stays clickable under an open page, whose Tree
   * is inert, so applying a view closes the page, and focus then returns to the Tree.
   */
  function applyView(view: SavedView) {
    setAppliedViewId(view.id)
    setFilters(view.filters)
    if (toggles !== undefined) setToggles.mutate(applyViewToggles(toggles, view))
    if (view.display !== undefined) setDisplay.mutate(view.display)
    setInboxOpen(false)
    setOverview(null)
    if (pageOpen || sprintOpen) {
      setPageKey(null)
      setSprintId(null)
    } else focusTree()
  }

  /** Opens the Epics table or the Customers page, in place of any issue page, sprint page or the Inbox. */
  function showOverview(next: Overview) {
    setPageKey(null)
    setSprintId(null)
    setInboxOpen(false)
    setOverview(next)
  }

  /** A Customer's row on the Customers page: the Tree, filtered to that Customer alone. */
  function openCustomer(customer: CustomerOption) {
    setAppliedViewId(undefined)
    setFilters({ customer: [customer.value] })
    setOverview(null)
    setPageKey(null)
    focusTree()
  }

  /** Opens a sprint's page, from the sidebar or the issue page's Sprint row, in place of any issue page or the Inbox. */
  function openSprint(id: number) {
    setPageKey(null)
    setInboxOpen(false)
    setOverview(null)
    setSprintId(id)
  }

  /** Opens the page of the issue the palette chose, and makes its row active when the Tree shows it. */
  function openFromPalette(key: string) {
    setSearching(false)
    const row = rows.find((r) => r.kind === 'issue' && r.node.issue.key === key)
    if (row !== undefined) {
      setTrack((t) => ({ ...t, activeId: row.id }))
      setLastIssueKey(key)
    }
    setPageKey(key)
  }

  function closePeek() {
    setPeekOpen(false)
    setEditingKey(null)
    focusTree()
  }

  const peekedKey = editingKey ?? lastIssueKey
  const peekedIssue = useMemo(
    () => (peekedKey === null ? undefined : issues.find((i) => i.key === peekedKey)),
    [issues, peekedKey],
  )
  const peekedNode = peekedKey === null ? undefined : nodes.get(peekedKey)
  // A pinned edit whose issue is gone has no editor left, so it must not hold the Peek.
  if (editingKey !== null && peekedIssue === undefined) setEditingKey(null)

  const canCreate = treeReady && creating === null && deleting === null && timing === null

  function openCreate() {
    if (!canCreate) return
    setCreating(
      pageKey === null
        ? createContext(
            // The Tree is out of sight under the Inbox or a Sprint page, so its active row says nothing of the user's intent.
            covered ? undefined : rows.find((r) => r.id === activeId),
            issues,
          )
        : { selected: issues.find((i) => i.key === pageKey) ?? null, group: null },
    )
  }

  /** The active Tree row's issue, which `S`, `A`, `L`, `P` and `E` act on. A header or chip has none. */
  const activeRow = rows.find((r) => r.id === activeId)
  const activeKey = activeRow?.kind === 'issue' ? activeRow.node.issue.key : null
  /**
   * The issue a command acts on: the open page's, else the active Tree row's, and none while the
   * Inbox, a Sprint page or an overview hides the Tree. The palette, the timer and the letter keys all read it.
   */
  const targetKey = pageKey ?? (covered ? null : activeKey)

  /** Puts focus back where the keyboard was: the open page, the Inbox, a Sprint page or an overview, else the Tree. */
  function restoreFocus() {
    const target = {
      page: pageRef,
      inbox: inboxRef,
      sprint: sprintRef,
      overview: overviewRef,
      tree: treeRef,
    }[surface]
    target.current?.focus()
  }

  /**
   * Clicks a control of `key`: from the Tree, in that issue's Peek (opened if need be, since the
   * Peek holds the same pickers as the page and leaves the list in view); from a page, in the
   * page's own sidebar. The click does not move focus, so when the picker closes the browser hands
   * focus back to where the key was pressed: a pick made from the Tree lets `S`, an arrow, Enter
   * and then `J` flow without the mouse.
   */
  function clickControl(selector: string, key: string) {
    if (pageKey === null) {
      // The Peek must show this issue before its control can be found.
      flushSync(() => {
        setLastIssueKey(key)
        setPeekOpen(true)
      })
    }
    const surface = pageKey === null ? peekRef.current : pageRef.current
    surface?.querySelector<HTMLElement>(selector)?.click()
  }

  /**
   * Opens one property of `key`. The shortcut clicks the control that advertises its key with
   * `aria-keyshortcuts`, so it is the picker the mouse opens and no code is duplicated.
   */
  function openProperty(command: PropertyCommand, key: string) {
    clickControl(`[aria-keyshortcuts="${PROPERTY_KEYS[command]}"]`, key)
  }

  /**
   * `T` on `key`: starts the timer when none runs; otherwise opens the stop dialog (it runs here)
   * or the switch dialog (it runs elsewhere). An Epic has no timer (Q56).
   */
  function pressTimer(key: string) {
    const snapshot = timerQuery.data
    const issue = issues.find((i) => i.key === key)
    if (snapshot === undefined || !canCreate) return
    if (issue === undefined) {
      notify({
        title: `Cannot time ${key}`,
        notes: [
          'It is not in the loaded issues. Wait for the list to finish loading, or open it in Jira.',
        ],
        warned: true,
      })
      return
    }
    try {
      assertTimeable(issue)
    } catch (error) {
      notify({
        title: error instanceof Error ? error.message : String(error),
        notes: [],
        warned: true,
      })
      return
    }
    const { timer } = snapshot
    if (timer === null) {
      startTimer.mutate(
        { key },
        {
          onSuccess: () => {
            notify({ title: `Started the timer on ${key}`, notes: [], warned: false })
          },
          onError: (failure) => {
            notify({
              title: `Could not start the timer on ${key}`,
              notes: [failure.message],
              warned: true,
            })
          },
        },
      )
      return
    }
    setTiming({
      snapshot: { ...snapshot, timer },
      to: pressOf(timer, key) === 'switch' ? issue : null,
    })
  }

  /** `I` on `key`: assigns the issue to the signed-in user, as the Assignee picker's Me does. */
  function assignToMe(key: string) {
    const me = meQuery.data
    const issue = issues.find((i) => i.key === key)
    if (issue === undefined) return
    const outcome = assignMeOutcome(issue, me)
    if (outcome === 'mine') return
    if (me === undefined || outcome === 'wait') {
      notify({
        title: `Cannot assign ${key}`,
        notes: ['Your account has not loaded yet.'],
        warned: true,
      })
      return
    }
    const patch = assigneePatch({
      accountId: me.accountId,
      displayName: me.displayName,
      avatarUrl: me.avatarUrl,
    })
    // The Shell sits above the notice context, so it sends through the helper the pickers' hook wraps.
    attemptWith(notify, client, key, 'Assignee', patch, () =>
      editIssue.mutateAsync({ key, changes: { assignee: me.accountId }, patch }),
    )
  }

  /** `Y`, `U` and the Peek's buttons: puts an issue's key or its Jira link on the clipboard. */
  function copyIssue(key: string, what: 'key' | 'link') {
    const copied = copyText(what === 'key' ? key : issueUrl(session.siteUrl, key))
    const noun = what === 'key' ? 'the key' : 'the link'
    notify(
      copied
        ? { title: `Copied ${noun} of ${key}`, notes: [], warned: false }
        : { title: `Could not copy ${noun} of ${key}`, notes: [], warned: true },
    )
  }

  /**
   * A palette action on `issue`. The palette closes first, so its dialog is gone before a picker
   * opens or a create modal takes focus; each action then runs the code its key or picker runs.
   */
  function runAction(id: ActionId, issue: Issue) {
    flushSync(() => {
      setSearching(false)
    })
    const { key } = issue
    switch (id) {
      case 'assignee':
      case 'status':
      case 'priority':
      case 'labels':
        openProperty(id, key)
        break
      case 'sprint':
        // Only the issue page has a Sprint picker, so the Tree and the Peek open the page first.
        if (pageKey === null)
          flushSync(() => {
            openFromPalette(key)
          })
        pageRef.current?.querySelector<HTMLElement>('[aria-label^="Sprint:"]')?.click()
        break
      case 'assignMe':
        assignToMe(key)
        break
      case 'copyKey':
        copyIssue(key, 'key')
        break
      case 'copyLink':
        copyIssue(key, 'link')
        break
      case 'openInJira':
        window.open(issueUrl(session.siteUrl, key), '_blank', 'noopener,noreferrer')
        break
      case 'subIssue':
        if (canCreate) setCreating({ selected: issue, group: null, type: 'Subtask' })
        break
    }
  }

  /** The sidebar's Stop button: the stop dialog for whatever timer runs. */
  function stopFromSidebar() {
    const snapshot = timerQuery.data
    if (snapshot?.timer == null || !canCreate) return
    setTiming({ snapshot: { ...snapshot, timer: snapshot.timer }, to: null })
  }

  const undo = useUndo((reported) => {
    notify(reported)
  }, batch)

  /** The checked issues, in the order they were checked. A row a running batch hides still counts. */
  const checkedIssues = useMemo(() => {
    const byKey = new Map(issues.map((i) => [i.key, i]))
    return [...checked].flatMap((key) => byKey.get(key) ?? [])
  }, [issues, checked])

  function clearChecked() {
    setSelection({ checked: new Set(), anchor: null })
    focusTree()
  }

  /** Undoes `offered`, or the newest edit, and takes down the toasts that offered it. */
  function runUndo(offered?: StackEntry) {
    const taken = undo(offered)
    if (taken !== undefined) setToasts((held) => held.filter((toast) => toast.entry !== taken))
  }

  // Every global shortcut (D7), asked of `resolveKey` in one place. The Tree's own keys sit on the
  // Tree element and the page's Esc on the page, so both have run, and called `preventDefault`
  // when they acted, before this listener sees the event.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null
    const command = resolveKey(event, target)
    if (command === null) return
    switch (command) {
      case 'palette':
        event.preventDefault()
        setSearching(true)
        return
      case 'help':
        event.preventDefault()
        setHelping(true)
        return
      case 'undo':
        event.preventDefault()
        runUndo()
        return
      case 'create':
        if (!canCreate) return
        event.preventDefault()
        openCreate()
        return
      case 'filter': {
        // The list is inert under an open page, so the field cannot take focus there.
        const field = filterRef.current
        if (field === null || listCovered) return
        event.preventDefault()
        field.focus()
        field.select()
        return
      }
      case 'filterMenu': {
        // The toolbar is inert under any page, so the menu cannot take focus there.
        const menu = document.getElementById('filter-menu')
        if (menu === null || listCovered || menu.matches(':popover-open')) return
        event.preventDefault()
        menu.showPopover()
        menu.querySelector('summary')?.focus()
        return
      }
      case 'timer': {
        const key = targetKey
        if (key === null || !treeReady) return
        event.preventDefault()
        pressTimer(key)
        return
      }
      case 'escape':
        // Focus is on a button, the sidebar or the body, not in the Tree or on the page. The page
        // covers the Peek, so it leaves first; a second Esc closes the Peek.
        if (pageOpen) {
          event.preventDefault()
          setPageKey(null)
        } else if (sprintOpen) {
          event.preventDefault()
          setSprintId(null)
        } else if (overview !== null) {
          event.preventDefault()
          setOverview(null)
        } else if (checked.size > 0 && !inboxOpen) {
          // The checked issues go first, and a second Esc closes the Peek.
          event.preventDefault()
          clearChecked()
        } else if (peekOpen && !inboxOpen) {
          event.preventDefault()
          closePeek()
        }
        return
      default: {
        const key = targetKey
        if (key === null || !treeReady || creating !== null || deleting !== null || timing !== null)
          return
        event.preventDefault()
        if (command === 'assignMe') assignToMe(key)
        else if (command === 'copyKey') copyIssue(key, 'key')
        else if (command === 'copyLink') copyIssue(key, 'link')
        else openProperty(command, key)
      }
    }
  })
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      onKey(event)
    }
    document.addEventListener('keydown', listen)
    return () => {
      document.removeEventListener('keydown', listen)
    }
  }, [])

  // Each accepted field edit says what changed and offers Undo.
  useEffect(
    () =>
      undoStack(client).onPush((entry) => {
        notify(
          {
            title: isBatch(entry) ? entry.title : describeEdit(entry),
            notes: reversible(entry) ? [] : ['This change cannot be undone here.'],
            warned: false,
          },
          reversible(entry) ? { entry } : {},
        )
      }),
    [client, notify],
  )

  // The PSAPAC automation rewrites a new issue after the create's own read-back. Main reads it
  // again later; each create waits here with its form and first notice, and an unknown key (from
  // before a logout) is ignored.
  const created = useRef(new Map<string, { draft: CreateDraft; notice: Notice }>())
  useEffect(
    () =>
      window.jm.onLateRead((read) => {
        const first = created.current.get(read.key)
        if (first === undefined) return
        created.current.delete(read.key)
        applyUnaskedRead(client, read.issue)
        const late = describeLate(first.draft, first.notice, read)
        if (late !== null) notify(late, { openKey: read.key })
      }),
    [client, notify],
  )

  const dismissToast = (id: number) => {
    setToasts((held) => held.filter((toast) => toast.id !== id))
  }

  /** Sends the delete the moment the user confirms; the lists already show it gone. */
  function confirmDelete(args: DeleteIssueArgs) {
    const gone = new Set([args.key, ...(args.deleteSubtasks ? args.subtasks : [])])
    setDeleting(null)
    if (pageKey !== null && gone.has(pageKey)) setPageKey(null)
    if (peekedKey !== null && gone.has(peekedKey)) closePeek()
    deleteIssue.mutate(args, {
      onSuccess: ({ key, deletedSubtasks }) => {
        notify({
          title:
            deletedSubtasks.length === 0
              ? `Deleted ${key}`
              : `Deleted ${key} and ${deletedSubtasks.join(', ')}`,
          notes: [],
          warned: false,
        })
      },
      onError: (failure, _args, rollback) => {
        notify({
          title: `Could not delete ${args.key}`,
          notes: deleteFailureNotes(args.key, failure, (rollback?.removed.length ?? 0) > 0),
          warned: true,
        })
      },
    })
  }

  const unresolvedCount = useLoadedCount('unresolved')
  const doneCount = useLoadedCount('done')
  const doneLoading = done.data === undefined && done.fetchStatus === 'fetching'
  const loadStatus =
    unresolved.data === undefined
      ? 'Loading issues'
      : doneLoading
        ? 'Loading Done issues'
        : done.data === undefined
          ? ''
          : 'All issues loaded'

  const shown = issuesShown(rows)
  const announced = useSettledMessage(`${String(shown)} ${shown === 1 ? 'issue' : 'issues'} shown`)

  const refreshFailed =
    (unresolved.isError && unresolved.data !== undefined) ||
    (done.isError && done.data !== undefined)

  function retryAll() {
    if (unresolved.isError) void unresolved.refetch()
    if (done.isError) void done.refetch()
  }

  let body
  // The empty-Tree panel, with its own Clear filters, shows only over the Tree.
  let emptyPanel = false
  if (toggles === undefined || display === undefined || level === undefined) {
    const failed = [togglesQuery, displayQuery, levelQuery].find((q) => q.isError) ?? togglesQuery
    body = failed.isError ? (
      <LoadError what="your settings" error={failed.error} onRetry={() => void failed.refetch()} />
    ) : (
      <p role="status" className="p-4 text-muted">
        Loading settings
      </p>
    )
  } else if (unresolved.data === undefined) {
    body = unresolved.isError ? (
      <LoadError what="issues" error={unresolved.error} onRetry={() => void unresolved.refetch()} />
    ) : (
      <p className="p-4 text-muted">
        Loading issues<span aria-hidden>: {unresolvedCount}</span>
      </p>
    )
  } else if (needsMe && accountId === undefined) {
    body = meQuery.isError ? (
      <LoadError what="your account" error={meQuery.error} onRetry={() => void meQuery.refetch()} />
    ) : (
      <p className="p-4 text-muted">Loading your account</p>
    )
  } else {
    emptyPanel = shown === 0
    body = (
      <IssueTree
        rows={rows}
        state={state}
        peekedKey={peekOpen ? peekedKey : null}
        timerKey={timerQuery.data?.timer?.issueKey ?? null}
        properties={display.properties}
        today={today}
        blocks={blocks}
        onChange={apply}
        onPick={(key, property) => {
          openProperty(property, key)
        }}
        onAdd={(row) => {
          if (canCreate) setCreating(createContext(row, issues))
        }}
        progress={progress}
        treeRef={treeRef}
        empty={
          shown > 0 ? null : (
            <NoMatch
              toggles={toggles}
              filters={filters}
              choices={choices}
              onClear={() => {
                setFilters({})
                focusTree()
              }}
            />
          )
        }
      />
    )
  }

  // The Tree's two loads, which sit in banners under the inert list, as the overview pages show them.
  const overviewLoad: OverviewLoad = {
    ready: unresolved.data !== undefined,
    error: unresolved.data === undefined && unresolved.isError ? unresolved.error : null,
    onRetry: () => void unresolved.refetch(),
    doneFailed,
    onRetryDone: () => void done.refetch(),
  }

  const treeTop = useTreeTop(listRef, peekOpen)
  const layout = (
    <div
      style={
        treeTop === null
          ? undefined
          : ({ '--peek-top': `${String(treeTop + 8)}px` } as CSSProperties)
      }
      className={`relative grid h-full grid-rows-[minmax(0,1fr)] max-rail:grid-cols-[3rem_minmax(0,1fr)] ${peekOpen ? 'grid-cols-[14.5rem_minmax(20rem,1fr)_minmax(21rem,26rem)]' : 'grid-cols-[14.5rem_minmax(20rem,1fr)]'}`}
    >
      <a
        href="#issue-list"
        onClick={(event) => {
          event.preventDefault()
          restoreFocus()
        }}
        className="app-no-drag absolute left-24 top-1.5 z-50 -translate-y-12 rounded-md border border-line bg-panel px-3 py-1 text-ink focus:translate-y-0"
      >
        Skip to issues
      </a>
      <Sidebar
        session={session}
        count={unresolved.data?.length}
        issuesCurrent={
          !inboxOpen &&
          !sprintOpen &&
          overview === null &&
          activeView(savedViews ?? [], filters, toggles, appliedViewId) === undefined
        }
        unread={inboxQuery.data === undefined ? undefined : unreadCount(inboxQuery.data)}
        inboxOpen={inboxOpen}
        onShowInbox={() => {
          // An issue page, sprint page or overview covers the Inbox, so it closes first, as applying a view does.
          setPageKey(null)
          setSprintId(null)
          setOverview(null)
          setInboxOpen(true)
        }}
        overview={overview}
        onShowOverview={showOverview}
        onShowIssues={() => {
          if (!inboxOpen && !sprintOpen && overview === null) return
          setInboxOpen(false)
          setSprintId(null)
          setOverview(null)
          setPageKey(null)
        }}
        sprints={<SprintsList openId={sprintId} onOpen={openSprint} />}
        views={
          <ViewsList
            filters={filters}
            toggles={toggles}
            display={display}
            applied={appliedViewId}
            onApply={applyView}
            showCurrent={!inboxOpen && !sprintOpen && overview === null}
          />
        }
        onOpenIssue={setPageKey}
        onStopTimer={stopFromSidebar}
      />
      <section
        ref={listRef}
        id="issue-list"
        aria-label="Issue list"
        inert={listCovered}
        className="relative col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col bg-canvas"
      >
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4 max-rail:pl-6">
          <h1 className="font-semibold">Issues</h1>
          <div className="flex items-center gap-3">
            <span role="status" className="text-xs text-muted">
              {unresolved.isFetching && unresolved.data !== undefined ? 'Updating...' : ''}
            </span>
            <button
              type="button"
              aria-keyshortcuts="Shift+?"
              onClick={() => {
                setHelping(true)
              }}
              className="btn btn-sm gap-2"
            >
              Shortcuts
              <Kbd aria-hidden>?</Kbd>
            </button>
            <button
              type="button"
              aria-keyshortcuts="Meta+K"
              onClick={() => {
                setSearching(true)
              }}
              className="btn btn-sm gap-2"
            >
              Search
              <Kbd aria-hidden>⌘K</Kbd>
            </button>
            <button
              type="button"
              disabled={!canCreate}
              aria-keyshortcuts="C"
              onClick={openCreate}
              className="btn btn-sm gap-2"
            >
              New issue
              <Kbd aria-hidden>C</Kbd>
            </button>
          </div>
        </header>
        <ViewTabs filters={filters} toggles={toggles} applied={appliedViewId} onApply={applyView} />
        {toggles !== undefined && display !== undefined && level !== undefined && (
          <TreeToolbar
            toggles={toggles}
            onToggle={(name) => {
              setToggles.mutate({ ...toggles, [name]: !toggles[name] })
            }}
            display={display}
            onDisplay={(next) => {
              setDisplay.mutate(next)
            }}
            filters={filters}
            choices={choices}
            onFilters={setFilters}
            onFilterMenuOpen={() => {
              setFilterMenuOpened(true)
            }}
            level={level}
            onLevel={pickLevel}
            onActed={focusTree}
            onEnterTree={enterTree}
            inputRef={filterRef}
            doneProgress={doneLoading ? `Loading Done issues: ${String(doneCount)}` : null}
            showClear={!emptyPanel}
          />
        )}
        {setToggles.isError && (
          <p role="alert" className="shrink-0 border-b border-line px-4 py-1.5 text-xs text-danger">
            Could not save the toggle. {setToggles.error.message}
          </p>
        )}
        {setDisplay.isError && (
          <p role="alert" className="shrink-0 border-b border-line px-4 py-1.5 text-xs text-danger">
            Could not save the display. {setDisplay.error.message}
          </p>
        )}
        {refreshFailed && <Banner onRetry={retryAll}>Could not refresh.</Banner>}
        {doneFailed && (
          <Banner onRetry={retryAll}>Could not load Done issues. Done counts are hidden.</Banner>
        )}
        {customersFailed && (
          <Banner onRetry={() => void customersQuery.refetch()}>
            Could not load the Customer list, so empty Customers stay hidden.
          </Banner>
        )}
        {body}
        <BulkBar
          checked={checkedIssues}
          all={issues}
          me={meQuery.data}
          progress={batch.progress}
          run={batch.run}
          onNotice={notify}
          onClear={clearChecked}
        />
        <p role="status" className="sr-only">
          {loadStatus}
        </p>
        <p role="status" className="sr-only">
          {announced}
        </p>
      </section>
      {peekOpen && (
        <IssueDetail
          issue={peekedIssue}
          issues={issues}
          blockers={peekedKey === null ? undefined : blocks.get(peekedKey)?.blockedBy}
          me={meQuery.data}
          mismatch={peekedNode?.customerMismatch ?? null}
          inView={peekedNode !== undefined}
          onClose={closePeek}
          onOpenPage={setPageKey}
          onDelete={setDeleting}
          onTimer={pressTimer}
          onCopy={copyIssue}
          onEditingChange={(editing) => {
            setEditingKey(editing ? lastIssueKey : null)
          }}
          onLeave={focusTree}
          inert={listCovered}
          asideRef={peekRef}
        />
      )}
      {inboxOpen && (
        <div className="[grid-column:2/-1] row-start-1 min-h-0">
          <InboxPage front={!pageOpen} onOpen={setPageKey} pageRef={inboxRef} />
        </div>
      )}
      {sprintId !== null && (
        <div inert={pageOpen} className="[grid-column:2/-1] row-start-1 min-h-0">
          <SprintPage
            sprintId={sprintId}
            pageRef={sprintRef}
            onBack={() => {
              setSprintId(null)
            }}
            onOpenIssue={setPageKey}
          />
        </div>
      )}
      {overview !== null && (
        <div inert={pageOpen} className="[grid-column:2/-1] row-start-1 min-h-0">
          {overview === 'epics' ? (
            <EpicsPage
              issues={issues}
              progress={progress}
              today={today}
              doneLoading={doneLoading}
              load={overviewLoad}
              front={!pageOpen}
              pageRef={overviewRef}
              onBack={() => {
                setOverview(null)
              }}
              onOpen={setPageKey}
            />
          ) : (
            <CustomersPage
              issues={issues}
              customers={customersQuery.data}
              customersFailed={customersQuery.isError && customersQuery.data === undefined}
              doneLoading={doneLoading}
              load={overviewLoad}
              front={!pageOpen}
              pageRef={overviewRef}
              onBack={() => {
                setOverview(null)
              }}
              onOpen={openCustomer}
              onRetry={() => void customersQuery.refetch()}
            />
          )}
        </div>
      )}
      {pageKey !== null && (
        <div className="[grid-column:2/-1] row-start-1 min-h-0">
          <IssuePage
            issueKey={pageKey}
            issues={issues}
            progress={progress}
            me={meQuery.data}
            mismatch={nodes.get(pageKey)?.customerMismatch ?? null}
            onBack={() => {
              setPageKey(null)
            }}
            onOpen={setPageKey}
            onOpenSprint={openSprint}
            onDelete={setDeleting}
            pageRef={pageRef}
            onNotice={notify}
            onTimer={pressTimer}
          />
        </div>
      )}
      {creating !== null && (
        <CreateIssueDialog
          selected={creating.selected}
          group={creating.group}
          type={creating.type}
          issues={issues}
          me={meQuery.data}
          onClose={() => {
            setCreating(null)
          }}
          onCreating={(result, first, draft) => {
            // Registered now, not when the uploads end: Jira's automation lands after about 10 s.
            created.current.set(result.key, { draft, notice: first })
          }}
          onCreated={(result, first, more, failedFiles) => {
            if (!more) setCreating(null)
            setPendingSelect(result.issue === null ? null : result.key)
            // With "Create more" the next create overwrites the line in the modal, so a file that failed to attach also takes a toast.
            if (!more || failedFiles) {
              notify(first, result.issue === null ? {} : { openKey: result.key })
            }
          }}
          returnFocus={restoreFocus}
        />
      )}
      {deleting !== null && (
        <DeleteIssueDialog
          issue={deleting}
          issues={issues}
          onCancel={() => {
            setDeleting(null)
          }}
          onConfirm={confirmDelete}
          returnFocus={restoreFocus}
        />
      )}
      {timing !== null && (
        <TimerDialog
          snapshot={timing.snapshot}
          to={timing.to}
          onClose={() => {
            setTiming(null)
          }}
          onDone={(reported) => {
            setTiming(null)
            notify(reported)
          }}
          returnFocus={restoreFocus}
        />
      )}
      {searching && (
        <CommandPalette
          issues={issues}
          context={issues.find((i) => i.key === targetKey) ?? null}
          onOpen={openFromPalette}
          onAction={runAction}
          onView={(view) => {
            setSearching(false)
            applyView(view)
          }}
          onClose={() => {
            setSearching(false)
          }}
          returnFocus={restoreFocus}
        />
      )}
      {helping && (
        <ShortcutHelp
          onClose={() => {
            setHelping(false)
          }}
          returnFocus={restoreFocus}
        />
      )}
      <p role="status" aria-label="Notice" className="sr-only">
        {heard}
      </p>
      {toasts.length > 0 && (
        <ul
          aria-label="Notices"
          className={`fixed ${checked.size > 0 ? 'bottom-[4.5rem]' : 'bottom-4'} left-[15.5rem] z-50 flex w-max max-w-[min(28rem,calc(100vw-16.5rem))] flex-col gap-2 max-rail:left-16 max-rail:max-w-[min(28rem,calc(100vw-5rem))]`}
        >
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              notice={toast.notice}
              onUndo={
                toast.entry === undefined
                  ? undefined
                  : () => {
                      runUndo(toast.entry)
                      restoreFocus()
                    }
              }
              onRetry={
                toast.retry === undefined
                  ? undefined
                  : () => {
                      toast.retry?.()
                      dismissToast(toast.id)
                      restoreFocus()
                    }
              }
              onOpen={
                toast.openKey === null
                  ? undefined
                  : () => {
                      setPageKey(toast.openKey)
                      dismissToast(toast.id)
                    }
              }
              onDismiss={() => {
                dismissToast(toast.id)
              }}
              onDismissClick={() => {
                dismissToast(toast.id)
                restoreFocus()
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )

  return <NotifyContext value={notify}>{layout}</NotifyContext>
}
