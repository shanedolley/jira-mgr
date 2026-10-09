import type { Issue } from '@jira-mgr/core'
import { buildHierarchy } from '@jira-mgr/core/hierarchy'
import { applyViewToggles, issueMatcher, type ViewFilters } from '@jira-mgr/core/view-filter'
import { useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

import type { DeleteIssueArgs, SavedView, Session, Toggles } from '../../shared/ipc'
import { Banner } from './Banner'
import { CommandPalette } from './CommandPalette'
import { CreateIssueDialog } from './CreateIssueDialog'
import { DeleteIssueDialog } from './DeleteIssueDialog'
import { IssueDetail } from './IssueDetail'
import { IssuePage } from './IssuePage'
import { IssueTree } from './IssueTree'
import { LoadError } from './LoadError'
import { Sidebar } from './Sidebar'
import { Toast } from './Toast'
import { TreeToolbar, activeToggleNames } from './TreeToolbar'
import { ViewsList } from './ViewsList'
import { createContext, deleteFailureNotes, type Notice } from './create'
import { filterChoices, hasFilters } from './filters'
import { PROPERTY_KEYS, resolveKey, type PropertyCommand } from './keymap'
import {
  useCustomers,
  useDeleteIssue,
  useDoneIssues,
  useLoadedCount,
  useMe,
  useSetToggles,
  useToggles,
  useUnresolvedIssues,
} from './queries'
import { describeEdit, undoStack } from './undo'
import { useUndo } from './useUndo'
import {
  ancestorIds,
  expandableIds,
  fallbackRow,
  flattenTree,
  indexNodes,
  issuesShown,
  mergeIssues,
  moveActive,
  type MoveResult,
  type TreeRow,
  type TreeState,
} from './tree'

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

const sentence = (names: string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

/** The empty Tree area. It sits over the Tree, which stays mounted. */
function NoMatch({
  toggles,
  filtered,
  onClear,
}: {
  toggles: Toggles
  filtered: boolean
  onClear: () => void
}) {
  const on = activeToggleNames(toggles)
  return (
    <div className="absolute inset-0 grid place-items-center bg-canvas p-6 text-center">
      <div className="space-y-2">
        <p className="font-medium">No issues match</p>
        {on.length > 0 && (
          <p className="text-muted">
            {sentence(on)} {on.length === 1 ? 'is' : 'are'} on.
          </p>
        )}
        {filtered && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-line px-3 py-1 hover:bg-hover"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Sidebar, Tree and, while it is open, the Peek. The Shell owns the tree state: the filters, the
 * collapsed and revealed sets, the active row and the Peek. The rows derive from the query caches
 * during render, so an edit anywhere shows in the Tree and the Peek alike.
 */
export function Shell({ session }: { session: Session }) {
  const togglesQuery = useToggles()
  const setToggles = useSetToggles()
  const meQuery = useMe()
  const unresolved = useUnresolvedIssues()
  const done = useDoneIssues(unresolved.data !== undefined)
  const toggles = togglesQuery.data

  const [filters, setFilters] = useState<ViewFilters>({})
  const deferredFilters = useDeferredValue(filters)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())
  const [peekOpen, setPeekOpen] = useState(false)
  const [lastIssueKey, setLastIssueKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  // The issue whose full page is open. The Tree stays mounted under it, so its scroll survives.
  const [pageKey, setPageKey] = useState<string | null>(null)
  // The create modal, opened by `C` or the New issue button, with the selection it started from.
  const [creating, setCreating] = useState<ReturnType<typeof createContext> | null>(null)
  // The issue whose delete modal is open, held whole: the lists may not hold it (a Done parent
  // opened from a page before Done loads) or may drop it while the modal is open.
  const [deleting, setDeleting] = useState<Issue | null>(null)
  // The Cmd+K palette (D7).
  const [searching, setSearching] = useState(false)
  // `undoable` puts an Undo button on a field edit's toast.
  const [notice, setNotice] = useState<{
    notice: Notice
    openKey: string | null
    undoable?: boolean
  } | null>(null)
  // A created issue to make active once its row exists.
  const [pendingSelect, setPendingSelect] = useState<string | null>(null)
  const deleteIssue = useDeleteIssue()
  const treeRef = useRef<HTMLDivElement>(null)
  const peekRef = useRef<HTMLElement>(null)
  const pageRef = useRef<HTMLElement>(null)

  const customersQuery = useCustomers(toggles?.hideEmptyCustomers === false)
  const customersFailed = customersQuery.isError && customersQuery.data === undefined
  const accountId = meQuery.data?.accountId
  const needsMe =
    toggles?.assigneeMe === true ||
    (deferredFilters.assignee ?? []).some((v) => v.toLowerCase() === 'me')
  const treeReady =
    unresolved.data !== undefined && toggles !== undefined && (!needsMe || accountId !== undefined)

  const issues = useMemo(
    () => (unresolved.data === undefined ? [] : mergeIssues(unresolved.data, done.data ?? [])),
    [unresolved.data, done.data],
  )
  const choices = useMemo(() => filterChoices(issues), [issues])

  const groups = useMemo(() => {
    if (!treeReady) return []
    const match = issueMatcher(deferredFilters, { accountId: accountId ?? '' })
    return buildHierarchy(issues, {
      ...toggles,
      // Without the Customer list, empty Customers stay hidden.
      hideEmptyCustomers: customersFailed || toggles.hideEmptyCustomers,
      accountId: accountId ?? '',
      customers: customersQuery.data,
      ...(match === undefined ? {} : { match }),
    })
  }, [treeReady, issues, toggles, deferredFilters, accountId, customersFailed, customersQuery.data])

  const rows = useMemo(
    () => flattenTree(groups, { collapsed, revealed }),
    [groups, collapsed, revealed],
  )
  const expandable = useMemo(() => expandableIds(groups), [groups])
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
    if (hidden.length > 0)
      setCollapsed(new Set([...collapsed].filter((id) => !hidden.includes(id))))
    if (nodes.has(pendingSelect)) {
      setTrack((t) => ({ ...t, activeId: `i:${pendingSelect}` }))
      setLastIssueKey(pendingSelect)
    }
  }

  const state = useMemo<TreeState>(
    () => ({ activeId, collapsed, revealed, peekOpen }),
    [activeId, collapsed, revealed, peekOpen],
  )

  function apply(next: MoveResult) {
    setTrack((t) => ({ ...t, activeId: next.activeId }))
    setCollapsed(next.collapsed)
    setRevealed(next.revealed)
    setPeekOpen(next.peekOpen)
    if (!next.peekOpen) setEditingKey(null)
    const row = rows.find((r) => r.id === next.activeId)
    if (row?.kind === 'issue') {
      setLastIssueKey(row.node.issue.key)
      if (next.openPage) setPageKey(row.node.issue.key)
    }
  }

  function focusTree() {
    treeRef.current?.focus()
  }

  /** Collapse all and Expand all are the Shift+Arrow keys, so the menu and the keys agree. */
  function groupsKey(key: 'ArrowLeft' | 'ArrowRight') {
    const input = { key, shiftKey: true, metaKey: false, ctrlKey: false, altKey: false }
    const next = moveActive(rows, state, input, { pageSize: 1, expandable })
    if (next !== null) apply(next)
  }

  // Focus follows the page: into it whenever it opens or shows another issue, whose controls
  // replace the last page's, and back to the Tree when it closes.
  const pageOpen = pageKey !== null
  const wasPageOpen = useRef(false)
  useEffect(() => {
    if (pageKey !== null) pageRef.current?.focus()
    else if (wasPageOpen.current) treeRef.current?.focus()
    wasPageOpen.current = pageKey !== null
  }, [pageKey])

  /**
   * A view replaces the bar's filters and sets the toggles. The toggles go through the same write
   * as a press on a toggle button, so they stay as the view left them after a restart (Q28: each
   * toggle remembers its last state). The sidebar stays clickable under an open page, whose Tree
   * is inert, so applying a view closes the page, and focus then returns to the Tree.
   */
  function applyView(view: SavedView) {
    setFilters(view.filters)
    if (toggles !== undefined) setToggles.mutate(applyViewToggles(toggles, view))
    if (pageOpen) setPageKey(null)
    else focusTree()
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

  const canCreate = treeReady && creating === null && deleting === null

  function openCreate() {
    if (!canCreate) return
    setCreating(
      pageKey === null
        ? createContext(
            rows.find((r) => r.id === activeId),
            issues,
          )
        : { selected: issues.find((i) => i.key === pageKey) ?? null, group: null },
    )
  }

  /** The active Tree row's issue, which `S`, `A`, `L`, `P` and `E` act on. A header or chip has none. */
  const activeRow = rows.find((r) => r.id === activeId)
  const activeKey = activeRow?.kind === 'issue' ? activeRow.node.issue.key : null

  /** Puts focus back where the keyboard was: the page when one is open, else the Tree. */
  function restoreFocus() {
    if (pageKey !== null) pageRef.current?.focus()
    else focusTree()
  }

  /**
   * Opens one property of `key`: from the Tree, that issue's Peek (opened if need be, since the
   * Peek holds the same pickers as the page and leaves the list in view); from a page, the page's
   * own sidebar. The shortcut clicks the control that advertises its key with `aria-keyshortcuts`,
   * so it is the picker the mouse opens and no code is duplicated. The click does not move focus,
   * so when the picker closes the browser hands focus back to where the key was pressed: a pick
   * made from the Tree lets `S`, an arrow, Enter and then `J` flow without the mouse.
   */
  function openProperty(command: PropertyCommand, key: string) {
    if (pageKey === null) {
      // The Peek must show this issue before its control can be found.
      flushSync(() => {
        setLastIssueKey(key)
        setPeekOpen(true)
      })
    }
    const surface = pageKey === null ? peekRef.current : pageRef.current
    surface?.querySelector<HTMLElement>(`[aria-keyshortcuts="${PROPERTY_KEYS[command]}"]`)?.click()
  }

  const undo = useUndo((reported) => {
    setNotice({ notice: reported, openKey: null })
  })

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
      case 'undo':
        event.preventDefault()
        undo()
        return
      case 'create':
        if (!canCreate) return
        event.preventDefault()
        openCreate()
        return
      case 'escape':
        // Focus is on a button, the sidebar or the body, not in the Tree or on the page. The page
        // covers the Peek, so it leaves first; a second Esc closes the Peek.
        if (pageOpen) {
          event.preventDefault()
          setPageKey(null)
        } else if (peekOpen) {
          event.preventDefault()
          closePeek()
        }
        return
      default: {
        const key = pageKey ?? activeKey
        if (key === null || !treeReady || creating !== null || deleting !== null) return
        event.preventDefault()
        openProperty(command, key)
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

  // Each accepted field edit says what changed and offers Undo. It stays an ordinary notice, so a
  // create's or delete's toast and an edit's replace one another.
  const client = useQueryClient()
  useEffect(
    () =>
      undoStack(client).onPush((entry) => {
        setNotice({
          notice: {
            title: describeEdit(entry),
            notes: entry.reversal === null ? ['This change cannot be undone here.'] : [],
            warned: false,
          },
          openKey: null,
          undoable: entry.reversal !== null,
        })
      }),
    [client],
  )

  const dismissNotice = useCallback(() => {
    setNotice(null)
  }, [])

  /** Sends the delete the moment the user confirms; the lists already show it gone. */
  function confirmDelete(args: DeleteIssueArgs) {
    const gone = new Set([args.key, ...(args.deleteSubtasks ? args.subtasks : [])])
    setDeleting(null)
    if (pageKey !== null && gone.has(pageKey)) setPageKey(null)
    if (peekedKey !== null && gone.has(peekedKey)) closePeek()
    deleteIssue.mutate(args, {
      onSuccess: ({ key, deletedSubtasks }) => {
        setNotice({
          notice: {
            title:
              deletedSubtasks.length === 0
                ? `Deleted ${key}`
                : `Deleted ${key} and ${deletedSubtasks.join(', ')}`,
            notes: [],
            warned: false,
          },
          openKey: null,
        })
      },
      onError: (failure, _args, rollback) => {
        setNotice({
          notice: {
            title: `Could not delete ${args.key}`,
            notes: deleteFailureNotes(args.key, failure, (rollback?.removed.length ?? 0) > 0),
            warned: true,
          },
          openKey: null,
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
  const doneFailed = done.isError && done.data === undefined

  function retryAll() {
    if (unresolved.isError) void unresolved.refetch()
    if (done.isError) void done.refetch()
  }

  let body
  if (toggles === undefined) {
    body = togglesQuery.isError ? (
      <LoadError error={togglesQuery.error} onRetry={() => void togglesQuery.refetch()} />
    ) : (
      <p role="status" className="p-4 text-muted">
        Loading settings
      </p>
    )
  } else if (unresolved.data === undefined) {
    body = unresolved.isError ? (
      <LoadError error={unresolved.error} onRetry={() => void unresolved.refetch()} />
    ) : (
      <p className="p-4 text-muted">
        Loading issues<span aria-hidden>: {unresolvedCount}</span>
      </p>
    )
  } else if (needsMe && accountId === undefined) {
    body = meQuery.isError ? (
      <LoadError error={meQuery.error} onRetry={() => void meQuery.refetch()} />
    ) : (
      <p className="p-4 text-muted">Loading your account</p>
    )
  } else {
    body = (
      <IssueTree
        rows={rows}
        state={state}
        peekedKey={peekOpen ? peekedKey : null}
        expandable={expandable}
        onChange={apply}
        treeRef={treeRef}
        empty={
          shown > 0 ? null : (
            <NoMatch
              toggles={toggles}
              filtered={hasFilters(filters)}
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

  return (
    <div
      className={`relative grid h-full grid-rows-[minmax(0,1fr)] ${peekOpen ? 'grid-cols-[14.5rem_minmax(20rem,1fr)_minmax(21rem,26rem)]' : 'grid-cols-[14.5rem_minmax(20rem,1fr)]'}`}
    >
      <Sidebar
        session={session}
        count={unresolved.data?.length}
        views={<ViewsList filters={filters} toggles={toggles} onApply={applyView} />}
      />
      <section
        aria-label="Issue list"
        inert={pageOpen}
        className="col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col bg-canvas"
      >
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
          <h1 className="font-semibold">Issues</h1>
          <div className="flex items-center gap-3">
            <span role="status" className="text-xs text-muted">
              {unresolved.isFetching && unresolved.data !== undefined ? 'Updating...' : ''}
            </span>
            <button
              type="button"
              aria-keyshortcuts="Meta+K"
              onClick={() => {
                setSearching(true)
              }}
              className="flex items-center gap-2 rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover"
            >
              Search
              <kbd aria-hidden className="font-mono text-muted">
                Cmd K
              </kbd>
            </button>
            <button
              type="button"
              disabled={!canCreate}
              aria-keyshortcuts="C"
              onClick={openCreate}
              className="flex items-center gap-2 rounded-md border border-line px-2 py-0.5 text-xs hover:bg-hover disabled:opacity-50"
            >
              New issue
              <kbd aria-hidden className="font-mono text-muted">
                C
              </kbd>
            </button>
          </div>
        </header>
        {toggles !== undefined && (
          <TreeToolbar
            toggles={toggles}
            onToggle={(name) => {
              setToggles.mutate({ ...toggles, [name]: !toggles[name] })
            }}
            filters={filters}
            choices={choices}
            onFilters={setFilters}
            onCollapseAll={() => {
              groupsKey('ArrowLeft')
            }}
            onExpandAll={() => {
              groupsKey('ArrowRight')
            }}
            onActed={focusTree}
            doneProgress={doneLoading ? `Loading Done issues: ${String(doneCount)}` : null}
          />
        )}
        {setToggles.isError && (
          <p role="alert" className="shrink-0 border-b border-line px-4 py-1.5 text-xs text-danger">
            Could not save the toggle. {setToggles.error.message}
          </p>
        )}
        {refreshFailed && <Banner onRetry={retryAll}>Could not refresh.</Banner>}
        {doneFailed && (
          <Banner onRetry={retryAll}>
            {'Could not load Done issues, so the "N done" chips are unavailable.'}
          </Banner>
        )}
        {customersFailed && (
          <Banner onRetry={() => void customersQuery.refetch()}>
            Could not load the Customer list, so empty Customers stay hidden.
          </Banner>
        )}
        {body}
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
          me={meQuery.data}
          mismatch={peekedNode?.customerMismatch ?? null}
          inView={peekedNode !== undefined}
          onClose={closePeek}
          onOpenPage={setPageKey}
          onDelete={setDeleting}
          onEditingChange={(editing) => {
            setEditingKey(editing ? lastIssueKey : null)
          }}
          onLeave={focusTree}
          inert={pageOpen}
          asideRef={peekRef}
        />
      )}
      {pageKey !== null && (
        <div className="[grid-column:2/-1] row-start-1 min-h-0">
          <IssuePage
            issueKey={pageKey}
            issues={issues}
            me={meQuery.data}
            mismatch={nodes.get(pageKey)?.customerMismatch ?? null}
            onBack={() => {
              setPageKey(null)
            }}
            onOpen={setPageKey}
            onDelete={setDeleting}
            pageRef={pageRef}
            onNotice={(reported) => {
              setNotice({ notice: reported, openKey: null })
            }}
          />
        </div>
      )}
      {creating !== null && (
        <CreateIssueDialog
          selected={creating.selected}
          group={creating.group}
          issues={issues}
          me={meQuery.data}
          onClose={() => {
            setCreating(null)
          }}
          onCreated={(result, created, more) => {
            if (!more) setCreating(null)
            setPendingSelect(result.issue === null ? null : result.key)
            if (!more)
              setNotice({ notice: created, openKey: result.issue === null ? null : result.key })
          }}
          returnFocus={focusTree}
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
          returnFocus={focusTree}
        />
      )}
      {searching && (
        <CommandPalette
          issues={issues}
          onOpen={openFromPalette}
          onClose={() => {
            setSearching(false)
          }}
          returnFocus={restoreFocus}
        />
      )}
      {notice !== null && (
        <Toast
          notice={notice.notice}
          onUndo={
            notice.undoable === true
              ? () => {
                  undo()
                  restoreFocus()
                }
              : undefined
          }
          onOpen={
            notice.openKey === null
              ? undefined
              : () => {
                  setPageKey(notice.openKey)
                  setNotice(null)
                }
          }
          onDismiss={dismissNotice}
        />
      )}
    </div>
  )
}
