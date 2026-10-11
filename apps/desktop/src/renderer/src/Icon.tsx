/** Paths on a 16px grid for the stroked glyphs that icon-only buttons carry. */
export const PLUS = 'M8 3.5v9M3.5 8h9'
export const PENCIL = 'm10.5 3.5 2 2-7 7H3.5v-2zM9 5l2 2'
export const CHECK = 'm3.5 8.5 3 3 6-7'
export const COPY = 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7'
export const TRASH = 'M3.5 4.5h9M6.5 4.5v-1h3v1M5 4.5l.5 8h5l.5-8'

export function Icon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-3.5"
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
