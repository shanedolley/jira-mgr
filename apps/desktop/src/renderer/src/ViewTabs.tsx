import type { ViewFilters } from '@jira-mgr/core/view-filter'

import type { SavedView, Toggles } from '../../shared/ipc'
import { useViews } from './viewQueries'
import { activeView } from './views'

interface ViewTabsProps {
  filters: ViewFilters
  toggles: Toggles | undefined
  onApply: (view: SavedView) => void
}

/**
 * The saved views as tabs over the list, in the sidebar's order. A tab is a ghost button (28px,
 * 6px radius), so it follows the button system rather than Linear's full pill. The lit tab is the
 * view the bar matches.
 */
export function ViewTabs({ filters, toggles, onApply }: ViewTabsProps) {
  const views = useViews().data
  if (views === undefined || views.length === 0) return null
  const active = activeView(views, filters, toggles)
  return (
    <div
      role="group"
      aria-label="View tabs"
      className="flex shrink-0 gap-2 overflow-x-auto border-b border-line px-4 py-2"
    >
      {views.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-current={active?.id === view.id ? 'true' : undefined}
          onClick={() => {
            onApply(view)
          }}
          title={view.name}
          className={`btn btn-ghost max-w-48 font-medium ${active?.id === view.id ? 'is-current text-ink' : ''}`}
        >
          <span className="truncate">{view.name}</span>
        </button>
      ))}
    </div>
  )
}
