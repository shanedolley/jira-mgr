import type { Progress } from '@jira-mgr/core/hierarchy'

import { percentOf } from './sprintView'

/** The words a screen reader and a tooltip use: "2 of 8 done". */
export const progressText = ({ done, total }: Progress): string =>
  `${String(done)} of ${String(total)} done`

const RADIUS = 5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** A ring that fills clockwise from the top with the share done. */
function Ring({ done, total }: Progress) {
  const share = total === 0 ? 0 : done / total
  return (
    <svg
      aria-hidden
      data-glyph="progress"
      viewBox="0 0 14 14"
      className="size-3.5 shrink-0 -rotate-90"
      fill="none"
      strokeWidth="2"
    >
      <circle cx="7" cy="7" r={RADIUS} stroke="var(--line)" />
      {share > 0 && (
        <circle
          cx="7"
          cy="7"
          r={RADIUS}
          stroke="var(--status-done)"
          strokeDasharray={`${String(share * CIRCUMFERENCE)} ${String(CIRCUMFERENCE)}`}
        />
      )}
    </svg>
  )
}

/** The pill a parent shows: a ring and done over total, as "6/20". */
export function ProgressPill({ progress }: { progress: Progress }) {
  return (
    <span
      role="img"
      aria-label={progressText(progress)}
      data-progress={`${String(progress.done)}/${String(progress.total)}`}
      title={progressText(progress)}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 text-xs leading-5 tabular-nums text-muted"
    >
      <Ring {...progress} />
      {progress.done}/{progress.total}
    </span>
  )
}

/** What a Done-dependent cell says while the Done load has failed. */
export function NotLoaded() {
  return <span className="text-muted">Not loaded</span>
}

/** A bar and the percent done, for a table cell. Nothing is done yet reads "0%"; no issues reads "No issues". */
export function PercentDone({ progress }: { progress: Progress | undefined }) {
  if (progress === undefined || progress.total === 0) {
    return <span className="text-muted">No issues</span>
  }
  const percent = percentOf(progress.done, progress.total)
  return (
    <span className="inline-flex items-center gap-2">
      <Ring {...progress} />
      <span className="tabular-nums">{percent}%</span>
    </span>
  )
}
