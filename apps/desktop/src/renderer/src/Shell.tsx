import { buildHierarchy } from '@jira-mgr/core/hierarchy'
import { issueMatcher, type ViewFilters } from '@jira-mgr/core/view-filter'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import type { Session, Toggles } from '../../shared/ipc'
import { Banner } from './Banner'
import { IssueDetail } from './IssueDetail'
import { IssueTree } from './IssueTree'
import { LoadError } from './LoadError'
import { Sidebar } from './Sidebar'
import { TreeToolbar, activeToggleNames } from './TreeToolbar'
import { filterChoices, hasFilters } from './filters'
import {
  useCustomers,
  useDoneIssues,
  useLoadedCount,
  useMe,
  useSetToggles,
  useToggles,
  useUnresolvedIssues,
} from './queries'
import {
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
    <div className="absolute inset-0 grid place-items-center p-6 text-center">
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
  const treeRef = useRef<HTMLDivElement>(null)
  const peekRef = useRef<HTMLElement>(null)

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
    if (row?.kind === 'issue') setLastIssueKey(row.node.issue.key)
    if (next.focusPeek) peekRef.current?.focus()
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
          <NoMatch
            toggles={toggles}
            filtered={hasFilters(filters)}
            onClear={() => {
              setFilters({})
              focusTree()
            }}
          />
        }
      />
    )
  }

  return (
    <div
      className={`grid h-full ${peekOpen ? 'grid-cols-[14.5rem_minmax(20rem,1fr)_minmax(21rem,26rem)]' : 'grid-cols-[14.5rem_minmax(20rem,1fr)]'}`}
    >
      <Sidebar session={session} count={unresolved.data?.length} />
      <section aria-label="Issue list" className="flex min-h-0 min-w-0 flex-col bg-canvas">
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
          <h1 className="font-semibold">Issues</h1>
          <span role="status" className="text-xs text-muted">
            {unresolved.isFetching && unresolved.data !== undefined ? 'Updating...' : ''}
          </span>
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
          mismatch={peekedNode?.customerMismatch ?? null}
          inView={peekedNode !== undefined}
          onClose={closePeek}
          onEditingChange={(editing) => {
            setEditingKey(editing ? lastIssueKey : null)
          }}
          onLeave={focusTree}
          asideRef={peekRef}
        />
      )}
    </div>
  )
}
