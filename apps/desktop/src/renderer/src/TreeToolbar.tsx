import {
  ISSUE_ORDERS,
  ROW_PROPERTIES,
  type IssueOrder,
  type RowProperty,
} from '@jira-mgr/core/display'
import type { ViewFilters } from '@jira-mgr/core/view-filter'
import {
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type ToggleEvent,
} from 'react'

import type { Display, Toggles } from '../../shared/ipc'
import {
  FIELD_LABELS,
  FILTER_FIELDS,
  OPERATORS,
  filterChips,
  hasFilters,
  hasNot,
  toggleChoice,
  valuesOf,
  withText,
  clearField,
  type Choice,
  type FilterField,
  type Operator,
} from './filters'

const TOGGLE_LABELS: Record<keyof Toggles, string> = {
  hideDone: 'Hide done',
  assigneeMe: 'Assignee: me',
  hideEmptyCustomers: 'Hide empty Customers',
}

const ORDER_LABELS: Record<IssueOrder, string> = {
  key: 'Key',
  priority: 'Priority',
  updated: 'Updated',
  due: 'Due date',
}

const PROPERTY_LABELS: Record<RowProperty, string> = {
  labels: 'Labels',
  sprint: 'Sprint',
  due: 'Due date',
  created: 'Created',
  updated: 'Updated',
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
  /** The row properties and issue order the Tree shows. */
  display: Display
  onDisplay: (display: Display) => void
  filters: ViewFilters
  choices: Record<FilterField, Choice[]>
  onFilters: (filters: ViewFilters) => void
  /** The Filter menu opened, so its choices may load. */
  onFilterMenuOpen: () => void
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

const CALENDAR = <path d="M2.5 3.5h11v10h-11ZM2.5 6.5h11M5.5 2v3M10.5 2v3" />

/** A 16px icon before each Filter field. */
const FIELD_ICONS: Record<FilterField, ReactNode> = {
  assignee: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
    </>
  ),
  creator: (
    <>
      <circle cx="7" cy="5.5" r="2.5" />
      <path d="M2.5 13.5c.6-2.6 2.4-4 4.5-4M12 9.5v4M10 11.5h4" />
    </>
  ),
  status: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor" />
    </>
  ),
  statusType: <path d="m2.5 6 5.5-3 5.5 3L8 9ZM2.5 9.5l5.5 3 5.5-3" />,
  priority: <path d="M4 13V9M8 13V6M12 13V3" />,
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
  customer: (
    <>
      <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
      <path d="M6 5.5h1M9 5.5h1M6 8.5h1M9 8.5h1" />
    </>
  ),
  engagement: (
    <>
      <rect x="2.5" y="5" width="11" height="8" rx="1.5" />
      <path d="M6 5V3.5h4V5" />
    </>
  ),
  epic: <path d="M9 2 4 9h4l-1 5 5-7H8Z" />,
  sprint: (
    <>
      <path d="M13 8a5 5 0 1 1-1.5-3.5" />
      <path d="M13 2.5v3h-3" />
    </>
  ),
  relations: (
    <>
      <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.5.5" />
      <path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.5-.5" />
    </>
  ),
  due: (
    <>
      {CALENDAR}
      <path d="M8 8.5v2M8 11.8v.2" />
    </>
  ),
  created: (
    <>
      {CALENDAR}
      <path d="M8 8.5v3M6.5 10h3" />
    </>
  ),
  updated: (
    <>
      {CALENDAR}
      <circle cx="8" cy="10" r="1" fill="currentColor" />
    </>
  ),
}

/** The toolbar keeps the 8px padding its wrap points were measured with. */
const BUTTON = 'btn px-2'

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
  display,
  onDisplay,
  filters,
  choices,
  onFilters,
  onFilterMenuOpen,
  onCollapseAll,
  onExpandAll,
  onActed,
  onEnterTree,
  inputRef,
  doneProgress,
  showClear,
}: TreeToolbarProps) {
  const chips = filterChips(filters, choices)
  // The operator each field's list shows. A field that holds only "is not" values still opens on "is".
  const [operators, setOperators] = useState<Partial<Record<FilterField, Operator>>>({})

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
          aria-keyshortcuts="F"
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
          className="menu max-h-[min(36rem,calc(100vh-6rem))] w-64 overflow-y-auto"
          style={{ positionAnchor: '--filter-menu' }}
          onToggle={(event) => {
            if (event.newState === 'open') onFilterMenuOpen()
            onMenuToggle(event, onActed)
          }}
        >
          {FILTER_FIELDS.map((field) => {
            const op = operators[field] ?? 'is'
            const held = valuesOf(filters, field, op)
            const total = OPERATORS.reduce((n, o) => n + valuesOf(filters, field, o).length, 0)
            return (
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
                  <span className="text-xs text-muted">{total === 0 ? '' : total}</span>
                  <Chevron className="size-3 group-open/field:rotate-90" />
                </summary>
                {hasNot(field) && (
                  <div
                    role="group"
                    aria-label={`${FIELD_LABELS[field]} operator`}
                    className="flex gap-1 px-2 pb-1"
                  >
                    {OPERATORS.map((o) => (
                      <button
                        key={o}
                        type="button"
                        aria-pressed={op === o}
                        onClick={() => {
                          setOperators((held) => ({ ...held, [field]: o }))
                        }}
                        className="btn btn-sm aria-pressed:border-accent/40 aria-pressed:bg-selected"
                      >
                        {o === 'is' ? 'is' : 'is not'}
                      </button>
                    ))}
                  </div>
                )}
                <ul className="max-h-56 overflow-y-auto pb-1">
                  {choices[field].map((choice) => (
                    <li key={choice.value}>
                      <label className="flex h-7 cursor-default items-center gap-2 rounded px-2 hover:bg-hover">
                        <input
                          type="checkbox"
                          checked={held.includes(choice.value)}
                          onChange={() => {
                            onFilters(toggleChoice(filters, field, choice.value, op))
                          }}
                          className="accent-accent"
                        />
                        <span className="min-w-0 truncate">{choice.label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            )
          })}
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
            data-row
            className="flex h-8 w-full items-center rounded px-2 text-left hover:bg-hover"
          >
            Collapse all
          </button>
          <button
            type="button"
            popoverTarget="groups-menu"
            popoverTargetAction="hide"
            onClick={onExpandAll}
            data-row
            className="flex h-8 w-full items-center rounded px-2 text-left hover:bg-hover"
          >
            Expand all
          </button>
        </div>

        <button
          type="button"
          data-menu-button
          popoverTarget="display-menu"
          style={{ anchorName: '--display-menu' }}
          className={BUTTON}
        >
          Display
          <Chevron className="size-3 rotate-90" />
        </button>
        <div
          id="display-menu"
          popover="auto"
          aria-label="Display"
          role="group"
          className="menu w-72"
          style={{ positionAnchor: '--display-menu' }}
          onToggle={(event) => {
            onMenuToggle(event, onActed)
          }}
        >
          <div role="group" aria-label="Ordering" className="px-2 pt-2">
            <p className="mb-1 text-xs text-muted">Ordering</p>
            <div className="flex flex-wrap gap-1">
              {ISSUE_ORDERS.map((order) => (
                <button
                  key={order}
                  type="button"
                  aria-pressed={display.order === order}
                  onClick={() => {
                    onDisplay({ ...display, order })
                  }}
                  className="btn btn-sm aria-pressed:border-accent/40 aria-pressed:bg-selected"
                >
                  {ORDER_LABELS[order]}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-label="Display properties" className="px-2 pb-2 pt-3">
            <p className="mb-1 text-xs text-muted">Display properties</p>
            <div className="flex flex-wrap gap-1">
              {ROW_PROPERTIES.map((property) => {
                const on = display.properties.includes(property)
                return (
                  <button
                    key={property}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      onDisplay({
                        ...display,
                        properties: ROW_PROPERTIES.filter((p) =>
                          p === property ? !on : display.properties.includes(p),
                        ),
                      })
                    }}
                    className="btn btn-sm aria-pressed:border-accent/40 aria-pressed:bg-selected"
                  >
                    {PROPERTY_LABELS[property]}
                  </button>
                )
              })}
            </div>
          </div>
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
              key={`${chip.field}:${chip.op}`}
              className="inline-flex items-center gap-1 rounded-md border border-line pl-2.5 text-xs"
            >
              {chip.text}
              <button
                type="button"
                aria-label={`Remove ${FIELD_LABELS[chip.field]}${chip.op === 'not' ? ' is not' : ''} filter`}
                onClick={() => {
                  onFilters(clearField(filters, chip.field, chip.op))
                  onActed()
                }}
                className="btn btn-sm btn-icon btn-ghost"
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
                className="btn btn-sm btn-ghost"
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
