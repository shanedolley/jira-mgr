import type { Issue } from '@jira-mgr/core'

type Category = Issue['status']['category']

/**
 * The glyph drawn for a status. Each differs by shape, so colour is never the only cue, except
 * Hold.
 */
export type StatusShape = 'ring' | 'half' | 'check' | 'hold'

/**
 * Hold sits in the To Do category, so the name alone tells it from To Do. "Hold" and "On Hold" both
 * match, ignoring case, outer space and the width of the space between the words (#217).
 */
const HOLD_NAME = /^(on\s+)?hold$/i
export const isHold = (status: { name: string }): boolean => HOLD_NAME.test(status.name.trim())

export const statusShape = (status: { name: string; category: Category }): StatusShape =>
  isHold(status)
    ? 'hold'
    : status.category === 'indeterminate'
      ? 'half'
      : status.category === 'done'
        ? 'check'
        : 'ring'

const COLOURS: Record<StatusShape, string> = {
  ring: 'var(--status-new)',
  half: 'var(--status-doing)',
  check: 'var(--status-done)',
  hold: 'var(--status-new)',
}

/** Shane's calls of 2026-10-14 and 2026-10-15 (#217): Hold is a dashed To Do ring at 30% opacity. */
export const HOLD_OPACITY = 0.3

/** Eight dashes round the r=5.5 ring: the 34.56 circumference is 8 periods of 4.32. */
const HOLD_DASH = '2.6 1.72'

/** The style that fades the summary of a Hold issue to the ring's opacity; none for other statuses. */
export const summaryFade = (status: { name: string }): { opacity: number } | undefined =>
  isHold(status) ? { opacity: HOLD_OPACITY } : undefined

/**
 * The status category: To Do an empty ring, In Progress a ring with its right half filled, Done a
 * solid circle with a check cut out in the canvas colour, Hold the To Do ring dashed at 30% opacity. The
 * name is the accessible label.
 */
export function StatusDot({ status }: { status: Issue['status'] }) {
  const shape = statusShape(status)
  const colour = COLOURS[shape]
  return (
    <svg
      role="img"
      aria-label={status.name}
      data-glyph="status"
      data-shape={shape}
      viewBox="0 0 14 14"
      className="size-3.5 shrink-0"
      fill="none"
      stroke={colour}
      strokeWidth="1.5"
      opacity={shape === 'hold' ? HOLD_OPACITY : undefined}
    >
      {shape === 'check' ? (
        <>
          <circle cx="7" cy="7" r="6.25" fill={colour} stroke="none" />
          <path
            d="m4.2 7.2 2 2 3.6-4"
            stroke="var(--canvas)"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <circle cx="7" cy="7" r="5.5" strokeDasharray={shape === 'hold' ? HOLD_DASH : undefined} />
      )}
      {shape === 'half' && <path d="M7 1.5a5.5 5.5 0 0 1 0 11z" fill={colour} stroke="none" />}
    </svg>
  )
}
