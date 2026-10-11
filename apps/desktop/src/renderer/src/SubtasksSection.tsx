import type { Issue, JiraMgrError } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'
import { useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'

import type { Notice } from './create'
import { AddAction, Section } from './Section'
import { useAddSubtasks } from './subtaskQueries'
import {
  MAX_NEW_SUBTASKS,
  parentProblem,
  parseTitles,
  progressOf,
  takesSubtasks,
  titlesProblem,
} from './subtasks'

interface SubtasksSectionProps {
  issue: Issue
  /** The page's own read, which holds the subtasks. `undefined` until it lands. */
  detail: IssueDetail | undefined
  /** Why that read failed, which the Description section already reports. */
  detailError: JiraMgrError | null
  onOpen: (key: string) => void
  onNotice: (notice: Notice) => void
}

interface AddSubtasksFormProps {
  parent: Issue
  onNotice: (notice: Notice) => void
  onDone: () => void
}

/**
 * One title per line, a Subtask for each under `parent`, with its Customer and Engagement. A run
 * that stops leaves the title that failed and the ones after it in the box, so Create tries
 * exactly those again.
 */
function AddSubtasksForm({ parent, onNotice, onDone }: AddSubtasksFormProps) {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(0)
  const box = useRef<HTMLTextAreaElement>(null)
  const add = useAddSubtasks(parent, onNotice, setSent)
  const titles = parseTitles(text)
  const problem = parentProblem(parent) ?? titlesProblem(titles)
  const ready = problem === null && titles.length > 0 && !add.isPending
  const count = `${String(titles.length)} sub-issue${titles.length === 1 ? '' : 's'}`

  function submit(event: SyntheticEvent) {
    event.preventDefault()
    if (!ready) return
    setSent(0)
    add.mutate(titles, {
      onSuccess: (result) => {
        if (result.failed === null) {
          onDone()
          return
        }
        setText(result.left.join('\n'))
        // The Create button went disabled under the pointer, so focus fell to the page: bring it back.
        box.current?.focus()
      },
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      event.currentTarget.requestSubmit()
    } else if (event.key === 'Escape') {
      // From anywhere in the form: the page's own Esc leaves the page, this one closes the form (not while a run is under way).
      event.preventDefault()
      event.stopPropagation()
      if (!add.isPending) onDone()
    }
  }

  return (
    <form
      aria-label="Add sub-issues"
      onSubmit={submit}
      onKeyDown={onKeyDown}
      className="space-y-2 rounded-md border border-line p-3"
    >
      <label className="block space-y-0.5">
        <span className="block text-xs text-muted">Titles, one per line</span>
        <textarea
          ref={box}
          autoFocus
          value={text}
          rows={5}
          readOnly={add.isPending}
          placeholder={'Draft the plan\nReview it with the team'}
          onChange={(event) => {
            setText(event.target.value)
          }}
          className="w-full resize-y rounded-md border border-field-border bg-panel px-2 py-1 text-ink"
        />
      </label>
      {problem !== null && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!ready} className="btn btn-primary">
          {add.isPending
            ? `Creating ${String(sent)} of ${String(titles.length)}`
            : titles.length === 0
              ? 'Create'
              : `Create ${count}`}
        </button>
        <button type="button" disabled={add.isPending} onClick={onDone} className="btn">
          Cancel
        </button>
        <span className="ml-auto text-xs text-muted">
          Under {parent.key}, up to {String(MAX_NEW_SUBTASKS)} at a time
        </span>
      </div>
    </form>
  )
}

/**
 * The page's Subtasks section: the count of done over all in the heading, a "+" that opens the
 * add form, and each Subtask as a row. An Epic takes none and a Subtask cannot hold one, so those
 * pages show the section only if the issue somehow has subtasks, and never the "+".
 */
export function SubtasksSection({
  issue,
  detail,
  detailError,
  onOpen,
  onNotice,
}: SubtasksSectionProps) {
  const [adding, setAdding] = useState(false)
  const subtasks = detail?.subtasks ?? []
  const addable = takesSubtasks(issue)
  if (!addable && subtasks.length === 0) return null
  const { done, total } = progressOf(subtasks)
  return (
    <Section
      title="Subtasks"
      plain
      actions={
        <>
          {total > 0 && (
            <span className="text-xs tabular-nums text-muted">
              {done}/{total}
              <span className="sr-only"> done</span>
            </span>
          )}
          {addable && !adding && (
            <AddAction
              label="Add sub-issue"
              onClick={() => {
                setAdding(true)
              }}
            />
          )}
        </>
      }
    >
      {adding && (
        <AddSubtasksForm
          parent={issue}
          onNotice={onNotice}
          onDone={() => {
            setAdding(false)
          }}
        />
      )}
      {detail === undefined && detailError === null && (
        <p className="text-muted">Loading subtasks</p>
      )}
      {detail !== undefined && total === 0 && !adding && <p className="text-muted">No subtasks</p>}
      {total > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {subtasks.map((subtask) => (
            <li key={subtask.key}>
              <button
                type="button"
                onClick={() => {
                  onOpen(subtask.key)
                }}
                data-row
                className="flex h-8 w-full items-center gap-3 px-3 text-left hover:bg-hover"
              >
                <span className="w-20 shrink-0 font-mono text-xs text-muted">{subtask.key}</span>
                <span className="min-w-0 flex-1 truncate">{subtask.summary}</span>
                <span className="shrink-0 text-xs text-muted">{subtask.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
