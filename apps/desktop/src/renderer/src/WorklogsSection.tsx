import { formatEstimate } from '@jira-mgr/core/issue'
import { useState, type SyntheticEvent, type KeyboardEvent } from 'react'

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
import { BUTTON, DANGER_BUTTON, FIELD, PRIMARY_BUTTON, QueryBody, Section } from './Section'

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
}

/** The form that logs work or changes a worklog. It stays open and keeps its text when Jira refuses. */
function WorklogFormRow({
  name,
  submitLabel,
  initial,
  hadComment,
  onSubmit,
  onCancel,
}: WorklogFormRowProps) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const request = readWorklogForm(form, hadComment)

  async function submit(event: SyntheticEvent) {
    event.preventDefault()
    if (!request.ok) {
      setProblem(request.message)
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
      setProblem(`Could not save the worklog. ${error instanceof Error ? error.message : ''}`)
      setSaving(false)
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }

  const field = (key: keyof WorklogForm) => (value: string) => {
    setForm((held) => ({ ...held, [key]: value }))
  }

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
            onChange={(event) => {
              field('timeSpent')(event.target.value)
            }}
            className={`${FIELD} w-28`}
          />
        </label>
        <label className="space-y-0.5">
          <span className="block text-xs text-muted">Started</span>
          <input
            type="datetime-local"
            value={form.started}
            disabled={saving}
            onChange={(event) => {
              field('started')(event.target.value)
            }}
            className={FIELD}
          />
        </label>
        <label className="min-w-40 flex-1 space-y-0.5">
          <span className="block text-xs text-muted">Comment</span>
          <input
            value={form.comment}
            disabled={saving}
            onChange={(event) => {
              field('comment')(event.target.value)
            }}
            className={`${FIELD} w-full`}
          />
        </label>
      </div>
      <p className="text-xs text-muted">Reduces Time remaining by the time logged.</p>
      {problem !== null && (
        <p role="alert" className="text-danger">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={!request.ok || saving} className={PRIMARY_BUTTON}>
          {saving ? 'Saving' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={BUTTON}>
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
}

function WorklogRow({
  worklog,
  mine,
  editing,
  onEdit,
  onDone,
  issueKey,
  onNotice,
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
          hadComment={worklog.comment !== null}
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
            onDone()
          }}
          onCancel={onDone}
        />
      </li>
    )
  }

  function deleteWorklog() {
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
    <li className="space-y-1 py-1">
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
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onEdit} className={BUTTON}>
              Edit worklog
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(true)
              }}
              className={BUTTON}
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
            setConfirming(false)
          }}
          className="flex items-center gap-2 text-xs"
        >
          <span>Delete this worklog? Its time returns to Time remaining.</span>
          <button type="button" onClick={deleteWorklog} className={DANGER_BUTTON}>
            Delete
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              setConfirming(false)
            }}
            className={BUTTON}
          >
            Keep
          </button>
        </div>
      )}
    </li>
  )
}

/** The Worklogs section: who logged what, with add, edit and delete for the signed-in user's own. */
export function WorklogsSection({ issueKey, me, onNotice }: WorklogsSectionProps) {
  const worklogs = useWorklogs(issueKey)
  const add = useAddWorklog(issueKey)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
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
            <button
              type="button"
              onClick={() => {
                setAdding(true)
              }}
              className={`${BUTTON} ml-auto`}
            >
              Add worklog
            </button>
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
      <QueryBody query={worklogs} loading="Loading worklogs">
        {(list) =>
          list.length === 0 ? (
            !adding && <p className="text-muted">No work logged</p>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((worklog) => (
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
                />
              ))}
            </ul>
          )
        }
      </QueryBody>
    </Section>
  )
}
