import type { Issue } from '@jira-mgr/core'

import type { CellMode } from './cell'
import { closePopover, CellPopover } from './CellPopover'
import { TextField } from './IssueProperties'
import { useIssueChange } from './PropertyPickers'
import { datePatch } from './properties'

interface DateCellProps {
  issue: Issue
  /** The date the editor sets: `#271` reuses it for `startDate`. */
  field: 'startDate' | 'dueDate'
  /** Names the popover and the field, and the property in a refusal toast: "Due date". */
  label: string
  cell: CellMode
}

/**
 * The cell editor for a date: the native date field and write path of the Peek (`TextField`), in
 * a `CellPopover` with a Clear button. The field saves on Enter or when focus leaves it, and
 * Enter closes the popover. A date typed digit by digit is not sent until then: the browser
 * reports a valid date after every digit of the year. Esc drops the draft and closes.
 */
export function DateCell({ issue, field, label, cell }: DateCellProps) {
  const change = useIssueChange(issue)
  const date = issue[field] ?? ''
  const send = (draft: string) => {
    const patch = datePatch(field, draft)
    change(label, patch, patch)
  }
  return (
    <CellPopover cell={cell} label={label}>
      <div
        className="flex flex-col gap-1"
        onKeyDown={(event) => {
          // After the field's own Enter has saved.
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
            closePopover(event.currentTarget)
        }}
      >
        <TextField key={date} label={label} type="date" value={date} autofocus onCommit={send} />
        {date !== '' && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={(event) => {
              send('')
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
