import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import { Icon } from './Icon'
import { Kbd, Keys } from './Kbd'
import { Modal } from './Modal'
import {
  SHORTCUT_TABLES,
  filterShortcuts,
  shortcutCells,
  splitMarks,
  type ShortcutMatch,
} from './shortcuts'

const POINTER = 'M4 2.5v9l2.5-2 1.5 3.5 1.5-.7-1.5-3.3H11z'

/**
 * A mouse gesture: "Double-click", "Click" or "Click on a status dot", or the page's `Shift+click`
 * and `Cmd+click`, which may carry the off-macOS form in a parenthesis.
 */
const GESTURE =
  /^(?:`(Shift|Cmd)\+click`( \(`Ctrl\+click` off macOS\))?|(Double-click|Click)(?: on (.+))?)$/

/** The first sentence of `action`, and the rest. A full stop inside a keycap does not end it. */
function splitSentence(action: string): [string, string] {
  for (const end of action.matchAll(/[.!?]\s+(?=\S)/g)) {
    const first = action.slice(0, end.index + 1)
    if (first.split('`').length % 2 === 1) return [first, action.slice(end.index + end[0].length)]
  }
  return [action, '']
}

function Pointer({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[18px] items-center gap-1 rounded-full border border-line bg-hover px-2 text-[11px] leading-none text-muted">
      <Icon path={POINTER} className="size-2.5" />
      {children}
    </span>
  )
}

/** A row's keys as keycaps, or a pointer pill for a mouse gesture; a screen reader hears the plain words. */
function KeyGroup({ keys, gesture }: { keys: string; gesture: RegExpExecArray | null }) {
  const spoken = keys.replaceAll('`', '').replaceAll('+', ' ')
  return (
    <>
      <span className="sr-only">{spoken}</span>
      <span aria-hidden className="text-muted leading-[22px]">
        {gesture === null ? (
          <Keys text={keys} />
        ) : gesture[1] !== undefined ? (
          <>
            <Pointer>
              <Kbd>{gesture[1] === 'Shift' ? '⇧' : '⌘'}</Kbd>click
            </Pointer>
            {gesture[2]?.replaceAll('`', '')}
          </>
        ) : (
          <Pointer>{gesture[3]}</Pointer>
        )}
      </span>
    </>
  )
}

function Row({
  table,
  row,
  query,
}: {
  table: ShortcutMatch
  row: readonly string[]
  query: string
}) {
  const { where, keys, action } = shortcutCells(table, row)
  const gesture = GESTURE.exec(keys)
  const lead = gesture?.[4] !== undefined ? `On ${gesture[4]}` : where
  const [first, rest] = splitSentence(action)
  const mark = (part: string) =>
    splitMarks(part, query).map((run, at) =>
      run.hit ? (
        <mark key={at} className="rounded-sm bg-selected text-ink">
          {run.text}
        </mark>
      ) : (
        <Fragment key={at}>{run.text}</Fragment>
      ),
    )
  return (
    <tr className="border-t border-line first:border-t-0">
      <td className="w-[38%] py-[5px] pr-3 align-top">
        <KeyGroup keys={keys} gesture={gesture} />
      </td>
      <td className="py-[5px] align-top text-[13px] leading-[18px]">
        {lead !== '' && <span className="text-muted">{mark(lead)}: </span>}
        <span className="text-ink">
          <Keys text={first} plain={mark} />
        </span>
        {rest !== '' && (
          <span className="block text-xs leading-4 text-muted">
            <Keys text={rest} plain={mark} />
          </span>
        )}
      </td>
    </tr>
  )
}

const plural = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? '' : 's'}`

interface ShortcutHelpProps {
  onClose: () => void
  returnFocus: () => void
}

/**
 * The `?` overlay: every table of `docs/reference/shortcuts.md`, drawn with keycaps, with a search
 * field that filters the rows in place. A modal, so Esc closes it (after clearing the field) and
 * focus goes back to where it was.
 */
export function ShortcutHelp({ onClose, returnFocus }: ShortcutHelpProps) {
  const titleId = useId()
  const headingId = useId()
  const field = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  // After the Modal's own effect has opened the dialog, which a field cannot take focus before.
  useEffect(() => {
    field.current?.focus()
  }, [])
  const shown = useMemo(() => filterShortcuts(SHORTCUT_TABLES, query), [query])
  const count = shown.reduce((n, table) => n + table.rows.length, 0)
  const searching = query.trim() !== ''
  const clear = () => {
    setQuery('')
    field.current?.focus()
  }
  return (
    <Modal
      titleId={titleId}
      onClose={() => {
        // Esc from anywhere in the dialog: clear the search first, then close.
        if (query === '') onClose()
        else clear()
      }}
      returnFocus={returnFocus}
      className="w-[min(60rem,calc(100vw-2rem))]"
    >
      <header className="sticky top-0 z-10 border-b border-line bg-panel px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="font-semibold">
            Keyboard shortcuts
          </h2>
          <button type="button" onClick={onClose} className="btn btn-sm gap-2">
            Close
            <Kbd aria-hidden>Esc</Kbd>
          </button>
        </div>
        <input
          ref={field}
          type="search"
          aria-label="Search shortcuts"
          placeholder="Search shortcuts"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing && query !== '') {
              event.preventDefault()
              clear()
            }
          }}
          className="mt-3 h-8 w-full rounded-md border border-line bg-panel px-3 text-[13px]"
        />
        <p role="status" className="sr-only">
          {plural(count, 'shortcut')} in {plural(shown.length, 'section')}
        </p>
      </header>
      {shown.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted">
          <p>{`No shortcut matches '${query}'`}</p>
          <button type="button" onClick={clear} className="btn btn-sm mt-3">
            Clear search
          </button>
        </div>
      ) : (
        <div className="min-h-[24rem] columns-1 gap-x-10 p-4 md:columns-2">
          {shown.map((table, at) => (
            <div key={table.title} className="mb-6 break-inside-avoid">
              <h3 className="pb-1 text-[13px] font-semibold text-ink">
                <span id={`${headingId}${String(at)}`}>{table.title}</span>{' '}
                <span className="text-xs font-normal text-muted">
                  {searching
                    ? `${String(table.rows.length)} of ${String(table.total)}`
                    : String(table.total)}
                </span>
              </h3>
              <table
                aria-labelledby={`${headingId}${String(at)}`}
                className="w-full border-collapse text-left"
              >
                <thead className="sr-only">
                  <tr>
                    <th>Keys</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <Row key={row.join('|')} table={table} row={row} query={query} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      <p className="border-t border-line px-4 py-2 text-xs text-muted">
        Ctrl stands in for ⌘ off the Mac.
      </p>
    </Modal>
  )
}
