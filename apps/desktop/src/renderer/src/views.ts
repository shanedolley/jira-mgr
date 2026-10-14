import { DEFAULT_DIRECTION, DEFAULT_ORDER, DEFAULT_PROPERTIES } from '@jira-mgr/core/display'
import type { ViewFilters } from '@jira-mgr/core/view-filter'

import type { Display, SavedView, Toggles } from '../../shared/ipc'
import { FILTER_FIELDS, OPERATORS, valuesOf } from './filters'

const sameSet = (a: readonly string[] = [], b: readonly string[] = []) =>
  a.length === b.length && a.every((value) => b.includes(value))

/** True when the filters select the same issues in the same way, ignoring the order of values. */
function sameFilters(a: ViewFilters, b: ViewFilters): boolean {
  return (
    FILTER_FIELDS.every((field) =>
      OPERATORS.every((op) => sameSet(valuesOf(a, field, op), valuesOf(b, field, op))),
    ) && (a.text ?? '').trim() === (b.text ?? '').trim()
  )
}

/** True when the view's filters and toggles equal the bar's and the toggles' current ones. */
export function viewMatches(view: SavedView, filters: ViewFilters, toggles: Toggles): boolean {
  return (
    sameFilters(view.filters, filters) &&
    view.toggles.hideDone === toggles.hideDone &&
    view.toggles.assigneeMe === toggles.assigneeMe &&
    view.toggles.hideEmptyCustomers === toggles.hideEmptyCustomers
  )
}

/**
 * True when the view's display is the one the Tree shows. A view with no display holds the
 * defaults. Display is not part of `viewMatches`, so a view stays lit while a property is toggled;
 * this is what tells "Update view" that there is something to save.
 */
export function viewDisplayMatches(view: SavedView, display: Display): boolean {
  const saved = view.display ?? {
    properties: [...DEFAULT_PROPERTIES],
    order: DEFAULT_ORDER,
    direction: DEFAULT_DIRECTION,
  }
  return (
    saved.order === display.order &&
    saved.direction === display.direction &&
    sameSet(saved.properties, display.properties)
  )
}

/**
 * The view the filter bar and toggles show, if any: one whose filters and toggles equal the
 * current ones. Of several twins (a duplicate matches its original) the one applied last wins when
 * it still matches, else the first. Derived on each render, so a view stops being active the
 * moment the user changes a filter or toggle, and a hand-built bar that matches a view highlights it.
 */
export function activeView(
  views: readonly SavedView[],
  filters: ViewFilters,
  toggles: Toggles | undefined,
  appliedId?: string,
): SavedView | undefined {
  if (toggles === undefined) return undefined
  const matching = views.filter((view) => viewMatches(view, filters, toggles))
  return matching.find((view) => view.id === appliedId) ?? matching[0]
}

/** The views with `id` moved to `toIndex`, as core's `moveView` places it. Unchanged when `id` is unknown. */
export function movedView(views: readonly SavedView[], id: string, toIndex: number): SavedView[] {
  const from = views.findIndex((v) => v.id === id)
  const view = views[from]
  if (view === undefined) return [...views]
  return views.toSpliced(from, 1).toSpliced(toIndex, 0, view)
}
