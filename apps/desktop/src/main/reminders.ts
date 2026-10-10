import { readSettings, readTimer } from '@jira-mgr/core/state'
import { reminderDue, worklogDraft } from '@jira-mgr/core/timer-calc'

/** How often the app looks at the timer. A reminder is due at most once a minute, so 30 s never misses one by more. */
export const REMINDER_CHECK_MS = 30_000

export interface ReminderDeps {
  /** Shows a notification. Tests inject a recorder; the app uses Electron's. */
  notify: (title: string, body: string) => void
  now?: () => Date
  checkMs?: number
  log?: (line: string) => void
  /** Called when a check ends, so a test knows when to look. */
  checked?: () => void
}

/**
 * Notifies while a timer runs past the threshold, then every interval (Q55). It reads
 * `timer.json` each time, so a timer `jm` started or stopped counts too. It belongs to the
 * app's process, not a window, so it keeps going with every window closed. The last notice is
 * kept in memory: a restarted app reminds again at once.
 * Returns the function that stops it.
 */
export function startReminders(deps: ReminderDeps): () => void {
  const now = deps.now ?? (() => new Date())
  const log =
    deps.log ??
    ((line) => {
      console.error(line)
    })
  let last: { timer: string; at: Date } | null = null
  let lastFailure = ''
  let busy = false

  async function check() {
    // A slow disk must not stack checks, which would notify twice.
    if (busy) return
    busy = true
    try {
      const [timer, settings] = await Promise.all([readTimer(), readSettings()])
      const at = now()
      // A new timer starts a new count; the first segment's start tells timers on one issue apart.
      const id = timer === null ? '' : `${timer.issueKey}@${timer.segments[0]?.start ?? ''}`
      if (last?.timer !== id) last = null
      if (timer !== null && reminderDue(timer, settings.timer, at, last?.at ?? null)) {
        const { timeSpent } = worklogDraft(timer, settings.timer, at)
        deps.notify(`${timer.issueKey} is still being timed`, `The timer has run ${timeSpent}.`)
        last = { timer: id, at }
      }
      lastFailure = ''
    } catch (error) {
      // A corrupt state file fails every check; say so once, not every 30 seconds.
      const code = (error as { code?: string }).code ?? 'internal'
      if (code !== lastFailure) log(`jm reminders failed: ${code}`)
      lastFailure = code
    } finally {
      busy = false
      deps.checked?.()
    }
  }

  const interval = setInterval(() => void check(), deps.checkMs ?? REMINDER_CHECK_MS)
  void check()
  return () => {
    clearInterval(interval)
  }
}
