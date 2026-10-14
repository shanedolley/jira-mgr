import type { Issue } from '@jira-mgr/core'
import type { AdfDoc } from '@jira-mgr/core/adf'
import type { IssueDetail } from '@jira-mgr/core/issue'
import { SWAPPABLE_TYPES, formatEstimate, type SwappableType } from '@jira-mgr/core/issue'
import type { QueryClient } from '@tanstack/react-query'

import type { BatchChange, IssueChanges } from '../../shared/ipc'
import type { BatchDone, BatchRequestItem } from './optimistic'
import { currentSprint, hoursText } from './properties'

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
  | { kind: 'description'; description: AdfDoc | null }

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

/**
 * A batch of edits made at once, which one Cmd+Z takes back together. Each part holds its own
 * issue's prior value, since the issues may have differed before the batch made them alike.
 */
export interface BatchEntry {
  /** The fields the batch changed, in words: "status". */
  what: string
  /** What the toast says after the batch: "Status changed to Done on 8 issues". */
  title: string
  parts: UndoEntry[]
}

/** What the stack holds: one issue's edit, or a batch of them. */
export type StackEntry = UndoEntry | BatchEntry

export const isBatch = (entry: StackEntry): entry is BatchEntry => 'parts' in entry

/** True when an undo of the entry can write something back. */
export const reversible = (entry: StackEntry): boolean =>
  isBatch(entry) ? entry.parts.some((part) => part.reversal !== null) : entry.reversal !== null

/** How many edits the stack remembers. The oldest falls off the bottom. */
export const UNDO_DEPTH = 50

type Fields = Partial<IssueDetail>

const NAMES: Partial<Record<keyof IssueDetail, string>> = {
  summary: 'summary',
  description: 'description',
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
  timeRemainingHours: 'time left',
}

const fieldsOf = (fields: Fields) => Object.keys(fields) as (keyof IssueDetail)[]

const words = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

const nameFields = (fields: readonly (keyof IssueDetail)[]) =>
  words(fields.map((field) => NAMES[field] ?? field))

/** "status", or "parent, Customer and Engagement". */
export const whatChanged = (fields: Fields): string => nameFields(fieldsOf(fields))

/** The value of one field as a person reads it. */
function show(field: keyof IssueDetail, issue: Fields): string {
  switch (field) {
    case 'description':
      return issue.description == null ? 'empty' : 'the saved text'
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
      return issue.timeRemainingHours == null ? 'none' : hoursText(issue.timeRemainingHours)
    case 'summary':
      return `"${issue.summary ?? ''}"`
    default:
      return String((issue[field] as string | number | boolean | null | undefined) ?? 'none')
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
 * that set one from nothing cannot be undone, and neither can an edit with nothing left to put back. `before` holds every field the edit changed.
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
  // An edit that put back nothing, such as a label that was already there, has nothing to send.
  return Object.keys(back).length === 0 ? null : back
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

/** The entry for one issue of a batch, by the kind of change the batch made to it. */
export function entryOfChange(key: string, change: BatchChange, done: Done): UndoEntry {
  switch (change.kind) {
    case 'edit':
      return editEntry({ key, changes: change.changes }, done)
    case 'status':
      return statusEntry({ key }, done)
    case 'sprint':
      return sprintEntry({ key }, done)
  }
}

/** The batch change that carries out a reversal, or `null` for one a batch cannot send (text). */
export function changeOfReversal(reversal: Reversal): BatchChange | null {
  switch (reversal.kind) {
    case 'edit':
    case 'status':
    case 'sprint':
      return reversal
    case 'summary':
    case 'description':
      return null
  }
}

/** The entry for the issues Jira changed in one batch. */
export function batchEntry(title: string, done: readonly BatchDone[]): BatchEntry {
  const parts = done.map(({ key, change, patch, before }) =>
    entryOfChange(key, change, { patch, before }),
  )
  return { what: parts[0]?.what ?? '', title, parts }
}

/**
 * The batch that undoes `entry`: each issue goes back to its own prior value. An issue is skipped,
 * and named in `skipped`, when it is no longer loaded, when it changed since the batch (the undo
 * would overwrite that), or when the batch left no way to put its value back.
 */
export function planBatchUndo(
  entry: BatchEntry,
  now: (key: string) => Issue | undefined,
): { items: BatchRequestItem[]; skipped: string[] } {
  const items: BatchRequestItem[] = []
  const skipped: string[] = []
  for (const part of entry.parts) {
    const issue = now(part.key)
    const change = part.reversal === null ? null : changeOfReversal(part.reversal)
    if (issue === undefined || change === null || changedSince(part, issue) !== '') {
      skipped.push(part.key)
    } else items.push({ key: part.key, id: issue.id, change, patch: part.before })
  }
  return { items, skipped }
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

/** The entry for a description save; the description it replaced is the one to write back. */
export function descriptionEntry(args: { key: string }, done: Done): UndoEntry {
  const previous = done.before.description
  return {
    key: args.key,
    what: 'description',
    after: done.patch,
    before: done.before,
    reversal: previous === undefined ? null : { kind: 'description', description: previous },
  }
}

/** A description as a string that ignores key order and the `localId`s Jira may add or renumber. */
function descriptionIdentity(doc: AdfDoc | null | undefined): string {
  const plain = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(plain)
    if (value === null || typeof value !== 'object') return value
    const entries = Object.entries(value)
      .filter(([key]) => key !== 'localId')
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]): [string, unknown] => [key, plain(item)])
      // Jira adding a localId to a node with no other attrs leaves `attrs: {}`, which is no attrs.
      .filter(([key, item]) => key !== 'attrs' || Object.keys(item as object).length > 0)
    return Object.fromEntries(entries)
  }
  return JSON.stringify(plain(doc ?? null))
}

/**
 * What identifies a field's value, so a re-read that fills in an avatar or a sprint's dates does
 * not look like someone else's change. Labels compare as a set.
 */
function identity(field: keyof IssueDetail, issue: Fields): unknown {
  switch (field) {
    case 'description':
      return descriptionIdentity(issue.description)
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
export const changedSince = (entry: UndoEntry, current: Fields): string =>
  changedFields(entry.after, current)

/** The fields of `shown` that `current` no longer shows, in words. A Retry asks the same of the value a refusal put back. */
export function changedFields(shown: Fields, current: Fields): string {
  return nameFields(
    fieldsOf(shown).filter((field) => identity(field, shown) !== identity(field, current)),
  )
}

/** The edits made in this session, newest on top. It lives in memory and ends with the session. */
export class UndoStack {
  private entries: StackEntry[] = []
  private listeners = new Set<(entry: StackEntry) => void>()

  get size(): number {
    return this.entries.length
  }

  push(entry: StackEntry): void {
    this.entries.push(entry)
    if (this.entries.length > UNDO_DEPTH) this.entries.shift()
    for (const listener of this.listeners) listener(entry)
  }

  /** Takes the newest edit off the stack. */
  pop(): StackEntry | undefined {
    return this.entries.pop()
  }

  /** Takes one edit off the stack wherever it sits, such as the one an older toast offers to undo. */
  take(entry: StackEntry): StackEntry | undefined {
    const at = this.entries.indexOf(entry)
    return at === -1 ? undefined : this.entries.splice(at, 1)[0]
  }

  clear(): void {
    this.entries = []
  }

  /** Called with each edit as it lands. Returns the unsubscribe function. */
  onPush(listener: (entry: StackEntry) => void): () => void {
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

/**
 * What an accepted batch does: its changed issues go on the stack as one entry, which `title` words
 * from their count. A batch that is itself an undo (`undoing`) is not recorded.
 */
export function batchRecorder(
  client: QueryClient,
  title: (changed: number) => string,
  undoing = false,
) {
  return (done: BatchDone[]) => {
    if (!undoing && done.length > 0) undoStack(client).push(batchEntry(title(done.length), done))
  }
}

const stacks = new WeakMap<QueryClient, UndoStack>()

/** The stack of one client, which stands for one login. */
export function undoStack(client: QueryClient): UndoStack {
  const held = stacks.get(client) ?? new UndoStack()
  stacks.set(client, held)
  return held
}
