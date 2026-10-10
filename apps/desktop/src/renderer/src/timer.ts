import type { RunningTimer } from '@jira-mgr/core/timer-calc'

/** What `T` does on an issue, given the timer file: start one, open the stop dialog, or open the switch dialog. */
export type TimerPress = 'start' | 'stop' | 'switch'

export function pressOf(timer: RunningTimer | null, issueKey: string): TimerPress {
  if (timer === null) return 'start'
  return timer.issueKey === issueKey ? 'stop' : 'switch'
}

/** True when the last segment is closed: `jm timer pause` ran. */
export const isPaused = (timer: RunningTimer): boolean => timer.segments.at(-1)?.end !== null

const two = (n: number) => String(n).padStart(2, '0')

/** Elapsed time as a clock: `4:05` under an hour, `1:04:05` after. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${String(h)}:${two(m)}:${two(s)}` : `${String(m)}:${two(s)}`
}
