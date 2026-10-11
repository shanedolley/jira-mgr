import { Details } from './Failure'
import { useSprints } from './queries'
import { sidebarSprints } from './sprintView'

/**
 * The sidebar's Sprints section: Current opens the active sprint and Upcoming the next future one
 * that has dates. The open sprint's entry takes the single highlight (`is-current`), so the Issues
 * link and the views give theirs up while a sprint page is open.
 */
export function SprintsList({
  openId,
  onOpen,
}: {
  /** The sprint whose page is open, if any. */
  openId: number | null
  onOpen: (id: number) => void
}) {
  const sprints = useSprints(false, true)
  const { current, upcoming } = sidebarSprints(sprints.data ?? [])
  const entries = [
    { label: 'Current', sprint: current },
    { label: 'Upcoming', sprint: upcoming },
  ]
  return (
    <section aria-labelledby="sprints-heading" className="shrink-0 px-2">
      <h2 id="sprints-heading" className="px-2 pb-1 pt-3 text-xs font-medium text-muted">
        Sprints
      </h2>
      {sprints.isError && sprints.data === undefined && (
        <div role="alert" className="space-y-1 px-2 pb-1 text-xs text-danger">
          <p>Could not load sprints. {sprints.error.message}</p>
          <Details error={sprints.error} />
          <button type="button" onClick={() => void sprints.refetch()} className="btn btn-sm">
            Retry
          </button>
        </div>
      )}
      <ul className="space-y-0.5">
        {entries.map(({ label, sprint }) => {
          const open = sprint !== null && sprint.id === openId
          return (
            <li key={label}>
              <button
                type="button"
                data-row
                disabled={sprint === null}
                aria-current={open ? 'page' : undefined}
                title={sprint?.name ?? `No ${label.toLowerCase()} sprint`}
                onClick={() => {
                  if (sprint !== null) onOpen(sprint.id)
                }}
                className={`flex h-7 w-full items-center justify-between gap-2 rounded-md px-2 text-left disabled:text-muted ${open ? 'is-current' : 'hover:bg-hover'}`}
              >
                <span>{label}</span>
                <span className="min-w-0 truncate text-xs text-muted">
                  {sprint?.name ?? 'None'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
