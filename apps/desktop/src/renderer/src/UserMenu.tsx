import { useId, useRef, useState, type KeyboardEvent } from 'react'

import { Avatar, type AvatarPerson } from './Avatar'
import { MONITOR, MOON, SUN, Icon } from './Icon'
import { Arrow, Check, SUBMENU, anchorOf } from './Picker'
import { THEMES, setTheme, useTheme, type ThemePreference } from './theme'

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

const THEME_ICONS = { system: MONITOR, light: SUN, dark: MOON } as const

const ITEM = '[role^="menuitem"]'

interface UserMenuProps {
  site: string
  email: string
  person: AvatarPerson | null
  /** The 48px rail shows the avatar alone. */
  compact: boolean
  loggingOut: boolean
  onShortcuts: () => void
  onLogout: () => void
}

/** The items of the popover that holds `from`, not those of a submenu inside it. */
function itemsOf(popover: HTMLElement | null): HTMLElement[] {
  return [...(popover?.querySelectorAll<HTMLElement>(ITEM) ?? [])].filter(
    (item) => item.closest('[popover]') === popover,
  )
}

/**
 * The menu on the sidebar's avatar: the site and email as text, a Theme submenu, Keyboard
 * shortcuts and Log out. Up and Down move, Right or Enter opens the submenu, Left closes it, and
 * Esc closes the menu and returns focus to the avatar.
 */
export function UserMenu({
  site,
  email,
  person,
  compact,
  loggingOut,
  onShortcuts,
  onLogout,
}: UserMenuProps) {
  const uid = useId()
  const anchor = anchorOf(uid)
  const theme = useTheme()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const themeRef = useRef<HTMLButtonElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const [subOpen, setSubOpen] = useState(false)

  function showSub() {
    const sub = subRef.current
    if (sub === null) return
    if (!sub.matches(':popover-open')) sub.showPopover()
    const items = itemsOf(sub)
    ;(items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus()
  }

  /** Closes the menu and its submenu, and gives the avatar focus back. */
  function closeAll() {
    menuRef.current?.hidePopover()
    triggerRef.current?.focus()
  }

  function onKey(event: KeyboardEvent<HTMLElement>) {
    // The Escape and the arrows are the menu's: the overlay sidebar must not take them.
    if (event.key === 'Escape') {
      event.stopPropagation()
      return
    }
    const popover = event.currentTarget
    const items = itemsOf(popover)
    const at = items.indexOf(document.activeElement as HTMLElement)
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        items[(at + step + items.length) % items.length]?.focus()
        break
      }
      case 'ArrowRight':
        if (popover === menuRef.current && document.activeElement === themeRef.current) {
          event.preventDefault()
          showSub()
        }
        break
      case 'ArrowLeft':
        if (popover === subRef.current) {
          event.preventDefault()
          popover.hidePopover()
        }
        break
    }
    event.stopPropagation()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        popoverTarget={`${uid}-menu`}
        aria-haspopup="menu"
        aria-label="User menu"
        title={email}
        style={{ anchorName: anchor }}
        className={
          compact
            ? 'mt-auto mb-3 grid size-7 place-items-center rounded-md hover:bg-hover'
            : 'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover'
        }
      >
        <Avatar person={person} />
        {!compact && <span className="min-w-0 truncate text-xs text-muted">{email}</span>}
      </button>
      <div
        ref={menuRef}
        id={`${uid}-menu`}
        popover="auto"
        role="menu"
        aria-label="User menu"
        onKeyDown={onKey}
        onToggle={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.newState === 'open') itemsOf(menuRef.current)[0]?.focus()
          else if (menuRef.current?.contains(document.activeElement) !== false) {
            triggerRef.current?.focus()
          }
        }}
        // Opens upward from the avatar, level with its left edge.
        style={{
          positionAnchor: anchor,
          positionArea: 'block-start span-inline-end',
          positionTryFallbacks: 'flip-inline',
          margin: '0 0 4px',
        }}
        className="menu w-60"
      >
        <div className="px-2 py-1.5">
          <p className="truncate text-xs text-muted">{site}</p>
          <p className="truncate">{email}</p>
        </div>
        <div role="separator" className="my-1 border-t border-line" />
        <button
          ref={themeRef}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={subOpen}
          style={{ anchorName: `${anchor}-theme` }}
          onClick={showSub}
          className="menu-item"
        >
          <Icon path={THEME_ICONS[theme]} className="size-4 text-muted" />
          <span className="flex-1">Theme</span>
          <Arrow />
        </button>
        <div
          ref={subRef}
          role="menu"
          popover="auto"
          aria-label="Theme"
          onKeyDown={onKey}
          onToggle={(event) => {
            const opened = event.newState === 'open'
            setSubOpen(opened)
            // Closing the submenu hands focus back to its row while the menu stays open.
            if (!opened && menuRef.current?.matches(':popover-open')) themeRef.current?.focus()
          }}
          style={{
            positionAnchor: `${anchor}-theme`,
            positionTryFallbacks: 'flip-block, flip-inline',
            ...SUBMENU,
          }}
          className="menu w-40"
        >
          {THEMES.map((choice) => (
            <button
              key={choice}
              type="button"
              role="menuitemradio"
              aria-checked={theme === choice}
              onClick={() => {
                setTheme(choice)
                closeAll()
              }}
              className="menu-item"
            >
              <span className="flex-1">{THEME_LABELS[choice]}</span>
              {theme === choice && <Check />}
            </button>
          ))}
        </div>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            closeAll()
            onShortcuts()
          }}
          className="menu-item"
        >
          Keyboard shortcuts
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={loggingOut}
          onClick={() => {
            closeAll()
            onLogout()
          }}
          className="menu-item"
        >
          Log out
        </button>
      </div>
    </>
  )
}
