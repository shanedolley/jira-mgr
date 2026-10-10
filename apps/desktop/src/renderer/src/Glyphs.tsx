/** Filled bars out of four for each priority name PSAPAC and a default Jira site use. */
const LEVELS: Record<string, number> = {
  highest: 4,
  blocker: 4,
  'business critical': 4,
  p1: 4,
  high: 3,
  critical: 3,
  'major problem': 3,
  p2: 3,
  medium: 2,
  major: 2,
  problem: 2,
  low: 1,
  minor: 1,
  lowest: 1,
  trivial: 1,
}

/** How many of the four bars a priority fills; a name that is not listed fills none. */
export const priorityLevel = (name: string): number => LEVELS[name.toLowerCase()] ?? 0

/** The priority as four rising bars, the level filled in ink and the rest muted. Text beside it names it. */
export function PriorityBars({ name }: { name: string }) {
  const level = priorityLevel(name)
  return (
    <svg
      aria-hidden
      data-glyph="priority"
      data-level={level}
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0"
      stroke="none"
    >
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 3.5}
          y={12 - (i + 1) * 2.5}
          width="2.5"
          height={(i + 1) * 2.5 + 2}
          rx="0.6"
          fill={i < level ? 'var(--ink)' : 'var(--type-rest)'}
          opacity={i < level ? 1 : 0.5}
        />
      ))}
    </svg>
  )
}

/** The mark before a label: an 8px dot. */
export function LabelDot() {
  return <span aria-hidden data-glyph="label" className="size-2 shrink-0 rounded-full bg-muted" />
}
