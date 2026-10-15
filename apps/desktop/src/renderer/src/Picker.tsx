import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type ToggleEvent,
} from 'react'

import { Kbd, keycap } from './Kbd'
import { matches } from './properties'

export interface PickerOption {
  id: string
  label: string
  /** Muted text after the label, such as an issue key or a sprint's dates. */
  detail?: string
  /** Options in the same group sit together under its heading. */
  group?: string
  /** Shown before the label, such as a status dot. */
  leading?: ReactNode
  /** Listed but not chosen, such as a closed sprint. */
  disabled?: boolean
}

/**
 * How the trigger looks. `row` fills its line, with a chevron. `chip` is a small bordered button. `filled` is a chip
 * tinted with the accent for a required value, and reads in `--danger` while nothing is chosen.
 * `icon` shows only `leading` and a chevron; the name and value stay in the accessible name. `menu` is an item of the
 * context menu: the name, its key and an arrow, with the list opening beside it.
 */
export type PickerVariant = 'row' | 'chip' | 'filled' | 'icon' | 'menu'

const TRIGGER: Record<PickerVariant, string> = {
  row: 'h-8 w-full min-w-0 gap-2 rounded-md px-2 hover:bg-hover',
  chip: 'h-7 max-w-48 min-w-0 gap-1.5 rounded-md border border-field-border px-2.5 text-xs hover:bg-hover',
  filled: 'h-7 max-w-48 min-w-0 gap-1.5 rounded-md border border-accent bg-selected px-2.5 text-xs',
  icon: 'h-10 w-12 justify-center gap-1 rounded-md border border-field-border hover:bg-hover',
  menu: 'menu-item',
}

export interface PickerProps {
  /** Names the property. The trigger reads "<label>: <value>" to a screen reader. */
  label: string
  /** The single key that opens this picker from anywhere (D7), shown as a keycap on hover and focus. */
  shortcut?: string
  /** What the trigger shows and a screen reader hears after the label. */
  valueText: string
  /** Names the trigger in place of "<label>: <value>", for a button that names an action, not a value. */
  triggerLabel?: string
  leading?: ReactNode
  variant?: PickerVariant
  options: readonly PickerOption[]
  selected: readonly string[]
  /** Several options can be chosen, and choosing one leaves the list open. */
  multiple?: boolean
  /** The first nine options answer to the keys 1 to 9, shown as keycaps. Not with `searchable`, where digits type. */
  numbered?: boolean
  /** Shows a search field. Without `onQuery`, the picker filters the options by label itself. */
  searchable?: boolean
  /** Remote search: told each query, while the caller supplies the options that match. */
  onQuery?: (query: string) => void
  /** Lets the user add a value that is not listed. */
  create?: { valid: (text: string) => boolean; label: (text: string) => string }
  onSelect: (id: string) => void
  onCreate?: (text: string) => void
  onOpenChange?: (open: boolean) => void
  /** Loading, an error or a count, announced under the list. */
  note?: ReactNode
  /** Extra controls under the list, such as "Show all sprints". */
  footer?: ReactNode
  disabled?: boolean
  /** Opens a 26rem popover in place of the 13rem one, for options whose labels are long, such as a parent's summary. */
  wide?: boolean
  /** Lets the caller focus the button, such as after a dialog the choice opened has closed. */
  triggerRef?: RefObject<HTMLButtonElement | null>
  /** Called once a choice has closed the list, which a context menu takes as the action being done. */
  onPicked?: () => void
}

/** What the context menu passes a picker to make it one of its items. */
export interface MenuMode {
  /** Called once a choice has closed the list: the action is done and the menu can close. */
  onPicked: () => void
}

/** The props that turn a picker into a menu item, or none outside a menu. */
export const menuProps = (menu: MenuMode | undefined): Pick<PickerProps, 'variant' | 'onPicked'> =>
  menu === undefined ? {} : { variant: 'menu', onPicked: menu.onPicked }

const CREATE_ID = '__create__'

/** Names a CSS anchor from a React id, whose colons a `dashed-ident` cannot hold. */
export const anchorOf = (id: string) => `--picker-${id.replaceAll(/[^a-zA-Z0-9]/g, '')}`

function Check() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0"
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

/** Marks the trigger as editable: read-only values show no chevron. */
function Chevron() {
  return (
    <svg
      aria-hidden
      data-chevron
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

/** Where a submenu opens: beside its item, starting level with it. */
export const SUBMENU = {
  positionArea: 'inline-end span-block-end',
  margin: '-5px 0 0 4px',
} as const

/** Marks a menu item as opening a submenu. */
export function Arrow() {
  return (
    <svg
      aria-hidden
      data-arrow
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 text-muted"
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

/**
 * A button that opens a native popover holding a listbox, the one picker every property uses.
 * With a search field the field is a combobox that points at the active option with
 * `aria-activedescendant`; without one the listbox takes focus itself. Arrow keys move, Enter
 * chooses, Esc closes and returns focus to the button. Several options can be chosen with
 * `multiple`, and a value can be added with `create`.
 */
export function Picker({
  label,
  shortcut,
  valueText,
  triggerLabel,
  leading,
  variant = 'row',
  options,
  selected,
  multiple = false,
  numbered = false,
  searchable = false,
  onQuery,
  create,
  onSelect,
  onCreate,
  onOpenChange,
  note,
  footer,
  disabled = false,
  wide = false,
  triggerRef: givenTriggerRef,
  onPicked,
}: PickerProps) {
  const inMenu = variant === 'menu'
  const uid = useId()
  const popoverId = `${uid}-popover`
  const listId = `${uid}-list`
  const optionId = (index: number) => `${uid}-option-${String(index)}`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const ownTriggerRef = useRef<HTMLButtonElement>(null)
  const triggerRef = givenTriggerRef ?? ownTriggerRef
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const text = query.trim()
  const listed =
    searchable && onQuery === undefined
      ? options.filter((o) => matches(`${o.label} ${o.detail ?? ''}`, text))
      : options
  const addable =
    create !== undefined &&
    text !== '' &&
    create.valid(text) &&
    !options.some((o) => o.label === text)
  const visible: readonly PickerOption[] = addable
    ? [...listed, { id: CREATE_ID, label: create.label(text) }]
    : listed
  const active = visible.some((o) => o.id === activeId) ? activeId : (visible[0]?.id ?? null)
  const activeIndex = visible.findIndex((o) => o.id === active)
  // Options with the same group sit together, each run under its own heading.
  const sections: {
    group: string | undefined
    items: { option: PickerOption; index: number }[]
  }[] = []
  visible.forEach((option, index) => {
    const last = sections.at(-1)
    if (last !== undefined && last.group === option.group) last.items.push({ option, index })
    else sections.push({ group: option.group, items: [{ option, index }] })
  })

  useEffect(() => {
    if (open && activeIndex >= 0) {
      document
        .getElementById(`${uid}-option-${String(activeIndex)}`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, activeIndex, uid])

  function onToggle(event: ToggleEvent<HTMLDivElement>) {
    const nowOpen = event.newState === 'open'
    setOpen(nowOpen)
    onOpenChange?.(nowOpen)
    if (nowOpen) {
      setActiveId(selected[0] ?? null)
      ;(searchable ? inputRef.current : listRef.current)?.focus()
      return
    }
    setQuery('')
    onQuery?.('')
    const focused = document.activeElement
    if (
      focused === document.body ||
      focused === null ||
      popoverRef.current?.contains(focused) === true
    ) {
      triggerRef.current?.focus()
    }
  }

  function choose(id: string) {
    if (visible.find((o) => o.id === id)?.disabled === true) return
    if (id === CREATE_ID) {
      onCreate?.(text)
      setQuery('')
      onQuery?.('')
    } else {
      onSelect(id)
    }
    if (!multiple) {
      popoverRef.current?.hidePopover()
      onPicked?.()
    }
  }

  function move(step: number) {
    if (visible.length === 0) return
    const next = Math.min(visible.length - 1, Math.max(0, activeIndex + step))
    setActiveId(visible[next]?.id ?? null)
  }

  function onKeyDown(event: KeyboardEvent) {
    // In a context menu Left goes back to the item, as in any submenu; in a search field it moves the caret until the field is empty.
    if (inMenu && event.key === 'ArrowLeft' && (!searchable || query === '')) {
      event.preventDefault()
      popoverRef.current?.hidePopover()
      return
    }
    if (
      numbered &&
      /^[1-9]$/.test(event.key) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault()
      const option = visible[Number(event.key) - 1]
      if (option !== undefined) choose(option.id)
      return
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Home':
      case 'End':
        // In the search field these move the caret.
        if (searchable) return
        event.preventDefault()
        setActiveId((event.key === 'Home' ? visible[0] : visible.at(-1))?.id ?? null)
        break
      case 'Enter':
        event.preventDefault()
        if (active !== null) choose(active)
        break
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role={inMenu ? 'menuitem' : undefined}
        tabIndex={inMenu ? -1 : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={inMenu ? label : (triggerLabel ?? `${label}: ${valueText}`)}
        aria-keyshortcuts={shortcut}
        disabled={disabled}
        popoverTarget={popoverId}
        onKeyDown={(event) => {
          // A menu opens its submenus with Right, and keeps Down for moving between its items.
          if (event.key !== (inMenu ? 'ArrowRight' : 'ArrowDown')) return
          event.preventDefault()
          popoverRef.current?.showPopover()
        }}
        style={{ anchorName: anchorOf(uid) }}
        className={`group flex items-center text-left disabled:opacity-60 aria-expanded:bg-hover ${TRIGGER[variant]}`}
      >
        {inMenu ? (
          <>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {shortcut !== undefined && <Kbd aria-hidden>{keycap(shortcut)}</Kbd>}
            <Arrow />
          </>
        ) : (
          <>
            {leading}
            {variant !== 'icon' && (
              <span
                className={`min-w-0 truncate ${variant === 'row' ? 'flex-1' : ''} ${variant === 'filled' && selected.length === 0 ? 'text-danger' : ''}`}
              >
                {valueText}
              </span>
            )}
            {variant !== 'icon' && shortcut !== undefined && !disabled && (
              <span className="hidden group-hover:contents group-focus-visible:contents">
                <Kbd aria-hidden>{keycap(shortcut)}</Kbd>
              </span>
            )}
            {(variant === 'row' || variant === 'icon') && <Chevron />}
          </>
        )}
      </button>
      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        onToggle={onToggle}
        // Starts at the left edge of its button, so the property's name stays readable; against the
        // window's right edge it flips to open leftward.
        style={{
          positionAnchor: anchorOf(uid),
          positionTryFallbacks: 'flip-block, flip-inline',
          // A submenu opens beside its item and starts level with it.
          ...(inMenu && SUBMENU),
        }}
        className={`menu ${wide ? 'w-104' : 'w-52'}`}
      >
        {searchable && (
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={`Search ${label}`}
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex < 0 ? undefined : optionId(activeIndex)}
            autoComplete="off"
            spellCheck={false}
            placeholder={`Search ${label.toLowerCase()}`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              onQuery?.(event.target.value)
            }}
            onKeyDown={onKeyDown}
            className="mb-1 h-8 w-full rounded-md border border-field-border bg-canvas px-2 placeholder:text-muted"
          />
        )}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          aria-activedescendant={
            !searchable && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          tabIndex={searchable ? -1 : 0}
          onKeyDown={searchable ? undefined : onKeyDown}
          // Keeps focus where it is, so a click on an option never blurs the search field.
          onMouseDown={(event) => {
            event.preventDefault()
          }}
          className="max-h-64 overflow-y-auto focus-visible:outline-none"
        >
          {sections.map(({ group, items }) => (
            <div
              key={group ?? ''}
              role={group === undefined ? 'presentation' : 'group'}
              aria-label={group}
            >
              {group !== undefined && (
                <p
                  aria-hidden
                  className="px-2 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted"
                >
                  {group}
                </p>
              )}
              {items.map(({ option, index }) => (
                <div
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected.includes(option.id)}
                  aria-disabled={option.disabled}
                  aria-keyshortcuts={numbered && index < 9 ? String(index + 1) : undefined}
                  data-active={option.id === active}
                  onClick={() => {
                    choose(option.id)
                  }}
                  className="flex h-8 cursor-default items-center gap-2 rounded px-2 hover:bg-hover data-[active=true]:bg-selected aria-disabled:text-muted aria-disabled:hover:bg-transparent"
                >
                  {option.leading}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.detail !== undefined && (
                    <span className="shrink-0 text-xs text-muted">{option.detail}</span>
                  )}
                  {numbered && index < 9 && <Kbd aria-hidden>{index + 1}</Kbd>}
                  {selected.includes(option.id) && <Check />}
                </div>
              ))}
            </div>
          ))}
        </div>
        {visible.length === 0 && <p className="px-2 py-1.5 text-muted">No matches</p>}
        {note !== undefined && (
          <div role="status" className="px-2 py-1.5 text-xs text-muted">
            {note}
          </div>
        )}
        {footer}
      </div>
    </>
  )
}
