import { useId } from 'react'

import { Kbd, Keys } from './Kbd'
import { Modal } from './Modal'
import { SHORTCUT_TABLES } from './shortcuts'

interface ShortcutHelpProps {
  onClose: () => void
  returnFocus: () => void
}

/**
 * The `?` overlay: every table of `docs/reference/shortcuts.md`, drawn with keycaps. A modal, so
 * Esc closes it and focus goes back to where it was.
 */
export function ShortcutHelp({ onClose, returnFocus }: ShortcutHelpProps) {
  const titleId = useId()
  return (
    <Modal
      titleId={titleId}
      onClose={onClose}
      returnFocus={returnFocus}
      className="w-[min(44rem,calc(100vw-2rem))]"
    >
      <header className="sticky top-0 flex items-center justify-between border-b border-line bg-panel px-4 py-3">
        <h2 id={titleId} className="font-semibold">
          Keyboard shortcuts
        </h2>
        <button type="button" onClick={onClose} className="btn btn-sm gap-2">
          Close
          <Kbd aria-hidden>Esc</Kbd>
        </button>
      </header>
      <div className="space-y-5 p-4">
        {SHORTCUT_TABLES.map((table) => (
          <section key={table.title} aria-label={table.title}>
            <h3 className="pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
              {table.title}
            </h3>
            <table className="w-full border-collapse text-left">
              <thead className="sr-only">
                <tr>
                  {table.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.join('|')} className="border-t border-line first:border-t-0">
                    {row.map((cell, at) => (
                      <td
                        key={table.columns[at]}
                        className={`py-1.5 pr-4 align-top ${at < table.columns.length - 1 ? 'whitespace-nowrap' : ''}`}
                      >
                        <Keys text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">
        Ctrl stands in for ⌘ off the Mac.
      </p>
    </Modal>
  )
}
