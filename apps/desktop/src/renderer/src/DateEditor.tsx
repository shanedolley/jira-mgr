import type { Issue } from '@jira-mgr/core'
import { useRef } from 'react'

import type { CellMode } from './cell'
import { closePopover, CellPopover } from './CellPopover'
import { TextField } from './IssueProperties'
import { useNotify } from './notify'
import { useIssueChange } from './PropertyPickers'
import { datePatch } from './properties'

interface DateEditorProps {
  issue: Issue
  /** The date the editor sets: the due date or the start date. */
  field: 'startDate' | 'dueDate'
  /** Names the popover and the field, and the property in a refusal toast: "Due date". */
  label: string
  cell: CellMode
}

/**
 * The cell editor for a date: the date field and write path of the Peek (`TextField`), in a
 * `CellPopover` with a Clear button. The field takes a phrase such as `next tuesday` or
 * `dd/mm/yyyy`, shows the day it means, and saves on Enter or when focus leaves it. Enter closes
 * the popover, except on a phrase the field cannot read, which stays with its message. Nothing is
 * sent while the phrase is typed. Esc drops the draft and closes. A popover that closes some other
 * way, such as a scroll, sends a changed draft as it goes, or drops one it cannot read and says so
 * in a toast.
 */
export function DateEditor({ issue, field, label, cell }: DateEditorProps) {
  const change = useIssueChange(issue)
  const notify = useNotify()
  const date = issue[field] ?? ''
  // Set by Clear, or by Esc on it, so the draft left in the field is not sent as the editor goes.
  const cleared = useRef(false)
  const send = (draft: string) => {
    if (cleared.current) return
    const patch = datePatch(field, draft)
    change(label, patch, patch)
  }
  return (
    <CellPopover cell={cell} label={label}>
      <div
        className="flex flex-col gap-1"
        // Esc on Clear closes the editor while the field still holds its draft; the field's own Esc drops it.
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape' && event.target instanceof HTMLButtonElement)
            cleared.current = true
        }}
        // Tab to Clear leaves the field with its draft, which Clear then replaces: no write between.
        onBlurCapture={(event) => {
          if (event.relatedTarget instanceof Element && event.relatedTarget.matches('[data-clear]'))
            event.stopPropagation()
        }}
        onKeyDown={(event) => {
          // After the field's own Enter has saved.
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
            closePopover(event.currentTarget)
        }}
      >
        <TextField
          label={label}
          type="date"
          value={date}
          autofocus
          commitOnUnmount
          onCommit={send}
          onUnreadable={(draft) => {
            // Clear and Esc on it drop the draft on purpose; any other close would lose it unheard.
            if (!cleared.current) {
              notify({
                title: `${label} not changed`,
                notes: [`Could not read "${draft}" as a date.`],
                warned: true,
              })
            }
          }}
        />
        {date !== '' && (
          <button
            type="button"
            data-clear
            className="btn btn-sm"
            onClick={(event) => {
              send('')
              cleared.current = true
              closePopover(event.currentTarget)
            }}
          >
            Clear
          </button>
        )}
      </div>
    </CellPopover>
  )
}
