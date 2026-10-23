import { formatEstimate } from '@jira-mgr/core/issue'
import { useId, useState, type SyntheticEvent, type KeyboardEvent } from 'react'

import type { CurrentUser, WorklogItem } from '../../shared/ipc'
import {
  blankWorklog,
  failureNotice,
  formatWhen,
  readWorklogForm,
  textFromAdf,
  toInputTime,
  totalSpent,
  worklogForm,
  type WorklogForm,
} from './activity'
import {
  useAddWorklog,
  useDeleteWorklog,
  useEditWorklog,
  useWorklogs,
  type WorklogInput,
} from './activityQueries'
import type { Notice } from './create'
import { submitOnModEnter } from './modEnter'
import { AddAction, FIELD, QueryBody, Section } from './Section'

interface WorklogsSectionProps {
  issueKey: string
  me: CurrentUser | undefined
  onNotice: (notice: Notice) => void
}

interface WorklogFormRowProps {
  /** `Add worklog` or `Edit worklog`: the form's accessible name. */
  name: string
  submitLabel: string
  initial: WorklogForm
  /** An edit cannot clear a comment, so an emptied one is refused. */
  hadComment: boolean
  /** Sends the request. A rejection keeps the form open with the message. */
  onSubmit: (request: WorklogInput) => Promise<unknown>
  onCancel: () => void
  /** A modal sets this: Esc does nothing while the request is in flight. The Peek's form still cancels. */
  holdEscapeWhileSaving?: boolean
}

/**
 * The form that logs work or changes a worklog. A new worklog takes a date and starts at the time
 * of day when it is logged; an edit keeps the full start. The form stays open and keeps its text
 * when the input is refused or Jira refuses.
 */
export function WorklogFormRow({
  name,
  submitLabel,
  initial,
  hadComment,
  onSubmit,
  onCancel,
  holdEscapeWhileSaving = false,
}: WorklogFormRowProps) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<{ message: string; field?: keyof WorklogForm } | null>(
    null,
  )
  const problemId = useId()
  const dateOnly = !initial.started.includes('T')

  async function submit(event: SyntheticEvent) {
    event.preventDefault()
    const request = readWorklogForm(form, hadComment)
    if (!request.ok) {
      setProblem({ message: request.message, field: request.field })
      return
    }
    setSaving(true)
    setProblem(null)
    try {
      await onSubmit({
        timeSpent: request.timeSpent,
        started: request.started,
        comment: request.comment,
      })
    } catch (error) {
      setProblem({
        message: `Could not save the worklog. ${error instanceof Error ? error.message : ''}`,
      })
      setSaving(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    submitOnModEnter(event)
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (saving && holdEscapeWhileSaving) return
    onCancel()
  }

  const field = (key: keyof WorklogForm) => (value: string) => {
    setForm((held) => ({ ...held, [key]: value }))
    setProblem((held) => (held?.field === key ? null : held))
  }
  const invalid = (key: keyof WorklogForm) => (problem?.field === key ? true : undefined)
  const described = (key: keyof WorklogForm) => (problem?.field === key ? problemId : undefined)

  return (
    <form
      aria-label={name}
      onSubmit={(event) => void submit(event)}
      onKeyDown={onKeyDown}
      className="space-y-2 rounded-md border border-line p-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-0.5">
          <span className="block text-xs text-muted">Time spent</span>
          <input
            autoFocus
            value={form.timeSpent}
            placeholder="1h 30m"
            disabled={saving}
            aria-invalid={invalid('timeSpent')}
            aria-describedby={described('timeSpent')}
            onChange={(event) => {
              field('timeSpent')(event.target.value)
            }}
            className={`${FIELD} w-28 aria-invalid:border-danger`}
          />
        </label>
        <label className="space-y-0.5">
          <span className="block text-xs text-muted">Started</span>
          <input
            type={dateOnly ? 'date' : 'datetime-local'}
            value={form.started}
            disabled={saving}
            aria-invalid={invalid('started')}
            aria-describedby={described('started')}
            onChange={(event) => {
              field('started')(event.target.value)
            }}
            className={`${FIELD} aria-invalid:border-danger`}
          />
        </label>
        <label className="min-w-40 flex-1 space-y-0.5">
          <span className="block text-xs text-muted">Comment</span>
          <input
            value={form.comment}
            disabled={saving}
            aria-invalid={invalid('comment')}
            aria-describedby={described('comment')}
            onChange={(event) => {
              field('comment')(event.target.value)
            }}
            className={`${FIELD} w-full aria-invalid:border-danger`}
          />
        </label>
      </div>
      <p className="text-xs text-muted">Reduces Time remaining by the time logged.</p>
      {problem !== null && (
        <p role="alert" id={problemId} className="text-danger">
          {problem.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="btn btn-primary">
          {saving ? 'Saving' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="btn">
          Cancel
        </button>
      </div>
    </form>
  )
}

interface WorklogRowProps {
  worklog: WorklogItem
  mine: boolean
  editing: boolean
  onEdit: () => void
  onDone: () => void
  issueKey: string
  onNotice: (notice: Notice) => void
  /** Runs when an action on the row ends and the control that had focus is about to go. */
  onSettled?: () => void
}

function WorklogRow({
  worklog,
  mine,
  editing,
  onEdit,
  onDone,
  issueKey,
  onNotice,
  onSettled,
}: WorklogRowProps) {
  const [confirming, setConfirming] = useState(false)
  const edit = useEditWorklog(issueKey)
  const remove = useDeleteWorklog(issueKey)
  const who = worklog.author?.displayName ?? 'Unknown user'
  const note = textFromAdf(worklog.comment)

  if (editing) {
    return (
      <li>
        <WorklogFormRow
          name="Edit worklog"
          submitLabel="Save"
          initial={worklogForm(worklog)}
          hadComment={note !== ''}
          onSubmit={async (input) => {
            // Only what changed is sent, so an untouched start keeps its seconds.
            const changes = {
              ...(input.timeSpent !== worklog.timeSpent && { timeSpent: input.timeSpent }),
              ...(toInputTime(input.started ?? worklog.started) !==
                toInputTime(worklog.started) && { started: input.started }),
              ...(textFromAdf(input.comment ?? null) !== note && { comment: input.comment }),
            }
            if (Object.keys(changes).length > 0) {
              await edit.mutateAsync({ worklogId: worklog.id, ...changes })
            }
            onSettled?.()
            onDone()
          }}
          onCancel={() => {
            onSettled?.()
            onDone()
          }}
        />
      </li>
    )
  }

  function deleteWorklog() {
    onSettled?.()
    setConfirming(false)
    remove.mutateAsync(worklog.id).catch((error: unknown) => {
      onNotice(
        failureNotice(
          'Could not delete the worklog',
          error instanceof Error ? error.message : String(error),
        ),
      )
    })
  }

  return (
    <li className="group/row space-y-1 py-1">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="font-medium">{who}</span>
        <span className="text-muted">logged</span>
        <span className="font-medium">{worklog.timeSpent}</span>
        <span aria-hidden className="text-muted">
          &middot;
        </span>
        <time dateTime={worklog.started} className="text-xs text-muted">
          {formatWhen(worklog.started)}
        </time>
        {mine && !confirming && (
          <span className="ml-auto flex gap-1 self-center opacity-0 focus-within:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
            <button type="button" onClick={onEdit} className="btn btn-sm btn-ghost">
              Edit worklog
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(true)
              }}
              className="btn btn-sm btn-ghost btn-delete"
            >
              Delete worklog
            </button>
          </span>
        )}
      </div>
      {note !== '' && <p className="whitespace-pre-wrap break-words text-muted">{note}</p>}
      {confirming && (
        <div
          role="group"
          aria-label="Delete worklog"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            onSettled?.()
            setConfirming(false)
          }}
          className="flex flex-wrap items-center gap-2 text-xs"
        >
          <span>Delete this worklog? Its time returns to Time remaining.</span>
          <button type="button" onClick={deleteWorklog} className="btn btn-sm btn-danger">
            Delete
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              onSettled?.()
              setConfirming(false)
            }}
            className="btn btn-sm"
          >
            Keep
          </button>
        </div>
      )}
    </li>
  )
}

interface WorklogListProps extends WorklogsSectionProps {
  worklogs: readonly WorklogItem[]
  /** Extra classes on the `<ul>`, such as the ones that let a modal scroll it. */
  className?: string
  /** A modal sets this to take focus back from a row control that an action is about to remove. */
  onSettled?: () => void
}

/** The rows of a worklog list, in the order given, with one row in edit at a time. */
export function WorklogList({
  worklogs,
  issueKey,
  me,
  onNotice,
  className = '',
  onSettled,
}: WorklogListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  return (
    <ul className={`divide-y divide-line ${className}`}>
      {worklogs.map((worklog) => (
        <WorklogRow
          key={worklog.id}
          worklog={worklog}
          issueKey={issueKey}
          mine={me !== undefined && worklog.author?.accountId === me.accountId}
          editing={editingId === worklog.id}
          onEdit={() => {
            setEditingId(worklog.id)
          }}
          onDone={() => {
            setEditingId(null)
          }}
          onNotice={onNotice}
          onSettled={onSettled}
        />
      ))}
    </ul>
  )
}

/** The Worklogs section: who logged what, with add, edit and delete for the signed-in user's own. */
export function WorklogsSection({ issueKey, me, onNotice }: WorklogsSectionProps) {
  const worklogs = useWorklogs(issueKey)
  const add = useAddWorklog(issueKey)
  const [adding, setAdding] = useState(false)
  const total = worklogs.data === undefined ? null : totalSpent(worklogs.data)
  return (
    <Section
      title="Worklogs"
      actions={
        <>
          {total !== null && total > 0 && (
            <span className="text-xs text-muted">Logged {formatEstimate(total)}</span>
          )}
          {!adding && (
            <AddAction
              label="Add worklog"
              onClick={() => {
                setAdding(true)
              }}
            />
          )}
        </>
      }
    >
      {adding && (
        <WorklogFormRow
          name="Add worklog"
          submitLabel="Log work"
          initial={blankWorklog()}
          hadComment={false}
          onSubmit={async (input) => {
            await add.mutateAsync(input)
            setAdding(false)
          }}
          onCancel={() => {
            setAdding(false)
          }}
        />
      )}
      <QueryBody query={worklogs} loading="Loading worklogs" what="the worklogs">
        {(list) =>
          list.length === 0 ? (
            !adding && <p className="text-muted">No work logged</p>
          ) : (
            <WorklogList worklogs={list} issueKey={issueKey} me={me} onNotice={onNotice} />
          )
        }
      </QueryBody>
    </Section>
  )
}
