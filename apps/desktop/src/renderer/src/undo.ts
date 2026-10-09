import type { Issue } from '@jira-mgr/core'
import { SWAPPABLE_TYPES, formatEstimate, type SwappableType } from '@jira-mgr/core/issue'
import type { QueryClient } from '@tanstack/react-query'

import type { IssueChanges } from '../../shared/ipc'
import { currentSprint } from './properties'

/**
 * The model behind Cmd+Z (Q38): what each field edit leaves on the undo stack, how to write the
 * old value back, and whether the field still holds what the edit set. The writes themselves go
 * through the same mutations as the edits, so an undo is shown at once and rolls back if Jira
 * refuses. Creates, deletes, comments, worklogs, attachments and links never reach this file.
 */

/** The request that puts the old value back. */
export type Reversal =
  | { kind: 'edit'; changes: IssueChanges }
  | { kind: 'status'; statusId: string }
  | { kind: 'sprint'; sprintId: number | null }
  | { kind: 'summary'; summary: string }

export interface UndoEntry {
  key: string
  /** The fields the edit changed, in words: "status", "Customer and Engagement". */
  what: string
  /** The fields as the edit set them. An undo applies only while the issue still shows these. */
  after: Partial<Issue>
  /** The fields as they were, which the undo shows at once. */
  before: Partial<Issue>
  /** `null` when core cannot write the old value back, such as clearing a priority. */
  reversal: Reversal | null
}

/** How many edits the stack remembers. The oldest falls off the bottom. */
export const UNDO_DEPTH = 50

type Fields = Partial<Issue>

const NAMES: Partial<Record<keyof Issue, string>> = {
  summary: 'summary',
  status: 'status',
  assignee: 'assignee',
  priority: 'priority',
  labels: 'labels',
  issueType: 'type',
  customer: 'Customer',
  engagement: 'Engagement',
  parentKey: 'parent',
  sprints: 'sprint',
  startDate: 'start date',
  dueDate: 'due date',
  originalEstimateSeconds: 'original estimate',
  timeRemainingHours: 'time remaining',
}

const fieldsOf = (fields: Fields) => Object.keys(fields) as (keyof Issue)[]

const words = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

const nameFields = (fields: readonly (keyof Issue)[]) =>
  words(fields.map((field) => NAMES[field] ?? field))

/** "status", or "parent, Customer and Engagement". */
export const whatChanged = (fields: Fields): string => nameFields(fieldsOf(fields))

/** The value of one field as a person reads it. */
function show(field: keyof Issue, issue: Fields): string {
  switch (field) {
    case 'status':
      return issue.status?.name ?? 'none'
    case 'assignee':
      return issue.assignee?.displayName ?? 'Unassigned'
    case 'priority':
      return issue.priority?.name ?? 'none'
    case 'labels':
      return issue.labels === undefined || issue.labels.length === 0
        ? 'none'
        : issue.labels.join(', ')
    case 'issueType':
      return issue.issueType?.name ?? 'none'
    case 'customer':
      return issue.customer?.value ?? 'none'
    case 'engagement':
      return issue.engagement?.value ?? 'none'
    case 'sprints':
      return (issue.sprints && currentSprint({ sprints: issue.sprints })?.name) ?? 'the backlog'
    case 'originalEstimateSeconds':
      return issue.originalEstimateSeconds == null
        ? 'none'
        : formatEstimate(issue.originalEstimateSeconds)
    case 'timeRemainingHours':
      return issue.timeRemainingHours == null ? 'none' : `${String(issue.timeRemainingHours)}h`
    case 'summary':
      return `"${issue.summary ?? ''}"`
    default:
      return String(issue[field] ?? 'none')
  }
}

const valuesOf = (fields: Fields) => words(fieldsOf(fields).map((field) => show(field, fields)))

/** What the toast says after an edit: "PSAPAC-12: status changed to Done". */
export const describeEdit = (entry: UndoEntry) =>
  `${entry.key}: ${entry.what} changed to ${valuesOf(entry.after)}`

/** What the toast says after an undo: "Undid PSAPAC-12: status back to In Progress". */
export const describeUndo = (entry: UndoEntry) =>
  `Undid ${entry.key}: ${entry.what} back to ${valuesOf(entry.before)}`

/**
 * The edit that writes the old values back, or `null` when core cannot: Priority, Customer,
 * Engagement, the parent and the original estimate have no "clear" in `issues:edit`, so an edit
 * that set one from nothing cannot be undone. `before` holds every field the edit changed.
 */
export function invertChanges(changes: IssueChanges, before: Fields): IssueChanges | null {
  const back: IssueChanges = {}
  if ('assignee' in changes) {
    if (before.assignee === undefined) return null
    back.assignee = before.assignee?.accountId ?? null
  }
  if ('priorityId' in changes) {
    if (!before.priority) return null
    back.priorityId = before.priority.id
  }
  if ('startDate' in changes) {
    if (before.startDate === undefined) return null
    back.startDate = before.startDate
  }
  if ('dueDate' in changes) {
    if (before.dueDate === undefined) return null
    back.dueDate = before.dueDate
  }
  const held = before.labels
  if (changes.addLabels !== undefined || changes.removeLabels !== undefined) {
    if (held === undefined) return null
    // Only what the edit really changed comes back; a label already there was not this edit's.
    const added = (changes.addLabels ?? []).filter((l) => !held.includes(l))
    const removed = (changes.removeLabels ?? []).filter((l) => held.includes(l))
    if (added.length > 0) back.removeLabels = added
    if (removed.length > 0) back.addLabels = removed
  }
  if ('parentKey' in changes) {
    if (!before.parentKey) return null
    back.parentKey = before.parentKey
  }
  if ('customerId' in changes) {
    if (!before.customer) return null
    back.customerId = before.customer.id
  }
  if ('engagementId' in changes) {
    if (!before.engagement) return null
    back.engagementId = before.engagement.id
  }
  if ('originalEstimate' in changes) {
    if (before.originalEstimateSeconds == null) return null
    back.originalEstimate = formatEstimate(before.originalEstimateSeconds)
  }
  if ('timeRemainingHours' in changes) {
    if (before.timeRemainingHours === undefined) return null
    back.timeRemainingHours = before.timeRemainingHours
  }
  if ('type' in changes) {
    const name = before.issueType?.name
    if (name === undefined || !(SWAPPABLE_TYPES as readonly string[]).includes(name)) return null
    back.type = name as SwappableType
  }
  return back
}

interface Done {
  /** The fields the edit changed, as it showed them. */
  patch: Fields
  /** The same fields as they were before. */
  before: Fields
}

/** The entry for an `issues:edit`. */
export function editEntry(args: { key: string; changes: IssueChanges }, done: Done): UndoEntry {
  const changes = invertChanges(args.changes, done.before)
  return {
    key: args.key,
    what: whatChanged(done.patch),
    after: done.patch,
    before: done.before,
    reversal: changes === null ? null : { kind: 'edit', changes },
  }
}

/** The entry for a status move; the old status is the one to move back to. */
export function statusEntry(args: { key: string }, done: Done): UndoEntry {
  const previous = done.before.status
  return {
    key: args.key,
    what: 'status',
    after: done.patch,
    before: done.before,
    reversal: previous === undefined ? null : { kind: 'status', statusId: previous.id },
  }
}

/** The entry for a sprint move; no sprint before means the backlog. */
export function sprintEntry(args: { key: string }, done: Done): UndoEntry {
  const previous = done.before.sprints
  return {
    key: args.key,
    what: 'sprint',
    after: done.patch,
    before: done.before,
    reversal:
      previous === undefined
        ? null
        : { kind: 'sprint', sprintId: currentSprint({ sprints: previous })?.id ?? null },
  }
}

/** The entry for a summary edit. */
export function summaryEntry(args: { key: string }, done: Done): UndoEntry {
  const previous = done.before.summary
  return {
    key: args.key,
    what: 'summary',
    after: done.patch,
    before: done.before,
    reversal: previous === undefined ? null : { kind: 'summary', summary: previous },
  }
}

/**
 * What identifies a field's value, so a re-read that fills in an avatar or a sprint's dates does
 * not look like someone else's change. Labels compare as a set.
 */
function identity(field: keyof Issue, issue: Fields): unknown {
  switch (field) {
    case 'status':
    case 'priority':
    case 'issueType':
    case 'customer':
    case 'engagement':
      return issue[field]?.id ?? null
    case 'assignee':
      return issue.assignee?.accountId ?? null
    case 'labels':
      return JSON.stringify([...(issue.labels ?? [])].sort())
    case 'sprints':
      return issue.sprints === undefined
        ? null
        : (currentSprint({ sprints: issue.sprints })?.id ?? null)
    default:
      return issue[field] ?? null
  }
}

/**
 * The fields the edit set that the issue no longer shows, because Jira or someone else changed
 * them since. An undo that finds any refuses, rather than overwrite a change it never saw.
 */
export function changedSince(entry: UndoEntry, current: Fields): string {
  return nameFields(
    fieldsOf(entry.after).filter(
      (field) => identity(field, entry.after) !== identity(field, current),
    ),
  )
}

/** The edits made in this session, newest on top. It lives in memory and ends with the session. */
export class UndoStack {
  private entries: UndoEntry[] = []
  private listeners = new Set<(entry: UndoEntry) => void>()

  get size(): number {
    return this.entries.length
  }

  push(entry: UndoEntry): void {
    this.entries.push(entry)
    if (this.entries.length > UNDO_DEPTH) this.entries.shift()
    for (const listener of this.listeners) listener(entry)
  }

  /** Takes the newest edit off the stack. */
  pop(): UndoEntry | undefined {
    return this.entries.pop()
  }

  clear(): void {
    this.entries = []
  }

  /** Called with each edit as it lands. Returns the unsubscribe function. */
  onPush(listener: (entry: UndoEntry) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/**
 * What an accepted edit does with its fields: it goes on the stack. An edit that is itself an
 * undo (`undoing`) is not recorded, so Cmd+Z twice walks back through the stack instead of
 * undoing the undo.
 */
export function recorder<A extends { key: string; undoing?: boolean }>(
  client: QueryClient,
  entryOf: (args: A, done: Done) => UndoEntry,
) {
  return (args: A, done: Done) => {
    if (args.undoing !== true) undoStack(client).push(entryOf(args, done))
  }
}

const stacks = new WeakMap<QueryClient, UndoStack>()

/** The stack of one client, which stands for one login. */
export function undoStack(client: QueryClient): UndoStack {
  const held = stacks.get(client) ?? new UndoStack()
  stacks.set(client, held)
  return held
}
