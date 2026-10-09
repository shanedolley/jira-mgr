import type { Issue } from '@jira-mgr/core'

type Kind = 'epic' | 'story' | 'bug' | 'task' | 'subtask' | 'other'

const KINDS: Record<string, Kind> = {
  epic: 'epic',
  story: 'story',
  bug: 'bug',
  task: 'task',
  subtask: 'subtask',
  'sub-task': 'subtask',
}

/** The icon kind for a Jira issue type name; an unknown type gets the neutral one. */
export const typeKind = (name: string): Kind => KINDS[name.toLowerCase()] ?? 'other'

const COLOURS: Record<Kind, string> = {
  epic: 'var(--type-epic)',
  story: 'var(--type-story)',
  bug: 'var(--type-bug)',
  task: 'var(--type-task)',
  subtask: 'var(--type-task)',
  other: 'var(--status-new)',
}

const SHAPES: Record<Kind, React.ReactNode> = {
  epic: <path d="M8.5 1.5 3.5 8.5H7.5L6.5 14.5 12.5 6.5H8.5Z" fill="currentColor" stroke="none" />,
  story: <path d="M4 2h8v12L8 11l-4 3Z" fill="currentColor" stroke="none" />,
  bug: (
    <>
      <circle cx="8" cy="9" r="3.5" fill="currentColor" stroke="none" />
      <path d="M8 5.5V3M4.5 8H2.5M11.5 8h2M5 12l-1.5 1.5M11 12l1.5 1.5M5 6 3.5 4.5M11 6l1.5-1.5" />
    </>
  ),
  task: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
      <path d="m5 8.2 2 2L11 6" stroke="var(--canvas)" strokeWidth="1.8" />
    </>
  ),
  subtask: (
    <>
      <rect x="2" y="5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
      <rect x="5.5" y="2" width="8.5" height="8.5" rx="1.5" fill="none" />
    </>
  ),
  other: <circle cx="8" cy="8" r="4.5" fill="none" />,
}

/** The issue type as a coloured icon; the type name is the accessible label. */
export function TypeIcon({ type }: { type: Issue['issueType'] }) {
  const kind = typeKind(type.name)
  return (
    <svg
      role="img"
      aria-label={type.name}
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0"
      style={{ color: COLOURS[kind] }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {SHAPES[kind]}
    </svg>
  )
}
