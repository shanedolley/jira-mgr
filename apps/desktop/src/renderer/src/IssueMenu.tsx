import type { Issue } from '@jira-mgr/core'
import { formatEstimate, parseEstimate } from '@jira-mgr/core/issue'
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import type { CurrentUser } from '../../shared/ipc'
import { TextField } from './IssueProperties'
import { Kbd, keycap } from './Kbd'
import { letterCommand } from './keymap'
import { menuItems, type MenuAction, type MenuItem, type MenuItemId } from './menuItems'
import { Arrow, SUBMENU, anchorOf } from './Picker'
import {
  AssigneePicker,
  LabelsPicker,
  ParentPicker,
  PriorityPicker,
  SprintPicker,
  StatusPicker,
  TypePicker,
  useAttempt,
  useIssueChange,
} from './PropertyPickers'
import { useSetSummary } from './queries'

/** Space kept between the menu and the window's edge. */
const MARGIN = 8

/**
 * A submenu that holds a field, for a date, a duration or a summary: the item opens a popover
 * beside it with the field focused. The pickers open their own list, which does the same.
 */
function FieldItem({
  label,
  shortcut,
  children,
}: {
  label: string
  shortcut: string | undefined
  children: ReactNode
}) {
  const uid = useId()
  const popoverId = `${uid}-popover`
  const [open, setOpen] = useState(false)
  const popover = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-keyshortcuts={shortcut}
        popoverTarget={popoverId}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight') return
          event.preventDefault()
          popover.current?.showPopover()
          popover.current?.querySelector('input')?.focus()
        }}
        style={{ anchorName: anchorOf(uid) }}
        className="menu-item"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {shortcut !== undefined && <Kbd aria-hidden>{keycap(shortcut)}</Kbd>}
        <Arrow />
      </button>
      <div
        ref={popover}
        id={popoverId}
        popover="auto"
        role="group"
        aria-label={`Set ${label.toLowerCase()}`}
        onToggle={(event) => {
          if (event.target !== event.currentTarget) return
          const nowOpen = event.newState === 'open'
          setOpen(nowOpen)
          if (nowOpen) {
            popover.current?.querySelector('input')?.focus()
          } else if (popover.current?.contains(document.activeElement) !== false) {
            trigger.current?.focus()
          }
        }}
        style={{
          positionAnchor: anchorOf(uid),
          positionTryFallbacks: 'flip-block, flip-inline',
          ...SUBMENU,
        }}
        className="menu w-56"
      >
        {children}
      </div>
    </>
  )
}

/** The date fields: Enter or leaving the field saves it, and an emptied field clears the date. */
function DateItem({
  issue,
  field,
  label,
  shortcut,
  onDone,
}: {
  issue: Issue
  field: 'startDate' | 'dueDate'
  label: string
  shortcut: string | undefined
  onDone: () => void
}) {
  const change = useIssueChange(issue)
  return (
    <FieldItem label={label} shortcut={shortcut}>
      <TextField
        key={issue[field] ?? ''}
        label={label}
        type="date"
        value={issue[field] ?? ''}
        onCommit={(draft) => {
          const date = draft === '' ? null : draft
          change(label, { [field]: date }, { [field]: date })
          onDone()
        }}
      />
    </FieldItem>
  )
}

function EstimateItem({
  issue,
  shortcut,
  onDone,
}: {
  issue: Issue
  shortcut: string | undefined
  onDone: () => void
}) {
  const change = useIssueChange(issue)
  return (
    <FieldItem label="Original estimate" shortcut={shortcut}>
      <TextField
        label="Original estimate"
        value={
          issue.originalEstimateSeconds === null
            ? ''
            : formatEstimate(issue.originalEstimateSeconds)
        }
        placeholder="Set estimate"
        clock
        valid={(draft) => parseEstimate(draft) !== null}
        hint="Use a duration such as 2h 30m."
        onCommit={(draft) => {
          const seconds = parseEstimate(draft)
          if (seconds === null) return
          change(
            'Original estimate',
            { originalEstimate: draft.trim() },
            { originalEstimateSeconds: seconds },
          )
          onDone()
        }}
      />
    </FieldItem>
  )
}

function RenameItem({
  issue,
  shortcut,
  onDone,
}: {
  issue: Issue
  shortcut: string | undefined
  onDone: () => void
}) {
  const attempt = useAttempt(issue.key)
  const save = useSetSummary()
  return (
    <FieldItem label="Rename" shortcut={shortcut}>
      <TextField
        label="Summary"
        value={issue.summary}
        valid={(draft) => draft.trim() !== ''}
        hint="A summary cannot be empty."
        maxLength={255}
        onCommit={(draft) => {
          const summary = draft.trim()
          attempt('Summary', { summary }, () => save.mutateAsync({ key: issue.key, summary }))
          onDone()
        }}
      />
    </FieldItem>
  )
}

interface IssueMenuProps {
  /** The issue as the lists hold it now, so an edit shows in its items at once. */
  issue: Issue
  /** Every loaded issue: the pickers draw recent assignees, labels and parents from them. */
  issues: readonly Issue[]
  me: CurrentUser | undefined
  /** Where the pointer was, or the top left of the active row. The menu moves to stay in view. */
  x: number
  y: number
  /** An item to open at once, for a key that names one, such as `Shift+D`. */
  open?: MenuItemId
  /** Runs an item that is not a submenu. The menu has closed first. */
  onRun: (action: MenuAction) => void
  /** Escape, a click outside or a finished action closed it. */
  onClose: () => void
}

/**
 * The right-click menu of one issue (D7): a native popover in the top layer, closed by Esc and a
 * press outside, with the pickers' own lists as its submenus, so every edit is the one the page
 * makes. Arrows move, Right or Enter opens a submenu, Left closes it, and a listed key runs its item.
 */
export function IssueMenu({ issue, issues, me, x, y, open, onRun, onClose }: IssueMenuProps) {
  const element = useRef<HTMLDivElement>(null)
  const items = menuItems(issue)

  // Shown, then moved so the whole menu is inside the window.
  useLayoutEffect(() => {
    const menu = element.current
    if (menu === null) return
    menu.showPopover()
    const { width, height } = menu.getBoundingClientRect()
    menu.style.left = `${String(Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)))}px`
    menu.style.top = `${String(Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)))}px`
    menu.focus()
  }, [x, y])

  // A press outside closes it. The popover is manual: an auto one lets go on the pointer-up that
  // ends the right-click which opened it, since the menu appeared between that press and release.
  // The submenus are auto popovers inside it, so a press in one is a press in the menu.
  useEffect(() => {
    const press = (event: PointerEvent) => {
      if (event.target instanceof Node && element.current?.contains(event.target) === true) return
      onClose()
    }
    document.addEventListener('pointerdown', press, true)
    return () => {
      document.removeEventListener('pointerdown', press, true)
    }
  }, [onClose])

  // Focus arriving on an element outside the menu ends it, such as Tab out of a field in a
  // submenu, where `relatedTarget` of a blur is null for a top-layer popover. Focus moving between
  // the menu's own parts, or to nowhere while a list closes, does not.
  useEffect(() => {
    const entered = (event: FocusEvent) => {
      if (event.target instanceof Node && element.current?.contains(event.target) === false) {
        onClose()
      }
    }
    document.addEventListener('focusin', entered)
    return () => {
      document.removeEventListener('focusin', entered)
    }
  }, [onClose])

  // A key that names a submenu opens it at once.
  useEffect(() => {
    if (open === undefined) return
    const row = rows()[items.findIndex((item) => item.id === open)]
    row?.focus()
    row?.click()
    // Only the first render opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The menu's own items, not the lists and fields of their submenus. */
  function rows(): HTMLElement[] {
    return [...(element.current?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]') ?? [])]
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Tab leaves the menu, so it ends it: focus would go to the page behind with Esc dead. A date or
    // text field in a submenu keeps its Tab (the date's segments), and a dialog keeps its own.
    if (
      event.key === 'Tab' &&
      event.target instanceof HTMLElement &&
      (event.target === element.current ||
        event.target.closest('[role="menuitem"], [role="listbox"], [role="combobox"]') !== null)
    ) {
      event.preventDefault()
      onClose()
      return
    }
    // A picker's list, a submenu's field and a dialog a submenu raised (the Parent question) keep their own keys.
    if (
      !(event.target instanceof HTMLElement) ||
      event.target.closest('[popover], dialog') !== element.current
    ) {
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Escape') {
      // A manual popover has no Esc of its own. A submenu's own Esc closes just that submenu.
      event.preventDefault()
      onClose()
      return
    }
    const all = rows()
    const at = all.indexOf(event.target)
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (step !== undefined) {
      event.preventDefault()
      all[at < 0 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      ;(event.key === 'Home' ? all[0] : all.at(-1))?.focus()
    } else {
      if (event.repeat) return
      const command = letterCommand(event.key, event.shiftKey)
      const index = items.findIndex((item) => item.id === command)
      if (index < 0) return
      event.preventDefault()
      // Focus first, so closing its list lands focus back on the item.
      all[index]?.focus()
      all[index]?.click()
    }
  }

  const menu = { onPicked: onClose }
  const run = (id: MenuAction) => () => {
    onRun(id)
  }

  function render(item: MenuItem): ReactNode {
    switch (item.id) {
      case 'status':
        return <StatusPicker issue={issue} menu={menu} />
      case 'assignee':
        return <AssigneePicker issue={issue} issues={issues} me={me} menu={menu} />
      case 'priority':
        return <PriorityPicker issue={issue} menu={menu} />
      case 'labels':
        return <LabelsPicker issue={issue} issues={issues} menu={menu} />
      case 'sprint':
        return <SprintPicker issue={issue} menu={menu} />
      case 'parent':
        return <ParentPicker issue={issue} issues={issues} menu={menu} />
      case 'type':
        return <TypePicker issue={issue} menu={menu} />
      case 'startDate':
        return (
          <DateItem
            issue={issue}
            field="startDate"
            label="Start date"
            shortcut={item.key}
            onDone={onClose}
          />
        )
      case 'dueDate':
        return (
          <DateItem
            issue={issue}
            field="dueDate"
            label="Due date"
            shortcut={item.key}
            onDone={onClose}
          />
        )
      case 'estimate':
        return <EstimateItem issue={issue} shortcut={item.key} onDone={onClose} />
      case 'edit':
        return <RenameItem issue={issue} shortcut={item.key} onDone={onClose} />
      case 'open':
      case 'logWork':
      case 'related':
      case 'copy':
      case 'openInJira':
      case 'comment':
      case 'delete':
        return (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-keyshortcuts={item.key}
            onClick={run(item.id)}
            className={`menu-item ${item.id === 'delete' ? 'text-danger' : ''}`}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.key !== undefined && <Kbd aria-hidden>{keycap(item.key)}</Kbd>}
          </button>
        )
    }
  }

  return (
    <div
      ref={element}
      role="menu"
      aria-label={`Actions for ${issue.key}`}
      popover="manual"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="context-menu"
    >
      {items.map((item, at) => (
        <Fragment key={item.id}>
          {at > 0 && items[at - 1]?.group !== item.group && (
            <div role="separator" className="my-1 h-px bg-line" />
          )}
          {render(item)}
        </Fragment>
      ))}
    </div>
  )
}
