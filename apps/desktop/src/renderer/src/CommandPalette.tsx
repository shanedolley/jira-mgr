import type { Issue } from '@jira-mgr/core'
import { useDeferredValue, useEffect, useId, useState, type KeyboardEvent } from 'react'

import { Modal } from './Modal'
import { StatusDot } from './StatusDot'
import { searchIssues } from './search'

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
 * summary as you type. Arrow keys move, Enter opens the issue's page, Esc closes and focus goes
 * back to where it was. The search runs over memory, so it needs no request and no abort.
 */
export function CommandPalette({ issues, onOpen, onClose, returnFocus }: CommandPaletteProps) {
  const uid = useId()
  const titleId = `${uid}-title`
  const listId = `${uid}-list`
  const optionId = (key: string) => `${uid}-${key}`
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  // Typing stays responsive while a long list of matches catches up.
  const deferred = useDeferredValue(query)
  const { shown, total } = searchIssues(issues, deferred)

  const activeIndex = Math.max(
    0,
    shown.findIndex((i) => i.key === activeKey),
  )
  const active = shown[activeIndex]

  const activeId = active === undefined ? undefined : optionId(active.key)
  useEffect(() => {
    if (activeId !== undefined)
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  function move(step: number) {
    const next = shown[Math.min(shown.length - 1, Math.max(0, activeIndex + step))]
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
        if (active !== undefined && !event.nativeEvent.isComposing) onOpen(active.key)
        break
    }
  }

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
      <input
        autoFocus
        type="text"
        role="combobox"
        aria-label="Search issues by key or summary"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search issues by key or summary"
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
        {shown.map((issue) => (
          <div
            key={issue.key}
            id={optionId(issue.key)}
            role="option"
            aria-selected={issue.key === active?.key}
            onClick={() => {
              onOpen(issue.key)
            }}
            className="flex h-8 cursor-default items-center gap-3 rounded px-3 hover:bg-hover aria-selected:bg-selected"
          >
            <StatusDot status={issue.status} />
            <span className="w-24 shrink-0 font-mono text-xs text-muted">{issue.key}</span>
            <span className="min-w-0 flex-1 truncate">{issue.summary}</span>
            <span className="shrink-0 text-xs text-muted">{issue.status.name}</span>
          </div>
        ))}
      </div>
      <p role="status" className="border-t border-line px-4 py-2 text-xs text-muted">
        {total === 0
          ? 'No issues match'
          : total > shown.length
            ? `Showing ${String(shown.length)} of ${String(total)}. Keep typing to narrow.`
            : `${String(total)} ${total === 1 ? 'issue' : 'issues'}`}
        <span aria-hidden className="float-right">
          Enter opens, Esc closes
        </span>
      </p>
    </Modal>
  )
}
