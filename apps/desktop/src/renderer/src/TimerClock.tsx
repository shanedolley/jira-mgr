import { elapsedMs } from '@jira-mgr/core/timer-calc'
import { useSyncExternalStore } from 'react'

import { formatClock, isPaused } from './timer'
import { useTimer } from './timerQueries'

/** One shared second tick, started by the first clock on screen and stopped with the last. */
const listeners = new Set<() => void>()
let tick: ReturnType<typeof setInterval> | undefined
let now = Date.now()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    now = Date.now()
    tick = setInterval(() => {
      now = Date.now()
      for (const l of listeners) l()
    }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) clearInterval(tick)
  }
}

/** The time now, renewed every second while a component uses it. */
export function useNow(): Date {
  return new Date(useSyncExternalStore(subscribe, () => now))
}

/**
 * The running timer's elapsed time as a clock, or nothing when none runs or it runs on another
 * issue than `issueKey`. Leave `issueKey` out to show whichever timer runs.
 */
export function TimerClock({ issueKey, className }: { issueKey?: string; className?: string }) {
  const timer = useTimer().data?.timer ?? null
  const at = useNow()
  if (timer === null || (issueKey !== undefined && timer.issueKey !== issueKey)) return null
  const paused = isPaused(timer)
  return (
    <span
      data-timer-clock
      title={paused ? 'Timer paused' : 'Timer running'}
      className={`font-mono text-xs tabular-nums ${paused ? 'text-muted' : 'text-accent'} ${className ?? ''}`}
    >
      {formatClock(elapsedMs(timer, at))}
      {paused && <span className="sr-only"> paused</span>}
    </span>
  )
}
