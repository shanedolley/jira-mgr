import type { Issue } from '@jira-mgr/core'
import { useDeferredValue, useEffect, useId, useState, type KeyboardEvent } from 'react'

import { Kbd } from './Kbd'
import { Modal } from './Modal'
import { StatusDot } from './StatusDot'
import { searchIssues, textMatches } from './search'
import { useTextSearch, type TextSearch } from './textSearch'
import { TypeIcon } from './TypeIcon'

interface CommandPaletteProps {
  /** Every loaded issue, Done ones included once they have loaded. */
  issues: readonly Issue[]
  /** Opens the issue's full page. */
  onOpen: (key: string) => void
  onClose: () => void
  returnFocus: () => void
}

/**
 * The Cmd+K palette (Q5, Q37): a modal with a combobox that searches the loaded issues by key and
 * summary as you type. Below them, a "Search text in Jira" group lists the issues whose
 * description, comments or other text hold the query, found by Jira once typing pauses. Arrow keys
 * move through both lists, Enter opens the issue's page, Esc closes and focus goes back to where
 * it was. The loaded search runs over memory; only the Jira group makes a request.
 */
export function CommandPalette({ issues, onOpen, onClose, returnFocus }: CommandPaletteProps) {
  const uid = useId()
  const titleId = `${uid}-title`
  const listId = `${uid}-list`
  const jiraId = `${uid}-jira`
  const optionId = (key: string) => `${uid}-${key}`
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  // Typing stays responsive while a long list of matches catches up.
  const deferred = useDeferredValue(query)
  const { shown, total } = searchIssues(issues, deferred)
  const jira = useTextSearch(query)
  const found = jira.status === 'done' ? textMatches(shown, jira.issues) : []
  const rows = [...shown, ...found]

  const activeIndex = Math.max(
    0,
    rows.findIndex((i) => i.key === activeKey),
  )
  const active = rows[activeIndex]

  const activeId = active === undefined ? undefined : optionId(active.key)
  useEffect(() => {
    if (activeId !== undefined)
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  function move(step: number) {
    const next = rows[Math.min(rows.length - 1, Math.max(0, activeIndex + step))]
    if (next !== undefined) setActiveKey(next.key)
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
          // The list lags the field while it is deferred, so Enter reads the current query's top result.
          const target = deferred === query ? active : searchIssues(issues, query).shown[0]
          if (target !== undefined) onOpen(target.key)
        }
        break
    }
  }

  const option = (issue: Issue) => (
    <div
      key={issue.key}
      id={optionId(issue.key)}
      role="option"
      aria-selected={issue.key === active?.key}
      onClick={() => {
        onOpen(issue.key)
      }}
      className="flex h-9 cursor-default items-center gap-3 rounded-lg px-3 hover:bg-hover aria-selected:bg-selected"
    >
      <TypeIcon type={issue.issueType} />
      <StatusDot status={issue.status} />
      <span className="w-24 shrink-0 font-mono text-xs text-muted">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate">{issue.summary}</span>
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
      <input
        autoFocus
        type="text"
        role="combobox"
        aria-label="Search issues by key, summary or text"
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
          setActiveKey(null)
        }}
        onKeyDown={onKeyDown}
        className="h-11 w-full border-b border-line bg-transparent px-4 text-base placeholder:text-muted focus-visible:outline-none"
      />
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
        {shown.map(option)}
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
          <Kbd>Enter</Kbd> opens <Kbd>Esc</Kbd> closes
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
