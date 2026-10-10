import type { Issue } from '@jira-mgr/core'
import { DURATION_PATTERN } from '@jira-mgr/core/issue'
import { elapsedMs, worklogDraft } from '@jira-mgr/core/timer-calc'
import { useState, type SyntheticEvent } from 'react'

import type { StopTimerArgs, TimerOutcome, TimerSnapshot } from '../../shared/ipc'
import { adfFromText, formatWhen } from './activity'
import type { Notice } from './create'
import { Modal } from './Modal'
import { BUTTON, FIELD } from './Section'
import { formatClock } from './timer'
import { useNow } from './TimerClock'
import { useStopTimer, useSwitchTimer } from './timerQueries'

interface TimerDialogProps {
  /** The timer file as it was when the dialog opened. A timer the CLI changed since is refused, not logged. */
  snapshot: TimerSnapshot & { timer: NonNullable<TimerSnapshot['timer']> }
  /** The issue a switch starts on, or `null` for a plain stop. */
  to: Issue | null
  onClose: () => void
  /** The call went through; the caller closes the dialog and shows the notice. */
  onDone: (notice: Notice) => void
  returnFocus: () => void
}

/** What the toast says once the dialog's call went through. */
function outcomeNotice({ stopped, logged }: TimerOutcome, to: Issue | null): Notice {
  const next = to === null ? [] : [`Started the timer on ${to.key}`]
  if (stopped === null)
    return { title: 'The timer had already stopped', notes: next, warned: false }
  return {
    title:
      logged === null
        ? `Discarded the timer on ${stopped.issueKey}`
        : `Logged ${logged.timeSpent} on ${stopped.issueKey}`,
    notes: logged === null ? [`${stopped.timeSpent} not logged`, ...next] : next,
    warned: false,
  }
}

/**
 * The stop dialog, and with `to` the switch dialog (Q51, Q59): the running timer's time and start,
 * to adjust, comment on, log or discard. A switch starts the new timer once the old one is logged
 * or discarded. A timer past the threshold or across midnight shows a warning and asks to
 * "Confirm and log" (Q55); the core refuses to log it unseen, so the warning and the refusal agree.
 */
export function TimerDialog({ snapshot, to, onClose, onDone, returnFocus }: TimerDialogProps) {
  const { timer, settings } = snapshot
  const stop = useStopTimer()
  const swap = useSwitchTimer()
  const pending = stop.isPending || swap.isPending
  const failure = stop.error ?? swap.error
  const now = useNow()
  // The time to log is fixed when the dialog opens, so it holds still while the user edits it.
  const [opened] = useState(() => worklogDraft(timer, settings, new Date()))
  const flagged = worklogDraft(timer, settings, now).needsConfirmation
  const [timeSpent, setTimeSpent] = useState(opened.timeSpent)
  const [comment, setComment] = useState('')
  const validTime = DURATION_PATTERN.test(timeSpent.trim())

  function send(args: StopTimerArgs) {
    const done = {
      onSuccess: (outcome: TimerOutcome) => {
        onDone(outcomeNotice(outcome, to))
      },
    }
    if (to === null) stop.mutate(args, done)
    else swap.mutate({ ...args, key: to.key }, done)
  }

  function log(event: SyntheticEvent) {
    event.preventDefault()
    if (!validTime || pending) return
    const note = adfFromText(comment)
    send({
      expectRunning: timer.issueKey,
      // An untouched time is the timer's own, which core rounds and checks when it stops.
      ...(timeSpent.trim() !== opened.timeSpent && { timeSpent: timeSpent.trim() }),
      ...(note !== null && { comment: note }),
      ...(flagged && { confirm: true }),
    })
  }

  const start = to === null ? '' : ` and start ${to.key}`
  const logLabel = flagged ? `Confirm, log${start}` : `Log${start}`
  return (
    <Modal
      titleId="timer-title"
      onClose={onClose}
      returnFocus={returnFocus}
      className="w-[min(28rem,calc(100vw-2rem))]"
    >
      <form aria-label="Timer" onSubmit={log} className="space-y-3 p-5">
        <div className="space-y-0.5">
          <h2 id="timer-title" className="text-base font-semibold">
            {to === null ? `Stop the timer on ${timer.issueKey}` : `Switch to ${to.key}`}
          </h2>
          {to !== null && (
            <p className="text-muted">The timer on {timer.issueKey} stops first. Log its time.</p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-muted">
          <dt>Started</dt>
          <dd className="text-ink">{formatWhen(opened.started)}</dd>
          <dt>Elapsed</dt>
          <dd className="font-mono tabular-nums text-ink">{formatClock(elapsedMs(timer, now))}</dd>
        </dl>
        {flagged && (
          <p role="note" className="rounded-md border border-line bg-hover px-3 py-2">
            <span className="font-medium">This timer has run a long time or across midnight.</span>{' '}
            Check the time before you log it.
          </p>
        )}
        <label className="block space-y-0.5">
          <span className="block text-xs text-muted">Time spent</span>
          <input
            autoFocus
            value={timeSpent}
            placeholder="1h 30m"
            disabled={pending}
            onChange={(event) => {
              setTimeSpent(event.target.value)
            }}
            className={`${FIELD} w-32`}
          />
        </label>
        <label className="block space-y-0.5">
          <span className="block text-xs text-muted">Comment</span>
          <textarea
            value={comment}
            rows={3}
            disabled={pending}
            onChange={(event) => {
              setComment(event.target.value)
            }}
            className="w-full rounded-md border border-field-border bg-panel px-2 py-1 text-ink"
          />
        </label>
        {!validTime && (
          <p role="alert" className="text-danger">
            Time spent must be a duration such as 1h 30m.
          </p>
        )}
        {failure !== null && (
          <p role="alert" className="text-danger">
            {failure.message}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" disabled={pending} onClick={onClose} className={BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              send({ expectRunning: timer.issueKey, discard: true })
            }}
            className="rounded-md border border-danger px-3 py-1 text-danger hover:bg-hover disabled:opacity-60"
          >
            {`Discard${start}`}
          </button>
          <button
            type="submit"
            disabled={!validTime || pending}
            className="rounded-md bg-accent px-3 py-1 font-medium text-accent-ink disabled:opacity-50"
          >
            {to === null && flagged ? 'Confirm and log' : logLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
