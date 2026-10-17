import type { Issue } from '@jira-mgr/core'
import { propertyRules, type PropertyRules } from '@jira-mgr/core/issue'

import { keyOf } from './keymap'

/**
 * What the right-click menu can do to an issue, in the order it lists them. An id that is also a
 * command in `keymap.ts` (`status`, `assignee`, `startDate`, `dueDate`, `sprint`, `edit`, `parent`, `labels`,
 * `priority`, `estimate`) shows that command's key.
 */
export type MenuItemId =
  | 'open'
  | 'status'
  | 'assignee'
  | 'startDate'
  | 'dueDate'
  | 'sprint'
  | 'edit'
  | 'parent'
  | 'type'
  | 'labels'
  | 'priority'
  | 'estimate'
  | 'logWork'
  | 'related'
  | 'copy'
  | 'openInJira'
  | 'comment'
  | 'delete'

/** The items that go to the Shell as an action. The rest open a submenu with their own control. */
export type MenuAction =
  'open' | 'logWork' | 'related' | 'copy' | 'openInJira' | 'comment' | 'delete'

export interface MenuItem {
  id: MenuItemId
  label: string
  /** The key beside it, such as `S`, `Shift+D` or `Enter`. */
  key: string | undefined
  /** Items with the same group sit together between rules. */
  group: number
}

interface Definition {
  id: MenuItemId
  label: string
  group: number
  /** The `propertyRules` switch the item follows, or none for an item every type has. */
  rule?: keyof PropertyRules
}

const DEFINITIONS: readonly Definition[] = [
  { id: 'open', label: 'View full screen', group: 0 },
  { id: 'status', label: 'Status', group: 1 },
  { id: 'assignee', label: 'Assignee', group: 1 },
  { id: 'startDate', label: 'Start date', group: 1 },
  { id: 'dueDate', label: 'Due date', group: 1 },
  { id: 'sprint', label: 'Sprint', group: 1, rule: 'sprint' },
  { id: 'edit', label: 'Rename', group: 1 },
  { id: 'parent', label: 'Parent', group: 1, rule: 'parent' },
  { id: 'type', label: 'Type', group: 1, rule: 'typeChange' },
  { id: 'labels', label: 'Labels', group: 1 },
  { id: 'priority', label: 'Priority', group: 1 },
  { id: 'estimate', label: 'Original estimate', group: 1, rule: 'estimates' },
  { id: 'logWork', label: 'Log work', group: 2, rule: 'estimates' },
  { id: 'related', label: 'Related issues', group: 2 },
  { id: 'copy', label: 'Copy', group: 2 },
  { id: 'openInJira', label: 'Open in Jira', group: 2 },
  { id: 'comment', label: 'Add comment', group: 2 },
  { id: 'delete', label: 'Delete', group: 3 },
]

/** The items `issue` allows: an Epic has no sprint, parent, estimate or worklog, a Subtask no sprint or type change. */
export function menuItems(issue: Issue): MenuItem[] {
  const rules = propertyRules(issue.issueType)
  return DEFINITIONS.filter((d) => d.rule === undefined || rules[d.rule]).map((d) => ({
    id: d.id,
    label: d.label,
    // Enter opens the full page from the Tree, so the menu says so beside its first item.
    key: d.id === 'open' ? 'Enter' : keyOf(d.id),
    group: d.group,
  }))
}

/** Whether `issue` allows the item, for a key that asks for it without the menu. */
export const allows = (issue: Issue, id: MenuItemId): boolean =>
  menuItems(issue).some((item) => item.id === id)
