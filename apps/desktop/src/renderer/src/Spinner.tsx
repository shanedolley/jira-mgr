/** A 12px spinner at the right edge of a property whose edit waits on Jira. Decorative: the row's `aria-busy` says it. */
export function Spinner() {
  return (
    <span
      aria-hidden
      data-spinner
      className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 animate-spin rounded-full border-2 border-muted border-t-transparent motion-reduce:animate-none"
    />
  )
}
