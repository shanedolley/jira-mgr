import type { Issue } from '@jira-mgr/core'
import { useDeferredValue, useEffect, useId, useState, type KeyboardEvent } from 'react'

import type { SavedView } from '../../shared/ipc'
import { Kbd } from './Kbd'
import { Modal } from './Modal'
import {
  defaultRow,
  matchingActions,
  matchingViews,
  type ActionId,
  type ActionRow,
} from './paletteActions'
import { StatusDot, summaryFade } from './StatusDot'
import { searchIssues, textMatches } from './search'
import { useTextSearch, type TextSearch } from './textSearch'
import { TypeIcon } from './TypeIcon'
import { useViews } from './viewQueries'

interface CommandPaletteProps {
  /** Every loaded issue, Done ones included once they have loaded. */
  issues: readonly Issue[]
  /** The issue the keys act on: the page's, else the Tree's active row. Its actions list first. */
  context: Issue | null
  /** Opens the issue's full page. */
  onOpen: (key: string) => void
  /** Runs one action on the context issue, by the code its picker or key runs. */
  onAction: (id: ActionId, issue: Issue) => void
  /** Applies a saved view, as a click on it in the sidebar does. */
  onView: (view: SavedView) => void
  onClose: () => void
  returnFocus: () => void
}

interface ActionItem {
  kind: 'action'
  rid: string
  action: ActionRow
}
interface ViewItem {
  kind: 'view'
  rid: string
  view: SavedView
}
interface IssueItem {
  kind: 'issue'
  rid: string
  issue: Issue
}
/** A listed row. `rid` names it for the highlight. */
type Row = ActionItem | ViewItem | IssueItem

const issueRow = (issue: Issue): IssueItem => ({ kind: 'issue', rid: issue.key, issue })

/** The action and view rows whose labels fit `query`: the rows above the issues. */
function leadRows(context: Issue | null, views: readonly SavedView[], query: string) {
  const actions = matchingActions(context, query).map((action): ActionItem => ({
    kind: 'action',
    rid: `action:${action.id}`,
    action,
  }))
  const found = matchingViews(views, query).map((view): ViewItem => ({
    kind: 'view',
    rid: `view:${view.id}`,
    view,
  }))
  return { actions, views: found }
}

/**
 * The Cmd+K palette (Q5, Q37): a modal with a combobox. With an issue in context, a chip names it
 * and a group of its actions comes first, each beside the key that runs the same thing; saved
 * views follow. Below them it searches the loaded issues by key and summary as you type, and a
 * "Search text in Jira" group lists the issues whose description, comments or other text hold the
 * query, found by Jira once typing pauses. What you type also narrows the actions and views by
 * label. Arrow keys move through every row, Enter or a click runs the row (an issue opens its
 * page), Esc closes and focus goes back to where it was. The loaded search runs over memory; only
 * the Jira group makes a request.
 */
export function CommandPalette({
  issues,
  context,
  onOpen,
  onAction,
  onView,
  onClose,
  returnFocus,
}: CommandPaletteProps) {
  const uid = useId()
  const titleId = `${uid}-title`
  const listId = `${uid}-list`
  const jiraId = `${uid}-jira`
  const actionsId = `${uid}-actions`
  const viewsId = `${uid}-views`
  const issuesId = `${uid}-issues`
  const chipId = `${uid}-chip`
  const optionId = (rid: string) => `${uid}-${rid}`
  const [query, setQuery] = useState('')
  const [activeRid, setActiveRid] = useState<string | null>(null)
  // Typing stays responsive while a long list of matches catches up.
  const deferred = useDeferredValue(query)
  const { shown, total } = searchIssues(issues, deferred)
  const jira = useTextSearch(query)
  const found = jira.status === 'done' ? textMatches(shown, jira.issues) : []
  const views = useViews().data ?? []
  // Labels are few, so they follow the field itself rather than the deferred value.
  const { actions: actionRows, views: viewRows } = leadRows(context, views, query)
  const lead: Row[] = [...actionRows, ...viewRows]
  const loadedRows = shown.map(issueRow)
  const jiraRows = found.map(issueRow)
  const rows: Row[] = [...lead, ...loadedRows, ...jiraRows]

  // Until an arrow key moves it, the highlight is on the first issue, not the first action.
  const moved = rows.findIndex((row) => row.rid === activeRid)
  const active = moved >= 0 ? rows[moved] : defaultRow<Row>(loadedRows, lead, jiraRows)
  const activeIndex = active === undefined ? 0 : rows.indexOf(active)

  const activeId = active === undefined ? undefined : optionId(active.rid)
  // Only a move scrolls, so the list opens on the actions, above the highlighted first issue.
  const scrolls = activeRid !== null
  useEffect(() => {
    if (scrolls && activeId !== undefined)
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [scrolls, activeId])

  function move(step: number) {
    const next = rows[Math.min(rows.length - 1, Math.max(0, activeIndex + step))]
    if (next !== undefined) setActiveRid(next.rid)
  }

  function choose(row: Row) {
    switch (row.kind) {
      case 'action':
        if (context !== null) onAction(row.action.id, context)
        break
      case 'view':
        onView(row.view)
        break
      case 'issue':
        onOpen(row.issue.key)
        break
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Enter':
        event.preventDefault()
        if (!event.nativeEvent.isComposing) {
          // The issue list lags the field while it is deferred, so Enter reads the current query's
          // top issue, unless an arrow key already chose an action or view, which follow the field.
          const chosen = lead.find((row) => row.rid === activeRid)
          const target =
            deferred === query
              ? active
              : (chosen ??
                defaultRow<Row>(searchIssues(issues, query).shown.map(issueRow), lead, []))
          if (target !== undefined) choose(target)
        }
        break
    }
  }

  const rowProps = (row: Row) => ({
    id: optionId(row.rid),
    role: 'option',
    'aria-selected': row.rid === active?.rid,
    onClick: () => {
      choose(row)
    },
    className:
      'flex h-9 cursor-default items-center gap-3 rounded-lg px-3 hover:bg-hover aria-selected:bg-selected',
  })

  const heading = (id: string, text: string) => (
    <div id={id} className="flex h-9 items-center px-3 text-xs text-muted">
      {text}
    </div>
  )

  const option = (issue: Issue) => (
    <div key={issue.key} {...rowProps(issueRow(issue))}>
      <TypeIcon type={issue.issueType} />
      <StatusDot status={issue.status} />
      <span className="w-24 shrink-0 font-mono text-xs text-muted">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate" style={summaryFade(issue.status)}>
        {issue.summary}
      </span>
      <span className="shrink-0 text-xs text-muted">{issue.status.name}</span>
    </div>
  )

  return (
    <Modal
      titleId={titleId}
      onClose={onClose}
      returnFocus={returnFocus}
      className="w-[min(36rem,calc(100vw-2rem))]"
    >
      <h2 id={titleId} className="sr-only">
        Search issues
      </h2>
      {/* Mounted before the group appears, so a screen reader announces its first state. */}
      <span aria-live="polite" className="sr-only">
        {jiraStatus(jira, found.length)}
      </span>
      <div className="flex items-center gap-2 border-b border-line pl-3">
        {context !== null && (
          <span
            id={chipId}
            title={context.summary}
            className="flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-md border border-line bg-hover px-2 py-0.5 text-xs"
          >
            <TypeIcon type={context.issueType} />
            <span className="shrink-0 font-mono text-muted">{context.key}</span>
            <span className="truncate">{context.summary}</span>
          </span>
        )}
        <input
          autoFocus
          type="text"
          role="combobox"
          aria-label="Search issues by key, summary or text"
          aria-describedby={context === null ? undefined : chipId}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search issues by key, summary or text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveRid(null)
          }}
          onKeyDown={onKeyDown}
          className="h-11 min-w-0 flex-1 bg-transparent pr-4 text-base placeholder:text-muted focus-visible:outline-none"
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label="Issues"
        // Keeps focus in the field, so a click on a result never blurs it.
        onMouseDown={(event) => {
          event.preventDefault()
        }}
        className="max-h-[min(24rem,60vh)] overflow-y-auto p-1"
      >
        {actionRows.length > 0 && (
          <div role="group" aria-labelledby={actionsId}>
            {heading(actionsId, 'Actions')}
            {actionRows.map((row) => (
              <div key={row.rid} {...rowProps(row)} aria-keyshortcuts={row.action.key}>
                <span className="min-w-0 flex-1 truncate">{row.action.label}</span>
                {row.action.key !== undefined && <Kbd aria-hidden>{row.action.key}</Kbd>}
              </div>
            ))}
          </div>
        )}
        {viewRows.length > 0 && (
          <div role="group" aria-labelledby={viewsId}>
            {heading(viewsId, 'Views')}
            {viewRows.map((row) => (
              <div key={row.rid} {...rowProps(row)}>
                <span className="min-w-0 flex-1 truncate">Go to view {row.view.name}</span>
              </div>
            ))}
          </div>
        )}
        {lead.length > 0 && shown.length > 0 ? (
          <div role="group" aria-labelledby={issuesId}>
            {heading(issuesId, 'Issues')}
            {shown.map(option)}
          </div>
        ) : (
          shown.map(option)
        )}
        {jira.status !== 'idle' && (
          <div role="group" aria-labelledby={jiraId} className="mt-1 border-t border-line pt-1">
            <div className="flex h-9 items-center justify-between gap-3 px-3 text-xs text-muted">
              <span id={jiraId}>Search text in Jira</span>
              <span aria-hidden className="truncate">
                {jiraStatus(jira, found.length)}
              </span>
            </div>
            {found.map(option)}
          </div>
        )}
      </div>
      <p role="status" className="border-t border-line px-4 py-2 text-xs text-muted">
        {total === 0
          ? 'No issues match'
          : total > shown.length
            ? `Showing ${String(shown.length)} of ${String(total)}. Keep typing to narrow.`
            : `${String(total)} ${total === 1 ? 'issue' : 'issues'}`}
        <span aria-hidden className="float-right">
          <Kbd>Enter</Kbd> chooses <Kbd>Esc</Kbd> closes
        </span>
      </p>
    </Modal>
  )
}

/** What the Jira group's heading says beside its name. */
function jiraStatus(jira: TextSearch, extra: number): string {
  switch (jira.status) {
    case 'idle':
      return ''
    case 'searching':
      return 'Searching'
    case 'error':
      return `Failed: ${jira.message}`
    case 'done':
      return extra === 0
        ? 'No more matches'
        : `${String(extra)} more ${extra === 1 ? 'match' : 'matches'}`
  }
}
