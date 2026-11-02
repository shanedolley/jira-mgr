import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react'

/** What a date field offers for the text typed in it. */
export interface DateSuggestion {
  /** What the option reads: the day the text means, such as `Tue 10 Nov 2026`. */
  label: string
  /** What replaces the typed text when the suggestion is taken: `10 Nov`. */
  text: string
}

interface DateInputProps extends Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'role' | 'className' | 'aria-label'
> {
  /** The field's accessible name, such as "Due date". */
  label: string
  value: string
  onChange: (text: string) => void
  /** The date the text reads as, or `null` when it reads as none. The field offers it under itself. */
  suggestion: DateSuggestion | null
  /**
   * Called when Tab or a click takes the suggestion, with the text to put in the field. Tab goes on
   * to the next field after it, and the field's own `onBlur` saves. A click leaves focus here.
   * Returning true from a Tab accept says the edit has ended, so Tab moves focus nowhere.
   */
  onAccept: (text: string, how: 'tab' | 'click', input: HTMLInputElement) => boolean
  /** Whether the text could not be read, which the field says in place of a suggestion. */
  unread: boolean
  className: string
  /**
   * The CSS anchor name of an element to place the suggestion under in place of the field, for a
   * field with controls below it that the suggestion must not cover.
   */
  anchor?: string
  /** The classes of the message's layout; the message is always mounted, and hidden while empty. */
  noteClassName?: string
}

/**
 * The one date field: a text input that is a combobox over a listbox with at most one option, the
 * date its text reads as. The option sits in a native popover under the field, so no panel, dialog
 * or cell popover clips it. Focus selects the text, so typing replaces it. Tab or a click takes
 * it, Esc closes it and keeps the text, and the field's other keys are its caller's. A text that reads as no date shows "Could not read the
 * date" in a live region the field points at.
 */
export function DateInput({
  label,
  value,
  onChange,
  suggestion,
  onAccept,
  unread,
  className,
  anchor: placeUnder,
  noteClassName = '',
  onKeyDown,
  onFocus,
  onBlur,
  ref,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...rest
}: DateInputProps) {
  const id = useId()
  const listId = `${id}-list`
  const optionId = `${id}-option`
  const noteId = `${id}-note`
  const anchor = `--date-${id.replaceAll(/[^a-zA-Z0-9]/g, '')}`
  const popup = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const [focused, setFocused] = useState(false)
  // The text Esc closed the suggestion for; typing changes it, and so does coming back to the field.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const open = focused && suggestion !== null && dismissedFor !== value

  useEffect(() => {
    const element = popup.current
    if (element === null) return
    const shown = element.matches(':popover-open')
    if (open && !shown) element.showPopover()
    else if (!open && shown) element.hidePopover()
  }, [open])

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (open && event.key === 'Escape' && !event.nativeEvent.isComposing) {
      // The field's own Esc, and the cell popover's or the dialog's, wait for the next press.
      event.preventDefault()
      event.stopPropagation()
      setDismissedFor(value)
      return
    }
    if (
      open &&
      event.key === 'Tab' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.nativeEvent.isComposing
    ) {
      // Focus goes on to the next field, with the text already replaced, unless the edit ended.
      if (onAccept(suggestion.text, 'tab', event.currentTarget)) event.preventDefault()
    }
    onKeyDown?.(event)
  }

  return (
    <>
      <input
        {...rest}
        ref={(element) => {
          input.current = element
          if (typeof ref === 'function') ref(element)
          else if (ref) ref.current = element
        }}
        type="text"
        role="combobox"
        data-date-input
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? optionId : undefined}
        aria-describedby={describedBy === undefined ? noteId : `${noteId} ${describedBy}`}
        aria-invalid={unread ? true : invalid}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        onFocus={(event) => {
          // A date is replaced far more often than edited, so typing goes over what the field holds.
          event.currentTarget.select()
          setFocused(true)
          setDismissedFor(null)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
        onKeyDown={onInputKeyDown}
        style={{ anchorName: anchor }}
        className={className}
      />
      <span id={noteId} aria-live="polite" className={`text-danger empty:hidden ${noteClassName}`}>
        {unread ? 'Could not read the date' : ''}
      </span>
      <div
        ref={popup}
        id={listId}
        role="listbox"
        aria-label="Suggested date"
        popover="manual"
        // React lets a toggle reach the parent's `onToggle`, and a `CellPopover` takes it for its own.
        onToggle={(event) => {
          event.stopPropagation()
        }}
        style={{ positionAnchor: placeUnder ?? anchor }}
        className="suggestion"
      >
        {suggestion !== null && (
          // The keyboard takes the suggestion with Tab, so the option needs no key handler of its own.
          <div
            id={optionId}
            role="option"
            aria-selected="true"
            // Focus stays in the field, so a click takes the suggestion without a blur first.
            onMouseDown={(event) => {
              event.preventDefault()
            }}
            onClick={() => {
              if (input.current !== null) onAccept(suggestion.text, 'click', input.current)
            }}
            className="suggestion-option"
          >
            {suggestion.label}
          </div>
        )}
      </div>
    </>
  )
}
