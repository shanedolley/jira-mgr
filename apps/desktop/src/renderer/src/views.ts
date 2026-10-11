import type { ViewFilters } from '@jira-mgr/core/view-filter'

import type { SavedView, Toggles } from '../../shared/ipc'
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

/**
 * The view the filter bar and toggles show, if any: the first whose filters and toggles equal
 * the current ones. Derived on each render, so a view stops being active the moment the user
 * changes a filter or toggle, and a hand-built bar that matches a view highlights it.
 */
export function activeView(
  views: readonly SavedView[],
  filters: ViewFilters,
  toggles: Toggles | undefined,
): SavedView | undefined {
  if (toggles === undefined) return undefined
  return views.find(
    (view) =>
      sameFilters(view.filters, filters) &&
      view.toggles.hideDone === toggles.hideDone &&
      view.toggles.assigneeMe === toggles.assigneeMe &&
      view.toggles.hideEmptyCustomers === toggles.hideEmptyCustomers,
  )
}
