import { z } from 'zod'

import { adfDocSchema } from './adf-schema.js'
import { JiraMgrError } from './errors.js'
import { getFieldIds } from './fields.js'
import type { HttpClient } from './http.js'
import { SWAPPABLE_TYPES, type Issue } from './issue.js'
import { getIssue, type IssueDetail } from './search.js'
import { assertInProject, readSettings, type FieldIds } from './state.js'
import { duration, issueKey, parseInput } from './validate.js'

const ISSUE_TYPES = ['Epic', 'Story', 'Task', 'Bug', 'Subtask'] as const

const text = z.string().min(1)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const label = z.string().regex(/^\S+$/, 'A label holds no spaces.')
const required = (name: string) =>
  z.string({ error: `${name} is required.` }).min(1, `${name} is required.`)

/** Field schemas create and edit share. Edit lets the clearable ones be `null`. */
const description = adfDocSchema
const priorityId = text
const labels = z.array(label)
const originalEstimate = duration
const timeRemainingHours = z.number().nonnegative()

const createInput = z.strictObject({
  type: z.enum(ISSUE_TYPES),
  summary: text,
  // Q14: every type, Task and Bug included.
  customerId: required('Customer'),
  engagementId: required('Engagement'),
  parentKey: issueKey.optional(),
  assignee: text.optional(),
  description: description.optional(),
  priorityId: priorityId.optional(),
  labels: labels.optional(),
  originalEstimate: originalEstimate.optional(),
  timeRemainingHours: timeRemainingHours.optional(),
  startDate: date.optional(),
  dueDate: date.optional(),
})

export type CreateIssueInput = z.input<typeof createInput>

export const editInput = z
  .strictObject({
    summary: text,
    description: description.nullable(),
    /** An account id, or `null` to unassign. */
    assignee: text.nullable(),
    priorityId,
    startDate: date.nullable(),
    dueDate: date.nullable(),
    /** Replaces the labels. Use `addLabels` and `removeLabels` to change some. */
    labels,
    addLabels: labels,
    removeLabels: labels,
    parentKey: issueKey,
    customerId: text,
    engagementId: text,
    originalEstimate,
    timeRemainingHours: timeRemainingHours.nullable(),
    type: z.enum(SWAPPABLE_TYPES, { error: 'The type can change only among Story, Task and Bug.' }),
  })
  .partial()
  .refine(
    (edit) =>
      Object.entries(edit as Record<string, unknown>).some(
        ([name, value]) =>
          value !== undefined &&
          !(name.endsWith('Labels') && Array.isArray(value) && value.length === 0),
      ),
    { error: 'Nothing to change.' },
  )
  .refine((edit) => edit.labels === undefined || (!edit.addLabels && !edit.removeLabels), {
    error: 'Set the labels, or add and remove some, not both.',
  })

export type EditIssueInput = z.input<typeof editInput>

type Input = Partial<Record<string, unknown>>

/** Jira's field shapes for each input that is present. `null` stays `null`, which clears. */
function jiraFields(ids: FieldIds, input: Input): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  const set = (key: string, value: unknown, shape: (v: never) => unknown = (v) => v) => {
    if (value !== undefined) fields[key] = value === null ? null : shape(value as never)
  }
  set('summary', input.summary)
  set('description', input.description)
  set('assignee', input.assignee, (accountId: string) => ({ accountId }))
  set('priority', input.priorityId, (id: string) => ({ id }))
  set(ids.startDate, input.startDate)
  set('duedate', input.dueDate)
  set('labels', input.labels)
  set('parent', input.parentKey, (key: string) => ({ key }))
  set(ids.customer, input.customerId, (id: string) => ({ id }))
  set(ids.engagement, input.engagementId, (id: string) => ({ id }))
  set('timetracking', input.originalEstimate, (originalEstimate: string) => ({ originalEstimate }))
  set(ids.timeRemaining, input.timeRemainingHours)
  set('issuetype', input.type, (name: string) => ({ name }))
  return fields
}

const created = z.object({ id: z.string(), key: z.string() })

/**
 * Creates an issue in the project from settings, then reads it back with `getIssue` and returns it,
 * so the caller sees what Jira holds after any automation rule has run. Customer and Engagement
 * are required on every type, and a Subtask needs `parentKey`. Throws `validation_failed` before
 * any request when the input is wrong. Aborting `signal` stops the create or the read. When the
 * create succeeds and the read fails, throws `jira_error` whose `details` carry the new `key` and
 * `id`.
 */
export async function createIssue(
  http: HttpClient,
  input: CreateIssueInput,
  options: { signal?: AbortSignal } = {},
): Promise<IssueDetail> {
  const issue = parseInput(createInput, input, 'create the issue')
  if (issue.type === 'Subtask' && issue.parentKey === undefined) {
    throw new JiraMgrError(
      'validation_failed',
      'Cannot create the issue: a Subtask needs a parentKey.',
    )
  }
  const { projectKey } = await readSettings()
  if (projectKey === undefined) {
    throw new JiraMgrError('permission_denied', 'No project is set. Run `jm auth login`.')
  }
  const fields = { project: { key: projectKey }, ...jiraFields(await getFieldIds(), issue) }
  const raw = await http.request('POST', '/rest/api/3/issue', {
    body: { fields },
    signal: options.signal,
  })
  const parsed = created.safeParse(raw)
  if (!parsed.success) {
    throw new JiraMgrError('jira_error', 'Jira sent an unexpected create response.', {
      details: { issues: parsed.error.issues },
    })
  }
  const { key, id } = parsed.data
  try {
    return await getIssue(http, key, options)
  } catch (cause) {
    // The issue exists, so the caller must not lose its key to a failed read.
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new JiraMgrError(
      'jira_error',
      `Created ${key}, but could not read it back (${reason}). Do not create it again; read it with \`jm issue get ${key}\`.`,
      { details: { key, id }, cause },
    )
  }
}

/**
 * Edits an issue with one PUT holding only the fields in `input`. `null` clears an assignee, a
 * date, a description or Time remaining. Throws `validation_failed` before any request when the
 * input is wrong, including a type outside Story, Task and Bug.
 */
export async function editIssue(
  http: HttpClient,
  key: string,
  input: EditIssueInput,
): Promise<void> {
  const issueKeyValue = parseInput(issueKey, key, 'edit the issue')
  const { addLabels, removeLabels, originalEstimate, ...rest } = parseInput(
    editInput,
    input,
    `edit ${issueKeyValue}`,
  )
  const labelOps = [
    ...(addLabels ?? []).map((add) => ({ add })),
    ...(removeLabels ?? []).map((remove) => ({ remove })),
  ]
  // `edit` on timetracking keeps the remaining estimate, where `set` would reset it.
  const update: Record<string, unknown[]> = {
    ...(labelOps.length > 0 && { labels: labelOps }),
    ...(originalEstimate !== undefined && { timetracking: [{ edit: { originalEstimate } }] }),
  }
  const body = {
    fields: jiraFields(await getFieldIds(), rest),
    ...(Object.keys(update).length > 0 && { update }),
  }
  await http.request('PUT', `/rest/api/3/issue/${issueKeyValue}`, { body })
}

/**
 * Deletes an issue. `deleteSubtasks` has no default: Jira refuses a delete of an issue with
 * subtasks unless it is `true`, and the caller must say so either way.
 */
export async function deleteIssue(
  http: HttpClient,
  key: string,
  options: { deleteSubtasks: boolean },
): Promise<void> {
  const issueKeyValue = parseInput(issueKey, key, 'delete the issue')
  const { deleteSubtasks } = parseInput(
    z.strictObject({
      deleteSubtasks: z.boolean({ error: 'deleteSubtasks must be true or false.' }),
    }),
    options,
    `delete ${issueKeyValue}`,
  )
  await http.request(
    'DELETE',
    `/rest/api/3/issue/${issueKeyValue}?deleteSubtasks=${String(deleteSubtasks)}`,
  )
}

/** One issue of a `deleteIssues` run. */
export interface DeleteRequest {
  key: string
  /** Whether Jira deletes the issue's Subtasks with it. A Subtask left over refuses the delete. */
  deleteSubtasks: boolean
  /** The Subtasks the caller showed the user. A Subtask outside the list refuses the delete. */
  shown?: readonly string[]
}

/** An issue a run deleted, with the Subtasks that went with it. */
export interface DeletedKeys {
  key: string
  deletedSubtasks: string[]
}

/** An issue a run could not delete. */
export interface DeleteFailure {
  key: string
  error: JiraMgrError
}

export interface DeleteReport {
  /** In the order the run deleted them. */
  deleted: DeletedKeys[]
  failed: DeleteFailure[]
}

export interface DeleteOptions {
  /** Ends the advice a refusal for Subtasks gives: "<key> has subtasks A, B. <hint>". */
  subtaskHint: string
  /** Called as each issue settles, deleted or failed, with the issue's `deleted` entry when it went. */
  onSettled?: (settled: {
    done: number
    total: number
    key: string
    deleted: DeletedKeys | null
  }) => void
  signal?: AbortSignal
}

const asError = (error: unknown): JiraMgrError =>
  error instanceof JiraMgrError
    ? error
    : new JiraMgrError('internal', error instanceof Error ? error.message : String(error), {
        cause: error,
      })

/**
 * Deletes the issues one at a time, lowest level first: Subtasks, then Stories, Tasks and Bugs,
 * then Epics (`issueType.hierarchyLevel` ascending), so a child goes before its parent. Within a
 * level the order given holds. Every issue is read first, for its level and its Subtasks, and a
 * Subtask that an earlier delete of the run removed no longer counts. An issue that fails, from
 * the project guard to Jira's refusal, is reported and the run goes on.
 */
export async function deleteIssues(
  http: HttpClient,
  requests: readonly DeleteRequest[],
  options: DeleteOptions,
): Promise<DeleteReport> {
  const { subtaskHint, onSettled, signal } = options
  const unique = requests.filter((r, at) => requests.findIndex((o) => o.key === r.key) === at)
  const report: DeleteReport = { deleted: [], failed: [] }
  let done = 0
  const settle = (key: string, deleted: DeletedKeys | null) => {
    done += 1
    onSettled?.({ done, total: unique.length, key, deleted })
  }
  const fail = (key: string, error: unknown) => {
    report.failed.push({ key, error: asError(error) })
    settle(key, null)
  }

  const read: { request: DeleteRequest; level: number; subtasks: string[] }[] = []
  for (const request of unique) {
    try {
      await assertInProject(request.key)
      const issue = await getIssue(http, request.key, { signal })
      read.push({
        request,
        level: issue.issueType.hierarchyLevel,
        subtasks: issue.subtasks.map((s) => s.key),
      })
    } catch (error) {
      if (signal?.aborted === true) throw error
      fail(request.key, error)
    }
  }

  const gone = new Set<string>()
  // `sort` is stable, so equal levels keep the order given.
  for (const { request, subtasks } of read.sort((a, b) => a.level - b.level)) {
    const { key, deleteSubtasks, shown } = request
    signal?.throwIfAborted()
    try {
      // A Subtask this run deleted is gone, so it neither blocks the parent nor goes with it.
      const keys = subtasks.filter((k) => !gone.has(k))
      if (keys.length > 0 && !deleteSubtasks) {
        throw new JiraMgrError(
          'validation_failed',
          `${key} has subtasks ${keys.join(', ')}. ${subtaskHint}`,
          { details: { subtasks: keys } },
        )
      }
      const unseen = keys.filter((k) => !(shown ?? keys).includes(k))
      if (deleteSubtasks && unseen.length > 0) {
        throw new JiraMgrError(
          'validation_failed',
          `${key} has new subtasks ${unseen.join(', ')}. Review the list and delete again.`,
          { details: { subtasks: keys } },
        )
      }
      await deleteIssue(http, key, { deleteSubtasks })
      const deleted = { key, deletedSubtasks: deleteSubtasks ? keys : [] }
      for (const k of [key, ...deleted.deletedSubtasks]) gone.add(k)
      report.deleted.push(deleted)
      settle(key, deleted)
    } catch (error) {
      if (signal?.aborted === true) throw error
      fail(key, error)
    }
  }
  return report
}

const transitionsResponse = z.object({
  transitions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      to: z.object({
        id: z.string(),
        name: z.string(),
        statusCategory: z
          .object({ key: z.enum(['new', 'indeterminate', 'done', 'undefined']) })
          .optional(),
      }),
    }),
  ),
})

/** A move open to an issue, named by the status it reaches. */
export interface Transition {
  id: string
  /** The transition's own name, which can differ from the status it reaches. */
  name: string
  /** `category` is `null` when Jira sends none. */
  to: { id: string; name: string; category: Issue['status']['category'] | null }
}

/**
 * The transitions open to an issue in its current status, each with the status it reaches.
 * Throws `not_found` when the issue does not exist.
 */
export async function listTransitions(http: HttpClient, key: string): Promise<Transition[]> {
  const issueKeyValue = parseInput(issueKey, key, 'move the issue')
  const raw = await http.request('GET', `/rest/api/3/issue/${issueKeyValue}/transitions`)
  const parsed = transitionsResponse.safeParse(raw)
  if (!parsed.success) {
    throw new JiraMgrError(
      'jira_error',
      `Jira sent an unexpected transitions response for ${issueKeyValue}.`,
      {
        details: { issues: parsed.error.issues },
      },
    )
  }
  return parsed.data.transitions.map(({ id, name, to }) => ({
    id,
    name,
    to: { id: to.id, name: to.name, category: to.statusCategory?.key ?? null },
  }))
}

/**
 * Moves an issue to the status named `status` (case-insensitive) or with that id, by the
 * transition that reaches it, and returns the name of the status reached. Throws
 * `validation_failed` listing the statuses available when none does.
 */
export async function transitionIssue(
  http: HttpClient,
  key: string,
  status: string,
): Promise<string> {
  const issueKeyValue = parseInput(issueKey, key, 'move the issue')
  const transitions = await listTransitions(http, issueKeyValue)
  const wanted = status.toLowerCase()
  const transition = transitions.find(
    ({ to }) => to.id === status || to.name.toLowerCase() === wanted,
  )
  if (transition === undefined) {
    const available = transitions.map(({ to }) => to.name)
    throw new JiraMgrError(
      'validation_failed',
      `${issueKeyValue} cannot move to "${status}". Available: ${available.join(', ')}.`,
      { details: { available } },
    )
  }
  await http.request('POST', `/rest/api/3/issue/${issueKeyValue}/transitions`, {
    body: { transition: { id: transition.id } },
  })
  return transition.to.name
}
