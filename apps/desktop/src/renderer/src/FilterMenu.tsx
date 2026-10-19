import type { ViewFilters } from '@jira-mgr/core/view-filter'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type ToggleEvent,
} from 'react'

import {
  FIELD_LABELS,
  FILTER_FIELDS,
  OPERATORS,
  hasNot,
  toggleChoice,
  valuesOf,
  type Choice,
  type FilterField,
  type Operator,
} from './filters'
import { Arrow, SUBMENU, anchorOf } from './Picker'
import { matches } from './properties'

/** How long the pointer rests on a field before its submenu opens, or swaps for another field's. */
const HOVER_MS = 150

const CALENDAR = <path d="M2.5 3.5h11v10h-11ZM2.5 6.5h11M5.5 2v3M10.5 2v3" />

/** A 16px icon before each Filter field. */
export const FIELD_ICONS: Record<FilterField, ReactNode> = {
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

interface FilterMenuProps {
  filters: ViewFilters
  choices: Record<FilterField, Choice[]>
  onFilters: (filters: ViewFilters) => void
  /** The menu opened, so its choices may load. */
  onOpen: () => void
  /** The menu closed: focus goes back to the Tree. */
  onClosed: (event: ToggleEvent<HTMLElement>) => void
}

interface FieldProps {
  field: FilterField
  filters: ViewFilters
  choices: readonly Choice[]
  onFilters: (filters: ViewFilters) => void
}

/**
 * One row of the Filter menu and the submenu of its values. The submenu is an auto popover
 * inside the menu's, so a press in it is a press in the menu. The row opens it on a click,
 * Enter or Right with focus in its search box, and on a pointer that rests on the row without
 * taking focus.
 */
function FilterField({ field, filters, choices, onFilters }: FieldProps) {
  const uid = useId()
  const popoverId = `${uid}-values`
  const label = FIELD_LABELS[field]
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // The operator the list shows. A field that holds only "is not" values still opens on "is".
  const [op, setOp] = useState<Operator>('is')
  const held = valuesOf(filters, field, op)
  const total = OPERATORS.reduce((n, o) => n + valuesOf(filters, field, o).length, 0)
  const listed = choices.filter((choice) => matches(choice.label, query.trim()))

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    [],
  )

  function show(focus: boolean) {
    const popover = popoverRef.current
    if (popover === null) return
    // The submenu starts at the menu's edge, past the scrollbar the list may show beside its rows.
    const menu = buttonRef.current?.closest('[popover]')
    const row = buttonRef.current
    if (menu != null && row != null) {
      const gap = menu.getBoundingClientRect().right - row.getBoundingClientRect().right
      popover.style.setProperty('--gap', `${String(gap - 1)}px`)
    }
    if (!popover.matches(':popover-open')) popover.showPopover()
    if (focus) searchRef.current?.focus()
  }

  /**
   * The pointer moved on the row, and rests there for `HOVER_MS`: a move across other fields toward
   * the submenu swaps nothing. A move of 0 is the browser repeating the pointer's place after the
   * menu opened under it, which is not the user pointing.
   */
  function dwell(event: PointerEvent<HTMLButtonElement>) {
    if (event.movementX === 0 && event.movementY === 0) return
    // Text in a search box means the user is typing there, so the submenu stays however the pointer drifts.
    const focused = document.activeElement
    if (
      focused instanceof HTMLInputElement &&
      focused.type === 'text' &&
      focused.value !== '' &&
      focused.closest('[popover]') !== buttonRef.current?.closest('[popover]')
    )
      return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      show(false)
    }, HOVER_MS)
  }

  /** A field takes focus, so another field's submenu, opened by the pointer, closes. */
  function closeOthers() {
    const menu = buttonRef.current?.closest('[popover]')
    for (const other of menu?.querySelectorAll<HTMLElement>('[popover]:popover-open') ?? []) {
      if (other !== popoverRef.current) other.hidePopover()
    }
  }

  function onRowKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      show(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const rows = [
      ...(buttonRef.current
        ?.closest('[popover]')
        ?.querySelectorAll<HTMLElement>('[data-filter-field]') ?? []),
    ]
    const at = rows.indexOf(event.currentTarget)
    const next = rows[at + (event.key === 'ArrowDown' ? 1 : -1)]
    if (next === undefined) return
    next.focus()
  }

  /** Closes the submenu and returns focus to its field. */
  function leave() {
    popoverRef.current?.hidePopover()
    buttonRef.current?.focus()
  }

  function onSubmenuKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target
    const searching = target === searchRef.current && query !== ''
    if (event.key === 'Escape') {
      // The first Escape clears the text, the next closes the submenu. Closing it here, not by
      // the popover's own Esc, keeps one Escape from closing the menu with it.
      event.preventDefault()
      if (searching) setQuery('')
      else leave()
    } else if (event.key === 'ArrowLeft' && !searching) {
      event.preventDefault()
      leave()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // The search box and the checkboxes form one list.
      const stops = [...(popoverRef.current?.querySelectorAll<HTMLInputElement>('input') ?? [])]
      const at = stops.findIndex((stop) => stop === target)
      if (at < 0) return
      event.preventDefault()
      stops[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
    }
  }

  function onToggle(event: ToggleEvent<HTMLDivElement>) {
    const opened = event.newState === 'open'
    setOpen(opened)
    if (opened) return
    setQuery('')
    // Closing the submenu hands focus back to its field, while the menu stays open.
    const focused = document.activeElement
    const menuOpen = buttonRef.current?.closest('[popover]')?.matches(':popover-open') === true
    const lost =
      focused === null || focused === document.body || popoverRef.current?.contains(focused)
    // Another submenu already open means the pointer swapped this one out: focusing the row would close it.
    const swapped = buttonRef.current?.closest('[popover]')?.querySelector('[popover]:popover-open')
    if (menuOpen && lost === true && swapped == null) buttonRef.current?.focus()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-filter-field
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={popoverId}
        style={{ anchorName: anchorOf(uid) }}
        onClick={() => {
          show(true)
        }}
        onKeyDown={onRowKey}
        onFocus={closeOthers}
        onPointerMove={dwell}
        onPointerLeave={() => {
          window.clearTimeout(timer.current)
        }}
        className="menu-item"
      >
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
        <span className="flex-1 truncate">{label}</span>
        <span className="text-xs text-muted">{total === 0 ? '' : total}</span>
        <Arrow />
      </button>
      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        role="group"
        aria-label={label}
        onToggle={onToggle}
        onKeyDown={onSubmenuKey}
        // Opens to the right, level with the row. Against the window's right edge it flips to the left,
        // against the foot it flips above the row, and at the corner it does both. Half the window's
        // height always fits above or below the row, so the list scrolls inside it instead.
        style={{
          positionAnchor: anchorOf(uid),
          positionTryFallbacks: 'flip-inline, flip-block, flip-block flip-inline',
          maxHeight: 'calc(50vh - 1rem)',
          ...SUBMENU,
          // No upward offset: a flip would turn it into a downward one, past the window's foot.
          margin: '0 0 0 var(--gap, 4px)',
        }}
        className="menu flex-col w-64 [&:popover-open]:flex"
      >
        <input
          ref={searchRef}
          type="text"
          aria-label={`Search ${label}`}
          placeholder={`Search ${label.toLowerCase()}`}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          className="mb-1 h-8 w-full shrink-0 rounded-md border border-field-border bg-canvas px-2 placeholder:text-muted"
        />
        {hasNot(field) && (
          <div role="group" aria-label={`${label} operator`} className="flex gap-1 px-2 pb-1">
            {OPERATORS.map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={op === o}
                onClick={() => {
                  setOp(o)
                }}
                className="btn btn-sm aria-pressed:border-accent/40 aria-pressed:bg-selected"
              >
                {o === 'is' ? 'is' : 'is not'}
              </button>
            ))}
          </div>
        )}
        <ul className="min-h-0 max-h-56 overflow-y-auto pb-1">
          {listed.map((choice) => (
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
        {listed.length === 0 && <p className="px-2 py-1.5 text-muted">No matches</p>}
      </div>
    </>
  )
}

/** The Filter menu: the fields, each opening its values in a submenu beside the list. */
export function FilterMenu({ filters, choices, onFilters, onOpen, onClosed }: FilterMenuProps) {
  return (
    <div
      id="filter-menu"
      popover="auto"
      aria-label="Filter"
      role="group"
      className="menu max-h-[min(36rem,calc(100vh-6rem))] w-64 overflow-y-auto"
      style={{ positionAnchor: '--filter-menu' }}
      onToggle={(event) => {
        // A submenu's own toggle bubbles here; only this menu's opening and closing count.
        if (event.target !== event.currentTarget) return
        if (event.newState === 'open') onOpen()
        onClosed(event)
      }}
    >
      {FILTER_FIELDS.map((field) => (
        <FilterField
          key={field}
          field={field}
          filters={filters}
          choices={choices[field]}
          onFilters={onFilters}
        />
      ))}
    </div>
  )
}
