import {
  ISSUE_ORDERS,
  ORDER_DEFAULT_DIRECTION,
  ORDER_DIRECTIONS,
  ROW_PROPERTIES,
  showsPriority,
  type IssueOrder,
  type OrderDirection,
  type RowProperty,
  type TreeLevel,
} from '@jira-mgr/core/display'
import type { ViewFilters } from '@jira-mgr/core/view-filter'
import { type KeyboardEvent, type ReactNode, type RefObject, type ToggleEvent } from 'react'

import type { Display, Toggles } from '../../shared/ipc'
import { CHECK, Icon } from './Icon'
import { FIELD_ICONS, FilterMenu } from './FilterMenu'
import {
  FIELD_LABELS,
  filterChips,
  hasFilters,
  withText,
  clearField,
  type Choice,
  type FilterField,
} from './filters'
import { withoutProperty } from './propertyFit'
import type { CheckState } from './tree'

const TOGGLE_LABELS: Record<keyof Toggles, string> = {
  hideDone: 'Hide done',
  assigneeMe: 'Assignee: me',
  hideEmptyCustomers: 'Hide empty Customers',
}

/** The Groups menu's levels, shallowest first. */
const LEVELS: { value: TreeLevel; label: string }[] = [
  { value: 'customers', label: 'Customers' },
  { value: 'epics', label: 'Epics' },
  { value: 'stories', label: 'Stories' },
  { value: 'all', label: 'Everything' },
]

const ORDER_LABELS: Record<IssueOrder, string> = {
  key: 'Key',
  priority: 'Priority',
  updated: 'Updated',
  due: 'Due date',
  status: 'Status',
  manual: 'Manual',
}

const DIRECTION_LABELS: Record<OrderDirection, string> = {
  asc: 'Ascending',
  desc: 'Descending',
}

/** What the Display menu's chips and the Tree's column headers call each property. */
export const PROPERTY_LABELS: Record<RowProperty, string> = {
  labels: 'Labels',
  sprint: 'Sprint',
  estimate: 'Original estimate',
  logged: 'Logged',
  remaining: 'Remaining',
  remainingPercent: 'Remaining %',
  start: 'Start date',
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
  /** How far the Tree opens, and a pick of another level. */
  level: TreeLevel
  onLevel: (level: TreeLevel) => void
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
  /** How many of the shown rows are checked. The master checkbox shows from one on (#300). */
  checkState: CheckState
  /** A press on the master checkbox: check every shown row, or clear them when all are checked. `pointer` is a mouse click, not Space. */
  onMaster: (pointer: boolean) => void
  /** A batch runs, so the selection must not change under it. */
  masterDisabled: boolean
}

/** Checks or clears every shown row. A dash means some are checked; it does not show with none. */
function MasterCheck({
  state,
  disabled,
  onChange,
}: {
  state: CheckState
  disabled: boolean
  onChange: (pointer: boolean) => void
}) {
  if (state === 'none') return null
  return (
    <input
      type="checkbox"
      aria-label="Select all rows"
      title="Select all rows"
      checked={state === 'all'}
      ref={(el) => {
        if (el !== null) el.indeterminate = state === 'some'
      }}
      disabled={disabled}
      onChange={(event) => {
        onChange((event.nativeEvent as MouseEvent).detail > 0)
      }}
      className="size-4 shrink-0 accent-accent"
    />
  )
}

/**
 * Always laid out, so a toggle keeps its width; `invisible` while the toggle is off. The icon
 * button of a narrow Tree shows its pressed state by fill instead.
 */
function Check({ on }: { on: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`size-3.5 @max-tree:hidden ${on ? '' : 'invisible'}`}
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

/** Marks a button as a menu. */
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

/** The 16px icon of a toolbar button in a Tree under 700px wide, where the label is not shown. */
const TOOL_ICONS = {
  hideDone: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="m5.5 8 1.8 1.8 3.2-3.6" />
    </>
  ),
  assigneeMe: FIELD_ICONS.assignee,
  hideEmptyCustomers: FIELD_ICONS.customer,
  filter: <path d="M2.5 3.5h11L9.5 8.5v4l-3 1v-5Z" />,
  groups: FIELD_ICONS.statusType,
  display: <path d="M3 5h6M12 5h1M3 11h1M7 11h6M9 3.5v3M5 9.5v3" />,
} satisfies Record<string, ReactNode>

function ToolIcon({ name }: { name: keyof typeof TOOL_ICONS }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="hidden size-4 shrink-0 @max-tree:block"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {TOOL_ICONS[name]}
    </svg>
  )
}

/**
 * The toolbar keeps the 8px padding its wrap points were measured with. In a Tree under 700px
 * wide the button is a 28px square and its label reads only to a screen reader (`title` shows it).
 */
const BUTTON = 'btn px-2 @max-tree:w-7 @max-tree:px-0'

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
  level,
  onLevel,
  onActed,
  onEnterTree,
  inputRef,
  doneProgress,
  showClear,
  checkState,
  onMaster,
  masterDisabled,
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
    <div className="@container shrink-0">
      <div className="space-y-2 border-b border-line px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <MasterCheck state={checkState} disabled={masterDisabled} onChange={onMaster} />
          {(Object.keys(TOGGLE_LABELS) as (keyof Toggles)[]).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={toggles[name]}
              title={TOGGLE_LABELS[name]}
              onClick={() => {
                onToggle(name)
                onActed()
              }}
              className={`${BUTTON} aria-pressed:border-accent/40 aria-pressed:bg-selected`}
            >
              <Check on={toggles[name]} />
              <ToolIcon name={name} />
              <span className="@max-tree:sr-only">{TOGGLE_LABELS[name]}</span>
            </button>
          ))}

          <button
            type="button"
            data-menu-button
            popoverTarget="filter-menu"
            aria-keyshortcuts="F"
            title="Filter"
            style={{ anchorName: '--filter-menu' }}
            className={BUTTON}
          >
            <ToolIcon name="filter" />
            <span className="@max-tree:sr-only">Filter</span>
            <Chevron className="size-3 rotate-90 @max-tree:hidden" />
          </button>
          <FilterMenu
            filters={filters}
            choices={choices}
            onFilters={onFilters}
            onOpen={onFilterMenuOpen}
            onClosed={(event) => {
              onMenuToggle(event, onActed)
            }}
          />

          <button
            type="button"
            data-menu-button
            popoverTarget="groups-menu"
            title="Groups"
            style={{ anchorName: '--groups-menu' }}
            className={BUTTON}
          >
            <ToolIcon name="groups" />
            <span className="@max-tree:sr-only">Groups</span>
            <Chevron className="size-3 rotate-90 @max-tree:hidden" />
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
            {LEVELS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                popoverTarget="groups-menu"
                popoverTargetAction="hide"
                aria-pressed={level === value}
                onClick={() => {
                  onLevel(value)
                }}
                data-row
                className="flex h-8 w-full items-center rounded border border-transparent px-2 text-left hover:bg-hover aria-pressed:border-accent/40 aria-pressed:bg-selected"
              >
                {label}
                {level === value && <Icon path={CHECK} className="ml-auto size-3.5" />}
              </button>
            ))}
          </div>

          <button
            type="button"
            data-menu-button
            popoverTarget="display-menu"
            title="Display"
            style={{ anchorName: '--display-menu' }}
            className={BUTTON}
          >
            <ToolIcon name="display" />
            <span className="@max-tree:sr-only">Display</span>
            <Chevron className="size-3 rotate-90 @max-tree:hidden" />
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
                      if (order !== display.order)
                        onDisplay({ ...display, order, direction: ORDER_DEFAULT_DIRECTION[order] })
                    }}
                    className="btn btn-sm aria-pressed:border-accent/40 aria-pressed:bg-selected"
                  >
                    {ORDER_LABELS[order]}
                  </button>
                ))}
              </div>
              <div role="group" aria-label="Direction" className="mt-1 flex flex-wrap gap-1">
                {ORDER_DIRECTIONS.map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    aria-pressed={display.order !== 'manual' && display.direction === direction}
                    disabled={display.order === 'manual'}
                    onClick={() => {
                      onDisplay({ ...display, direction })
                    }}
                    className="btn btn-sm aria-pressed:border-accent/40 aria-pressed:bg-selected"
                  >
                    {DIRECTION_LABELS[direction]}
                  </button>
                ))}
              </div>
              {display.order === 'manual' && (
                <p className="mt-1 text-xs text-muted">
                  Drag a row, or press Alt+Shift+Up or Down, to move it among its siblings.
                </p>
              )}
            </div>
            <div role="group" aria-label="Display properties" className="px-2 pb-2 pt-3">
              <p className="mb-1 text-xs text-muted">Display properties</p>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  data-display="priority"
                  aria-pressed={showsPriority(display)}
                  onClick={() => {
                    onDisplay({ ...display, priority: !showsPriority(display) })
                  }}
                  className="btn btn-sm aria-pressed:border-accent/40 aria-pressed:bg-selected"
                >
                  Priority
                </button>
                {ROW_PROPERTIES.map((property) => {
                  const on = display.properties.includes(property)
                  return (
                    <button
                      key={property}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        // Turning a property off forgets its width, so adding it again starts at the default. A new property goes last.
                        onDisplay(
                          on
                            ? withoutProperty(display, property)
                            : { ...display, properties: [...display.properties, property] },
                        )
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
            className="h-7 min-w-40 flex-1 rounded-md border border-field-border bg-panel px-2 text-xs placeholder:text-muted @max-tree:basis-full"
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
    </div>
  )
}
