import type { ViewFilters } from '@jira-mgr/core/view-filter'
import type { KeyboardEvent, ReactNode, RefObject, ToggleEvent } from 'react'

import type { Toggles } from '../../shared/ipc'
import {
  FIELD_LABELS,
  FILTER_FIELDS,
  filterChips,
  hasFilters,
  toggleChoice,
  withText,
  clearField,
  type Choice,
  type FilterField,
} from './filters'

const TOGGLE_LABELS: Record<keyof Toggles, string> = {
  hideDone: 'Hide done',
  assigneeMe: 'Assignee: me',
  hideEmptyCustomers: 'Hide empty Customers',
}

/** The names of the toggles that are on, for the "No issues match" message. */
export function activeToggleNames(toggles: Toggles): string[] {
  return (Object.keys(TOGGLE_LABELS) as (keyof Toggles)[])
    .filter((name) => toggles[name])
    .map((name) => TOGGLE_LABELS[name])
}

interface TreeToolbarProps {
  toggles: Toggles
  onToggle: (name: keyof Toggles) => void
  filters: ViewFilters
  choices: Record<FilterField, Choice[]>
  onFilters: (filters: ViewFilters) => void
  onCollapseAll: () => void
  onExpandAll: () => void
  /** A toolbar control acted, or a menu closed: focus goes back to the Tree. */
  onActed: () => void
  /** Enter or Down in the text field: focus goes to the first row, with the query kept. */
  onEnterTree: () => void
  /** The text field, which `/` focuses. */
  inputRef: RefObject<HTMLInputElement | null>
  /** Shown beside the controls while Done issues load for the first time. */
  doneProgress: string | null
  /** False while the empty Tree offers its own "Clear filters", so one button clears. */
  showClear: boolean
}

/** Always laid out, so a toggle keeps its width; `invisible` while the toggle is off. */
function Check({ on }: { on: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`size-3.5 ${on ? '' : 'invisible'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  )
}

/** Marks a button as a menu, and a Filter field as a submenu that turns down when open. */
function Chevron({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`shrink-0 text-muted ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 4 4 4-4 4" />
    </svg>
  )
}

/** A 16px icon before each Filter field. */
const FIELD_ICONS: Record<FilterField, ReactNode> = {
  assignee: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
    </>
  ),
  status: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor" />
    </>
  ),
  label: (
    <>
      <path d="M2.5 2.5h5l6 6-5 5-6-6Z" />
      <circle cx="5.5" cy="5.5" r="0.9" fill="currentColor" />
    </>
  ),
  type: (
    <>
      <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
      <rect x="8.5" y="8.5" width="5" height="5" rx="1" />
    </>
  ),
  sprint: (
    <>
      <path d="M13 8a5 5 0 1 1-1.5-3.5" />
      <path d="M13 2.5v3h-3" />
    </>
  ),
}

const BUTTON =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs hover:bg-hover'

/**
 * Closing a menu hands focus back to the Tree, unless the user already moved it to another
 * control, such as the text field.
 */
function onMenuToggle(event: ToggleEvent<HTMLElement>, onActed: () => void) {
  if (event.newState !== 'closed') return
  const focused = document.activeElement
  if (focused === document.body || focused === null || event.currentTarget.contains(focused)) {
    onActed()
    return
  }
  if (focused instanceof HTMLElement && focused.dataset.menuButton !== undefined) onActed()
}

export function TreeToolbar({
  toggles,
  onToggle,
  filters,
  choices,
  onFilters,
  onCollapseAll,
  onExpandAll,
  onActed,
  onEnterTree,
  inputRef,
  doneProgress,
  showClear,
}: TreeToolbarProps) {
  const chips = filterChips(filters, choices)

  function onTextKey(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === 'Enter' || event.key === 'ArrowDown') && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onEnterTree()
      return
    }
    if (event.key !== 'Escape') return
    event.preventDefault()
    if ((filters.text ?? '') === '') {
      onActed()
      return
    }
    onFilters(withText(filters, ''))
  }

  return (
    <div className="shrink-0 space-y-2 border-b border-line px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(TOGGLE_LABELS) as (keyof Toggles)[]).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={toggles[name]}
            onClick={() => {
              onToggle(name)
              onActed()
            }}
            className={`${BUTTON} aria-pressed:border-accent/40 aria-pressed:bg-selected`}
          >
            <Check on={toggles[name]} />
            {TOGGLE_LABELS[name]}
          </button>
        ))}

        <button
          type="button"
          data-menu-button
          popoverTarget="filter-menu"
          style={{ anchorName: '--filter-menu' }}
          className={BUTTON}
        >
          Filter
          <Chevron className="size-3 rotate-90" />
        </button>
        <div
          id="filter-menu"
          popover="auto"
          aria-label="Filter"
          role="group"
          className="menu w-64"
          style={{ positionAnchor: '--filter-menu' }}
          onToggle={(event) => {
            onMenuToggle(event, onActed)
          }}
        >
          {FILTER_FIELDS.map((field) => (
            <details key={field} className="group/field">
              <summary className="flex h-8 cursor-default items-center gap-2 rounded px-2 hover:bg-hover">
                <svg
                  aria-hidden
                  viewBox="0 0 16 16"
                  className="size-4 shrink-0 text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {FIELD_ICONS[field]}
                </svg>
                <span className="flex-1">{FIELD_LABELS[field]}</span>
                <span className="text-xs text-muted">{filters[field]?.length ?? ''}</span>
                <Chevron className="size-3 group-open/field:rotate-90" />
              </summary>
              <ul className="max-h-56 overflow-y-auto pb-1">
                {choices[field].map((choice) => (
                  <li key={choice.value}>
                    <label className="flex h-7 cursor-default items-center gap-2 rounded px-2 hover:bg-hover">
                      <input
                        type="checkbox"
                        checked={filters[field]?.includes(choice.value) ?? false}
                        onChange={() => {
                          onFilters(toggleChoice(filters, field, choice.value))
                        }}
                        className="accent-accent"
                      />
                      <span className="min-w-0 truncate">{choice.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>

        <button
          type="button"
          data-menu-button
          popoverTarget="groups-menu"
          style={{ anchorName: '--groups-menu' }}
          className={BUTTON}
        >
          Groups
          <Chevron className="size-3 rotate-90" />
        </button>
        <div
          id="groups-menu"
          popover="auto"
          aria-label="Groups"
          role="group"
          className="menu w-44"
          style={{ positionAnchor: '--groups-menu' }}
          onToggle={(event) => {
            onMenuToggle(event, onActed)
          }}
        >
          <button
            type="button"
            popoverTarget="groups-menu"
            popoverTargetAction="hide"
            onClick={onCollapseAll}
            className="flex h-8 w-full items-center rounded px-2 text-left hover:bg-hover"
          >
            Collapse all
          </button>
          <button
            type="button"
            popoverTarget="groups-menu"
            popoverTargetAction="hide"
            onClick={onExpandAll}
            className="flex h-8 w-full items-center rounded px-2 text-left hover:bg-hover"
          >
            Expand all
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          aria-keyshortcuts="/"
          aria-label="Filter by key or summary"
          placeholder="Filter by key or summary"
          value={filters.text ?? ''}
          onChange={(event) => {
            onFilters(withText(filters, event.target.value))
          }}
          onKeyDown={onTextKey}
          className="h-7 min-w-40 flex-1 rounded-md border border-field-border bg-panel px-2 text-xs placeholder:text-muted"
        />

        {doneProgress !== null && (
          <span aria-hidden className="text-xs text-muted">
            {doneProgress}
          </span>
        )}
      </div>

      {(chips.length > 0 || (showClear && hasFilters(filters))) && (
        <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <li
              key={chip.field}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-line pl-2.5 pr-1 text-xs"
            >
              {chip.text}
              <button
                type="button"
                aria-label={`Remove ${FIELD_LABELS[chip.field]} filter`}
                onClick={() => {
                  onFilters(clearField(filters, chip.field))
                  onActed()
                }}
                className="grid size-4 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 16 16"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <path d="m4.5 4.5 7 7m0-7-7 7" />
                </svg>
              </button>
            </li>
          ))}
          {showClear && (
            <li>
              <button
                type="button"
                onClick={() => {
                  onFilters({})
                  onActed()
                }}
                className="h-6 rounded px-1.5 text-xs text-muted hover:bg-hover hover:text-ink"
              >
                Clear
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
