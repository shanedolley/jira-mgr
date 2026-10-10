import type { Issue } from '@jira-mgr/core'

type Category = Issue['status']['category']

/** The glyph drawn for a status category. Each differs by shape, so colour is never the only cue. */
export type StatusShape = 'ring' | 'half' | 'check'

export const statusShape = (category: Category): StatusShape =>
  category === 'indeterminate' ? 'half' : category === 'done' ? 'check' : 'ring'

const COLOURS: Record<StatusShape, string> = {
  ring: 'var(--status-new)',
  half: 'var(--status-doing)',
  check: 'var(--status-done)',
}

/**
 * The status category: To Do an empty ring, In Progress a ring with its right half filled, Done a
 * solid circle with a check cut out in the canvas colour. The name is the accessible label.
 */
export function StatusDot({ status }: { status: Issue['status'] }) {
  const shape = statusShape(status.category)
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
        <circle cx="7" cy="7" r="5.5" />
      )}
      {shape === 'half' && <path d="M7 1.5a5.5 5.5 0 0 1 0 11z" fill={colour} stroke="none" />}
    </svg>
  )
}
