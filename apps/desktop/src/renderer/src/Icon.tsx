/** Paths on a 16px grid for the stroked glyphs that icon-only buttons carry. */
export const PLUS = 'M8 3.5v9M3.5 8h9'
export const PENCIL = 'm10.5 3.5 2 2-7 7H3.5v-2zM9 5l2 2'
export const CHECK = 'm3.5 8.5 3 3 6-7'
export const COPY = 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7'
export const TRASH = 'M3.5 4.5h9M6.5 4.5v-1h3v1M5 4.5l.5 8h5l.5-8'
export const SIDEBAR = 'M2.5 3.5h11v9h-11zM6 3.5v9'
export const INBOX = 'M2.5 9.5v3h11v-3M2.5 9.5 4 4h8l1.5 5.5M2.5 9.5h3.5l.5 1.5h3l.5-1.5h3.5'
export const LIST = 'M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.5 4.5h.01M2.5 8h.01M2.5 11.5h.01'

export function Icon({ path, className = 'size-3.5' }: { path: string; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  )
}
