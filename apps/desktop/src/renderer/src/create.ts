import type { Issue } from '@jira-mgr/core'
import { editorToAdf, type AdfDoc, type EditorDoc } from '@jira-mgr/core/adf'
import type { CustomerOption } from '@jira-mgr/core/hierarchy'
import {
  formatEstimate,
  parentCandidates,
  parseEstimate,
  propertyRules,
  type PropertyRules,
} from '@jira-mgr/core/issue'

import type {
  CreateIssueArgs,
  CreatedIssue,
  CreateType,
  FieldChoice,
  LateRead,
  SprintOption,
} from '../../shared/ipc'
import { currentSprint, type Person } from './properties'
import type { TreeRow } from './tree'

/**
 * The pure model behind the create modal (Q33): what the form starts with, which fields a type
 * has, what is missing, the request, and how to tell the user what Jira did after the create.
 * What Jira accepts stays in core; this only shapes the form.
 */

/** Everything the form holds. The pickers keep whole choices, so the form can show their names. */
export interface CreateDraft {
  type: CreateType
  summary: string
  parent: Issue | null
  customer: FieldChoice | null
  engagement: FieldChoice | null
  sprint: SprintOption | null
  assignee: Person | null
  labels: string[]
  priority: FieldChoice | null
  /** A Jira duration such as `2h 30m`, or empty. */
  estimate: string
  /** What the description editor holds, or `null` while it holds no text. */
  description: AdfDoc | null
}

/** What the type lets the form show. An Epic has no parent, sprint or estimate; a Subtask no sprint. */
export const typeRules = (type: CreateType): PropertyRules =>
  propertyRules({ name: type, subtask: type === 'Subtask' })

const choice = (option: CustomerOption | null | undefined): FieldChoice | null =>
  option === null || option === undefined ? null : { id: option.id, name: option.value }

/** The first Epic at or above `issue`, found through the loaded issues' parent keys. */
export function nearestEpic(issue: Issue, issues: readonly Issue[]): Issue | null {
  const byKey = new Map(issues.map((i) => [i.key, i]))
  let at: Issue | undefined = issue
  // A parent chain is three levels deep at most; the bound only guards against a cycle.
  for (let step = 0; at !== undefined && step < 8; step++) {
    if (at.issueType.hierarchyLevel >= 1) return at
    at = at.parentKey === null ? undefined : byKey.get(at.parentKey)
  }
  return null
}

const typed = (type: CreateType) => ({
  key: '',
  issueType: { subtask: type === 'Subtask', hierarchyLevel: type === 'Epic' ? 1 : 0 },
})

/** Whether `parent` may hold a new issue of `type`: Epics for a Story, Task or Bug; those three for a Subtask. */
export const fitsParent = (type: CreateType, parent: Issue): boolean =>
  parentCandidates(typed(type), [parent]).length === 1

/**
 * The parent a new issue of `type` starts with, from the issue the user selected: the nearest Epic
 * for a Story, Task or Bug (the Epic itself when it is selected), the selected issue for a
 * Subtask, or the selected Subtask's own parent. `null` when nothing fits.
 */
export function defaultParent(
  type: CreateType,
  selected: Issue | null,
  issues: readonly Issue[],
): Issue | null {
  if (selected === null || type === 'Epic') return null
  if (type !== 'Subtask') return nearestEpic(selected, issues)
  if (fitsParent(type, selected)) return selected
  const parent = issues.find((i) => i.key === selected.parentKey)
  return parent !== undefined && fitsParent(type, parent) ? parent : null
}

/**
 * The form for `C` pressed with `selected` active: a Story, under the Epic at or above the
 * selection, with the Customer and Engagement of that Epic, else of the selection itself (the
 * Epic wins so a new Story does not start as a Customer mismatch, Q15). With no selected issue,
 * `group` (a Customer header the user stood on) supplies the Customer.
 */
export function initialDraft(
  selected: Issue | null,
  issues: readonly Issue[],
  group: CustomerOption | null = null,
): CreateDraft {
  const parent = defaultParent('Story', selected, issues)
  return {
    type: 'Story',
    summary: '',
    parent,
    customer: choice(parent?.customer ?? selected?.customer ?? group),
    engagement: choice(parent?.engagement ?? selected?.engagement),
    sprint: null,
    assignee: null,
    labels: [],
    priority: null,
    estimate: '',
    description: null,
  }
}

/**
 * What `C` was pressed on: the active issue, a chip's open parent, or a Customer header, whose
 * Customer the form takes when no issue is selected. Nothing for a blank Tree.
 */
export function createContext(
  row: TreeRow | undefined,
  issues: readonly Issue[],
): { selected: Issue | null; group: CustomerOption | null } {
  switch (row?.kind) {
    case 'issue':
      return { selected: row.node.issue, group: null }
    case 'chip':
      return { selected: issues.find((i) => i.key === row.parentKey) ?? null, group: null }
    case 'customer':
    case 'noEpic':
      return { selected: null, group: row.customer }
    default:
      return { selected: null, group: null }
  }
}

/** Changes the type, keeping the parent if it still fits and otherwise taking the new type's default. */
export function withType(
  draft: CreateDraft,
  type: CreateType,
  selected: Issue | null,
  issues: readonly Issue[],
): CreateDraft {
  const parent =
    draft.parent !== null && fitsParent(type, draft.parent)
      ? draft.parent
      : defaultParent(type, selected, issues)
  const rules = typeRules(type)
  return {
    ...draft,
    type,
    parent: rules.parent ? parent : null,
    sprint: rules.sprint ? draft.sprint : null,
    estimate: rules.estimates ? draft.estimate : '',
  }
}

/** The form fields that can block a create. */
export type MissingField = 'summary' | 'customer' | 'engagement' | 'parent' | 'estimate'

/** The order the form shows them in, which Cmd+Enter follows: a parent fills Customer and Engagement. */
const FORM_ORDER: readonly MissingField[] = [
  'summary',
  'parent',
  'customer',
  'engagement',
  'estimate',
]

/** What the form still needs before it can be sent, in the order "Add ..." lists it. Empty when it is ready. */
function missing(draft: CreateDraft): { field: MissingField; phrase: string }[] {
  const rules = typeRules(draft.type)
  return [
    ...(draft.summary.trim() === '' ? [{ field: 'summary' as const, phrase: 'a summary' }] : []),
    ...(draft.customer === null ? [{ field: 'customer' as const, phrase: 'a Customer' }] : []),
    ...(draft.engagement === null
      ? [{ field: 'engagement' as const, phrase: 'an Engagement' }]
      : []),
    ...(draft.type === 'Subtask' && draft.parent === null
      ? [{ field: 'parent' as const, phrase: 'a parent' }]
      : []),
    ...(rules.estimates && draft.estimate.trim() !== '' && parseEstimate(draft.estimate) === null
      ? [{ field: 'estimate' as const, phrase: 'an estimate such as 2h 30m' }]
      : []),
  ]
}

/** What the form still needs before it can be sent, as phrases for "Add ...". Empty when it is ready. */
export const missingFields = (draft: CreateDraft): string[] => missing(draft).map((m) => m.phrase)

/** The fields the form still needs, in form order. */
export const missingKeys = (draft: CreateDraft): MissingField[] => {
  const needed = missing(draft).map((m) => m.field)
  return FORM_ORDER.filter((field) => needed.includes(field))
}

/** The first field the form still needs, which Cmd+Enter on an unready form takes focus to. */
export const firstMissing = (draft: CreateDraft): MissingField | null =>
  missingKeys(draft)[0] ?? null

/** The request for a ready draft. Fields the type does not have are left out. */
export function toCreateArgs(draft: CreateDraft): CreateIssueArgs | null {
  if (missingFields(draft).length > 0 || draft.customer === null || draft.engagement === null) {
    return null
  }
  const rules = typeRules(draft.type)
  const estimate = draft.estimate.trim()
  return {
    type: draft.type,
    summary: draft.summary.trim(),
    customerId: draft.customer.id,
    engagementId: draft.engagement.id,
    ...(rules.parent && draft.parent !== null && { parentKey: draft.parent.key }),
    ...(draft.assignee !== null && { assignee: draft.assignee.accountId }),
    ...(draft.description !== null && { description: draft.description }),
    ...(draft.priority !== null && { priorityId: draft.priority.id }),
    ...(draft.labels.length > 0 && { labels: draft.labels }),
    ...(rules.estimates && estimate !== '' && { originalEstimate: estimate }),
    ...(rules.sprint && draft.sprint !== null && { sprintId: draft.sprint.id }),
  }
}

/** The nodes that hold nothing of their own, so a document of only these says something only through its text. */
const CONTAINERS = new Set([
  'doc',
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'hardBreak',
  'text',
])

/**
 * True when `node` holds a text with a visible character, or any node outside `CONTAINERS` (a
 * rule, a mention, media, a read-only block), which stays content whatever it holds.
 */
function hasContent(node: { type: string; text?: string; content?: readonly unknown[] }): boolean {
  if (!CONTAINERS.has(node.type)) return true
  if (node.text !== undefined && node.text.trim() !== '') return true
  return (node.content ?? []).some((child) => hasContent(child as typeof node))
}

/**
 * The description editor's document as ADF, or `null` while it says nothing: Enter, Shift+Enter,
 * spaces, an empty heading or an empty list item leave no visible text, so they are not a description.
 */
export function descriptionOf(doc: EditorDoc): AdfDoc | null {
  let adf: AdfDoc | null
  try {
    adf = editorToAdf(doc)
  } catch {
    // Only an image still uploading makes it throw, and the create dialog's editor takes no images.
    return null
  }
  return adf === null || !hasContent(adf) ? null : adf
}

/** After "Create more": the same form with no summary or description for the next issue. */
export const nextDraft = (draft: CreateDraft): CreateDraft => ({
  ...draft,
  summary: '',
  description: null,
})

export interface Notice {
  title: string
  /** What Jira did differently from the form, and any step that failed. One sentence each. */
  notes: string[]
  /** True when a step after the create failed, so the notice stays until dismissed. */
  warned: boolean
}

/**
 * What to tell the user after a create. PSAPAC's automation rewrites new issues (it adds a label,
 * sets the estimates, and on a Task replaced the Customer, the parent and the sprint), so the
 * notice compares what the form asked for with what Jira holds, field by field.
 */
export function describeCreated(draft: CreateDraft, result: CreatedIssue): Notice {
  const { issue, warning, key } = result
  const warned = warning !== null
  if (issue === null) {
    return {
      title: `Created ${key}`,
      notes: warning === null ? [] : [warning],
      warned,
    }
  }
  const notes: string[] = []
  const differs = (field: string, held: string, chosen: string) => {
    notes.push(`${field} is ${held} (you chose ${chosen}).`)
  }
  const heldCustomer = issue.customer?.value ?? 'empty'
  if (issue.customer?.id !== draft.customer?.id) {
    differs('Customer', heldCustomer, draft.customer?.name ?? 'none')
  }
  if (issue.engagement?.id !== draft.engagement?.id) {
    differs('Engagement', issue.engagement?.value ?? 'empty', draft.engagement?.name ?? 'none')
  }
  const chosenParent = typeRules(draft.type).parent ? (draft.parent?.key ?? null) : null
  if (issue.parentKey !== chosenParent) {
    differs('Parent', issue.parentKey ?? 'none', chosenParent ?? 'none')
  }
  const heldSprint = currentSprint(issue)
  if ((heldSprint?.id ?? null) !== (draft.sprint?.id ?? null)) {
    differs('Sprint', heldSprint?.name ?? 'the backlog', draft.sprint?.name ?? 'none')
  }
  const added = issue.labels.filter((l) => !draft.labels.includes(l))
  if (added.length > 0) {
    notes.push(`Jira added the label${added.length === 1 ? '' : 's'} ${added.join(', ')}.`)
  }
  const chosenSeconds = parseEstimate(draft.estimate)
  if (issue.originalEstimateSeconds !== chosenSeconds) {
    differs(
      'Original estimate',
      issue.originalEstimateSeconds === null
        ? 'none'
        : formatEstimate(issue.originalEstimateSeconds),
      chosenSeconds === null ? 'none' : draft.estimate.trim(),
    )
  }
  if (warning !== null) notes.push(warning)
  return { title: `Created ${key}: ${issue.summary}`, notes, warned }
}

/** A file the create could not attach, and Jira's or the app's reason. */
export interface FailedFile {
  name: string
  reason: string
}

/**
 * The notice with a note for each file that did not attach. The issue exists, so each note names
 * `key`, and the notice stays until dismissed.
 */
export const withUploadFailures = (
  notice: Notice,
  key: string,
  failed: readonly FailedFile[],
): Notice =>
  failed.length === 0
    ? notice
    : {
        ...notice,
        notes: [
          ...notice.notes,
          ...failed.map(({ name, reason }) => `Could not attach ${name} to ${key}. ${reason}`),
        ],
        warned: true,
      }

/**
 * What to tell the user when the second read of a created issue shows more automation. It compares
 * with the form again, not with the first read, and leaves out what `shown` already said. `null`
 * when nothing is new.
 */
export function describeLate(draft: CreateDraft, shown: Notice, read: LateRead): Notice | null {
  const notes = describeCreated(draft, { key: read.key, issue: read.issue, warning: null }).notes
  const fresh = notes.filter((note) => !shown.notes.includes(note))
  return fresh.length === 0
    ? null
    : { title: `Jira changed ${read.key} after it was created`, notes: fresh, warned: false }
}

/** "a", "a and b", "a, b and c". */
export const listWords = (words: readonly string[]): string =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`

/**
 * What to tell the user when Jira refused a delete. A missing issue is gone from Jira, not refused.
 * "Back in the list" is true only when the lists held the issue and the rollback restored it.
 */
export function deleteFailureNotes(
  key: string,
  failure: { code: string; message: string },
  restored: boolean,
): string[] {
  if (failure.code === 'not_found') return [`${key} no longer exists in Jira.`]
  return [failure.message, ...(restored ? ['It is back in the list.'] : [])]
}
