/** A non-blocking notice above the Tree, with a Retry for the load that failed. */
export function Banner({ children, onRetry }: { children: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-1.5 text-xs"
    >
      <span className="min-w-0 flex-1 text-danger">{children}</span>
      <button type="button" onClick={onRetry} className="btn btn-sm">
        Retry
      </button>
    </div>
  )
}
