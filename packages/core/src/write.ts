import { z } from 'zod'

import { adfDocSchema } from './adf-schema.js'
import { JiraMgrError } from './errors.js'
import { getFieldIds } from './fields.js'
import type { HttpClient } from './http.js'
import { SWAPPABLE_TYPES, type Issue } from './issue.js'
import { getIssue, type IssueDetail } from './search.js'
import { readSettings, type FieldIds } from './state.js'
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
