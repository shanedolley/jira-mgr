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

export interface PickerProps {
  /** Names the property. The trigger reads "<label>: <value>" to a screen reader. */
  label: string
  /** The single key that opens this picker from anywhere (D7), shown in the tooltip. */
  shortcut?: string
  /** What the trigger shows and a screen reader hears after the label. */
  valueText: string
  leading?: ReactNode
  options: readonly PickerOption[]
  selected: readonly string[]
  /** Several options can be chosen, and choosing one leaves the list open. */
  multiple?: boolean
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
  /** Lets the caller focus the button, such as after a dialog the choice opened has closed. */
  triggerRef?: RefObject<HTMLButtonElement | null>
}

const CREATE_ID = '__create__'

/** Names a CSS anchor from a React id, whose colons a `dashed-ident` cannot hold. */
const anchorOf = (id: string) => `--picker-${id.replaceAll(/[^a-zA-Z0-9]/g, '')}`

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
  leading,
  options,
  selected,
  multiple = false,
  searchable = false,
  onQuery,
  create,
  onSelect,
  onCreate,
  onOpenChange,
  note,
  footer,
  disabled = false,
  triggerRef: givenTriggerRef,
}: PickerProps) {
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
    if (!multiple) popoverRef.current?.hidePopover()
  }

  function move(step: number) {
    if (visible.length === 0) return
    const next = Math.min(visible.length - 1, Math.max(0, activeIndex + step))
    setActiveId(visible[next]?.id ?? null)
  }

  function onKeyDown(event: KeyboardEvent) {
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
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={`${label}: ${valueText}`}
        aria-keyshortcuts={shortcut}
        title={shortcut === undefined ? undefined : `${label} (${shortcut})`}
        disabled={disabled}
        popoverTarget={popoverId}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          popoverRef.current?.showPopover()
        }}
        style={{ anchorName: anchorOf(uid) }}
        className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-hover disabled:opacity-60 aria-expanded:bg-hover"
      >
        {leading}
        <span className="min-w-0 truncate">{valueText}</span>
      </button>
      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        onToggle={onToggle}
        // Opens toward the left edge of its button: the sidebar sits against the window's right edge.
        style={{
          positionAnchor: anchorOf(uid),
          positionArea: 'block-end span-inline-start',
          positionTryFallbacks: 'flip-block',
        }}
        className="menu w-72"
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
