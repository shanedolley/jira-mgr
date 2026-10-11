import { setTimeout as delay } from 'node:timers/promises'

import { z } from 'zod'

import { JiraMgrError } from './errors.js'
import { getFieldIds } from './fields.js'
import type { HttpClient } from './http.js'
import { inPool } from './pool.js'
import { moveToBacklog, moveToSprint } from './sprints.js'
import { issueKey, jiraId, parseInput, parseResponse } from './validate.js'
import { editInput, editIssue, transitionIssue, type EditIssueInput } from './write.js'

/** Jira's bulk endpoints take at most this many issues in one call. */
const MAX_ITEMS = 1000
/** Jira's Agile move endpoints take at most this many issues in one call. */
const SPRINT_CHUNK = 50
const FALLBACK_AT_ONCE = 5
const POLL_MS = 1000
// ponytail: a fixed 120 s cap on polling one task; make it an option if a real task runs longer.
const POLL_LIMIT_MS = 120_000
/** The task states after which Jira changes nothing more. */
const TERMINAL = ['COMPLETE', 'FAILED', 'CANCELLED', 'DEAD']

/** One change to apply to every issue that carries it. */
export type BatchChange =
  | { kind: 'edit'; changes: EditIssueInput }
  | { kind: 'status'; statusId: string }
  /** `sprintId: null` moves the issues to the backlog. */
  | { kind: 'sprint'; sprintId: number | null }

/** An issue and the change to make to it. `id` is the numeric issue id, which Jira's task results use. */
export interface BatchItem {
  key: string
  id: string
  change: BatchChange
}

export interface BatchProgress {
  /** Issues settled so far, done or refused. */
  done: number
  total: number
}

export interface BatchOptions {
  onProgress?: (progress: BatchProgress) => void
  signal?: AbortSignal
  /** Replace the wait between polls, so tests do not wait. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Milliseconds between polls of a bulk task. Defaults to 1000. */
  pollMs?: number
}

export interface BatchOutcome {
  /** Keys of the issues that changed, in input order. */
  done: string[]
  /** Keys of the issues that did not, in input order, with Jira's or core's reason. */
  refused: { key: string; reason: string }[]
}

const itemsSchema = z
  .array(
    z.strictObject({
      key: issueKey,
      id: jiraId,
      change: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('edit'), changes: editInput }),
        z.strictObject({ kind: z.literal('status'), statusId: z.string().min(1) }),
        z.strictObject({
          kind: z.literal('sprint'),
          sprintId: z.number().int().positive().nullable(),
        }),
      ]),
    }),
  )
  .max(MAX_ITEMS, `A batch holds at most ${String(MAX_ITEMS)} issues.`)

type Item = z.output<typeof itemsSchema>[number]
type Edit = Extract<Item['change'], { kind: 'edit' }>['changes']

interface Run {
  http: HttpClient
  options: BatchOptions
  total: number
  settled: number
  done: Set<string>
  refused: Map<string, string>
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** An abort is the caller's, so it ends the batch instead of refusing issues. */
function rethrowAbort(run: Run, error: unknown): void {
  if (run.options.signal?.aborted === true) throw error
}

/**
 * True for the answers that mean "Jira will not do this as one grouped call": 400 (a field or
 * workflow the bulk endpoint cannot handle) and 403. A call per issue can still get past them.
 */
function fallsBack(error: unknown): boolean {
  if (!(error instanceof JiraMgrError)) return false
  const status = (error.details as { status?: unknown } | undefined)?.status
  return status === 400 || status === 403
}

function emit(run: Run, extra = 0): void {
  run.options.onProgress?.({ done: run.settled + extra, total: run.total })
}

function settle(run: Run, key: string, reason?: string): void {
  run.settled++
  if (reason === undefined) run.done.add(key)
  else run.refused.set(key, reason)
}

function refuseAll(run: Run, items: readonly Item[], reason: string): void {
  for (const { key } of items) settle(run, key, reason)
  emit(run)
}

/** One call per issue, five at a time. A call's failure refuses only its issue. */
async function perIssue(
  run: Run,
  items: readonly Item[],
  one: (item: Item) => Promise<unknown>,
): Promise<void> {
  await inPool(items, FALLBACK_AT_ONCE, async (item) => {
    if (run.options.signal?.aborted === true) throw run.options.signal.reason
    try {
      await one(item)
      settle(run, item.key)
    } catch (error) {
      rethrowAbort(run, error)
      settle(run, item.key, reasonOf(error))
    }
    emit(run)
  })
}

const submitted = z.object({ taskId: jiraId })

const taskSchema = z.object({
  status: z.string(),
  processedAccessibleIssues: z.array(z.number()).default([]),
  failedAccessibleIssues: z.record(z.string(), z.unknown()).default({}),
})

/** Jira's reason for one failed issue: a list of messages, or one. */
function failureText(messages: unknown): string {
  const text = (Array.isArray(messages) ? messages : [messages]).filter(
    (m): m is string => typeof m === 'string',
  )
  return text.length > 0 ? text.join(' ') : 'Jira could not change it.'
}

/** Waits for the bulk task, then settles each of `items` by the lists Jira returns. */
async function poll(run: Run, items: readonly Item[], taskId: string): Promise<void> {
  const { http, options } = run
  const pollMs = options.pollMs ?? POLL_MS
  const sleep =
    options.sleep ?? ((ms: number, signal?: AbortSignal) => delay(ms, undefined, { signal }))
  for (let polls = Math.ceil(POLL_LIMIT_MS / pollMs); polls > 0; polls--) {
    await sleep(pollMs, options.signal)
    const raw = await http.request('GET', `/rest/api/3/bulk/queue/${taskId}`, {
      signal: options.signal,
    })
    const result = parseResponse(taskSchema, raw, 'bulk task')
    if (!TERMINAL.includes(result.status)) {
      const seen =
        result.processedAccessibleIssues.length + Object.keys(result.failedAccessibleIssues).length
      emit(run, Math.min(seen, items.length))
      continue
    }
    const processed = new Set(result.processedAccessibleIssues.map(String))
    const skipped =
      result.status === 'COMPLETE' ? 'Jira skipped it.' : `Jira ended the task as ${result.status}.`
    for (const { key, id } of items) {
      if (id in result.failedAccessibleIssues) {
        settle(run, key, failureText(result.failedAccessibleIssues[id]))
      } else if (processed.has(id)) settle(run, key)
      else settle(run, key, skipped)
    }
    emit(run)
    return
  }
  throw new JiraMgrError(
    'jira_error',
    `Jira is still running task ${taskId} after ${String(POLL_LIMIT_MS / 1000)} seconds. It may still change the issues, so read them before repeating the batch.`,
    { details: { taskId } },
  )
}

/**
 * Submits one bulk task for `items` and polls it. A 400 or 403 on the submit reruns the items
 * through `one`. Any other failure, or one while polling, refuses them all and retries nothing,
 * since a write may have gone through.
 */
async function viaBulk(
  run: Run,
  items: readonly Item[],
  submit: () => Promise<unknown>,
  one: (item: Item) => Promise<unknown>,
): Promise<void> {
  let taskId: string
  try {
    taskId = parseResponse(submitted, await submit(), 'bulk submit').taskId
  } catch (error) {
    rethrowAbort(run, error)
    if (fallsBack(error)) await perIssue(run, items, one)
    else refuseAll(run, items, reasonOf(error))
    return
  }
  try {
    await poll(run, items, taskId)
  } catch (error) {
    rethrowAbort(run, error)
    refuseAll(run, items, reasonOf(error))
  }
}

const idNumber = z.union([z.number(), z.string()]).transform(String)

const transitionsSchema = z.object({
  availableTransitions: z.array(
    z.object({
      transitions: z.array(
        z.object({ transitionId: idNumber, to: z.object({ statusId: idNumber }) }),
      ),
      issues: z.array(z.string()),
    }),
  ),
})

async function runStatus(run: Run, items: readonly Item[], statusId: string): Promise<void> {
  const { http, options } = run
  const one = (item: Item) => transitionIssue(http, item.key, statusId)
  let workflows: z.output<typeof transitionsSchema>['availableTransitions']
  try {
    const keys = items.map(({ key }) => key).join(',')
    // ponytail: first page of workflows only (Jira pages 50); issues on later pages go one by one.
    const raw = await http.request(
      'GET',
      `/rest/api/3/bulk/issues/transition?issueIdsOrKeys=${keys}`,
      {
        signal: options.signal,
      },
    )
    workflows = parseResponse(transitionsSchema, raw, 'bulk transitions').availableTransitions
  } catch (error) {
    rethrowAbort(run, error)
    if (fallsBack(error)) await perIssue(run, items, one)
    else refuseAll(run, items, reasonOf(error))
    return
  }
  const unmatched = new Map(items.map((item) => [item.key, item]))
  const matched: Item[] = []
  const inputs: { selectedIssueIdsOrKeys: string[]; transitionId: string }[] = []
  for (const { transitions, issues } of workflows) {
    const transition = transitions.find(({ to }) => to.statusId === statusId)
    if (transition === undefined) continue
    const members = issues.flatMap((key) => {
      const item = unmatched.get(key)
      unmatched.delete(key)
      return item === undefined ? [] : [item]
    })
    if (members.length === 0) continue
    matched.push(...members)
    inputs.push({
      selectedIssueIdsOrKeys: members.map(({ key }) => key),
      transitionId: transition.transitionId,
    })
  }
  if (matched.length > 0) {
    await viaBulk(
      run,
      matched,
      () =>
        http.request('POST', '/rest/api/3/bulk/issues/transition', {
          body: { bulkTransitionInputs: inputs, sendBulkNotification: false },
          signal: options.signal,
        }),
      one,
    )
  }
  // An issue with no matching bulk transition gets `transitionIssue`, whose refusal lists what is open.
  await perIssue(run, [...unmatched.values()], one)
}

/** The edit inputs the bulk endpoint can carry. Everything else goes one issue at a time. */
const BULK_EDITABLE = [
  'assignee',
  'priorityId',
  'labels',
  'addLabels',
  'removeLabels',
  'customerId',
  'engagementId',
  'startDate',
  'dueDate',
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A date as the bulk endpoint's documented `d/MMM/yy` format, `''` to clear, or `undefined` when
 * the two-digit year would be read as another century.
 */
function bulkDate(date: string | null): string | undefined {
  if (date === null) return ''
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
  if (year < 2000 || year > 2069) return undefined
  return `${String(day)}/${MONTHS[month - 1] ?? ''}/${String(year % 100).padStart(2, '0')}`
}

/**
 * The body of `POST /rest/api/3/bulk/issues/fields` for `changes`, or `undefined` when an input
 * is one the bulk endpoint cannot carry. Adding and removing labels in one edit also goes one
 * issue at a time, since one PUT does both and the bulk shape for it is unproven.
 */
async function bulkEditBody(keys: string[], changes: Edit): Promise<object | undefined> {
  const given: Record<string, unknown> = changes
  const used = Object.keys(given).filter((name) => {
    const value = given[name]
    return (
      value !== undefined &&
      !(name.endsWith('Labels') && Array.isArray(value) && value.length === 0)
    )
  })
  if (used.some((name) => !BULK_EDITABLE.includes(name))) return undefined
  const { addLabels = [], removeLabels = [], labels } = changes
  if (addLabels.length > 0 && removeLabels.length > 0) return undefined

  const ids = await getFieldIds()
  const actions: string[] = []
  const input: Record<string, unknown> = {}
  const singleSelect: object[] = []
  const dates: object[] = []
  const labelEdits: object[] = []
  const labelEdit = (option: string, names: string[]) => {
    actions.push('labels')
    labelEdits.push({
      bulkEditMultiSelectFieldOption: option,
      fieldId: 'labels',
      labels: names.map((name) => ({ name })),
    })
  }

  if (changes.priorityId !== undefined) {
    actions.push('priority')
    input.priority = { priorityId: changes.priorityId }
  }
  if (changes.assignee !== undefined) {
    actions.push('assignee')
    input.singleSelectClearableUserPickerFields = [
      {
        fieldId: 'assignee',
        user: changes.assignee === null ? null : { accountId: changes.assignee },
      },
    ]
  }
  for (const [fieldId, optionId] of [
    [ids.customer, changes.customerId],
    [ids.engagement, changes.engagementId],
  ] as const) {
    if (optionId === undefined) continue
    if (!/^\d+$/.test(optionId)) return undefined
    actions.push(fieldId)
    singleSelect.push({ fieldId, option: { optionId: Number(optionId) } })
  }
  for (const [fieldId, date] of [
    [ids.startDate, changes.startDate],
    ['duedate', changes.dueDate],
  ] as const) {
    if (date === undefined) continue
    const formattedDate = bulkDate(date)
    if (formattedDate === undefined) return undefined
    actions.push(fieldId)
    dates.push({ fieldId, date: { formattedDate } })
  }
  if (addLabels.length > 0) labelEdit('ADD', addLabels)
  if (removeLabels.length > 0) labelEdit('REMOVE', removeLabels)
  if (labels !== undefined) labelEdit(labels.length > 0 ? 'REPLACE' : 'REMOVE_ALL', labels)

  if (singleSelect.length > 0) input.singleSelectFields = singleSelect
  if (dates.length > 0) input.datePickerFields = dates
  if (labelEdits.length > 0) input.labelsFields = labelEdits
  return {
    editedFieldsInput: input,
    selectedActions: actions,
    selectedIssueIdsOrKeys: keys,
    sendBulkNotification: false,
  }
}

async function runEdit(run: Run, items: readonly Item[], changes: Edit): Promise<void> {
  const one = (item: Item) => editIssue(run.http, item.key, changes)
  let body: object | undefined
  try {
    body = await bulkEditBody(
      items.map(({ key }) => key),
      changes,
    )
  } catch (error) {
    rethrowAbort(run, error)
    refuseAll(run, items, reasonOf(error))
    return
  }
  if (body === undefined) {
    await perIssue(run, items, one)
    return
  }
  await viaBulk(
    run,
    items,
    () =>
      run.http.request('POST', '/rest/api/3/bulk/issues/fields', {
        body,
        signal: run.options.signal,
      }),
    one,
  )
}

/** Jira has no bulk sprint move, so the Agile move runs in chunks of its own limit. */
async function runSprint(run: Run, items: readonly Item[], sprintId: number | null): Promise<void> {
  const one = (item: Item) =>
    sprintId === null
      ? moveToBacklog(run.http, [item.key])
      : moveToSprint(run.http, sprintId, [item.key])
  for (let at = 0; at < items.length; at += SPRINT_CHUNK) {
    const chunk = items.slice(at, at + SPRINT_CHUNK)
    const keys = chunk.map(({ key }) => key)
    try {
      await (sprintId === null
        ? moveToBacklog(run.http, keys)
        : moveToSprint(run.http, sprintId, keys))
      for (const { key } of chunk) settle(run, key)
      emit(run)
    } catch (error) {
      rethrowAbort(run, error)
      if (fallsBack(error)) await perIssue(run, chunk, one)
      else refuseAll(run, chunk, reasonOf(error))
    }
  }
}

/**
 * Applies each item's change, one grouped call per distinct change where Jira has one:
 * `POST /bulk/issues/transition` for a status, `POST /bulk/issues/fields` for assignee, priority,
 * labels, Customer, Engagement, Start date and Due date, the Agile move in chunks of 50 for a
 * sprint. The rest go one issue at a time, five at a time, as does any group Jira answers 400 or
 * 403. Any other failure of a grouped call refuses its issues without a retry, since a write may
 * have gone through. A bulk task that runs past 120 seconds refuses its issues the same way.
 *
 * A refusal never throws: it lands in `refused` with the reason. Throws `validation_failed`
 * before any request for bad input, a repeated key or more than 1000 items. Aborting `signal`
 * rejects with its reason. Bulk calls send `sendBulkNotification: false`.
 */
export async function runBatch(
  http: HttpClient,
  items: readonly BatchItem[],
  options: BatchOptions = {},
): Promise<BatchOutcome> {
  const parsed = parseInput(itemsSchema, items, 'run the batch')
  if (new Set(parsed.map(({ key }) => key)).size !== parsed.length) {
    throw new JiraMgrError('validation_failed', 'Cannot run the batch: an issue key repeats.')
  }
  const run: Run = {
    http,
    options,
    total: parsed.length,
    settled: 0,
    done: new Set(),
    refused: new Map(),
  }
  const groups = new Map<string, Item[]>()
  for (const item of parsed) {
    // Parsing orders each change's keys by its schema, so equal changes make equal JSON.
    const key = JSON.stringify(item.change)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  for (const group of groups.values()) {
    const change = group[0]?.change
    if (change === undefined) continue
    if (change.kind === 'status') await runStatus(run, group, change.statusId)
    else if (change.kind === 'edit') await runEdit(run, group, change.changes)
    else await runSprint(run, group, change.sprintId)
  }
  return {
    done: parsed.filter(({ key }) => run.done.has(key)).map(({ key }) => key),
    refused: parsed.flatMap(({ key }) => {
      const reason = run.refused.get(key)
      return reason === undefined ? [] : [{ key, reason }]
    }),
  }
}
