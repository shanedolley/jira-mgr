import { JiraMgrError } from '@jira-mgr/core'
import { readSettings } from '@jira-mgr/core/state'
import {
  elapsedMs,
  worklogDraft,
  type RunningTimer,
  type WorklogDraft,
} from '@jira-mgr/core/timer-calc'

import { localDateTime, renderRecord, type Tty } from '../../output.js'

/** What `status`, `pause`, `resume` and `start` show of a timer. */
export interface TimerStatus {
  issueKey: string
  state: 'running' | 'paused'
  elapsedSeconds: number
  /** What a stop would log now, rounded by the rounding in settings. */
  draft: WorklogDraft
}

export async function describeTimer(timer: RunningTimer, now: Date): Promise<TimerStatus> {
  return {
    issueKey: timer.issueKey,
    state: timer.segments.at(-1)?.end === null ? 'running' : 'paused',
    elapsedSeconds: Math.floor(elapsedMs(timer, now) / 1000),
    draft: worklogDraft(timer, (await readSettings()).timer, now),
  }
}

/** Q55: a long or midnight-crossing timer is never logged unseen. `fix` says how to go on. */
export function confirmationRequired(draft: WorklogDraft, fix: string): JiraMgrError {
  return new JiraMgrError(
    'validation_failed',
    `${draft.issueKey} has run ${draft.timeSpent} since ${localDateTime(draft.started)}, past the reminder threshold or across midnight. ${fix}`,
    { details: { draft } },
  )
}

/**
 * Core refuses a draft that needs confirmation with `details.draft` and no `details.timer`, which
 * only a failed log carries. Gives that refusal the CLI's own message, with `fix` saying how to go
 * on; any other error comes back as it was.
 */
export function withConfirmationHint<E>(
  error: E,
  fix: (draft: WorklogDraft) => string,
): E | JiraMgrError {
  if (error instanceof JiraMgrError && error.code === 'validation_failed') {
    const { draft, timer } = (error.details ?? {}) as { draft?: WorklogDraft; timer?: unknown }
    if (draft !== undefined && timer === undefined) return confirmationRequired(draft, fix(draft))
  }
  return error
}

/** `1h 5m`, or `42m` under an hour, from seconds. */
export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return minutes < 60
    ? `${String(minutes)}m`
    : `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`
}

/** The record `status`, `pause` and `resume` print. */
export function renderStatus(tty: Tty, { issueKey, state, elapsedSeconds, draft }: TimerStatus) {
  return renderRecord(tty, [
    ['Issue', issueKey],
    ['State', state],
    ['Started', localDateTime(draft.started)],
    ['Elapsed', formatElapsed(elapsedSeconds)],
    ['Would log', draft.timeSpent],
    ...(draft.needsConfirmation ? ([['Needs confirmation', 'yes']] as const) : []),
  ])
}
