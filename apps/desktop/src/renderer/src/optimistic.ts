import type { Issue, JiraMgrError } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'
import type { SprintReport } from '@jira-mgr/core/sprints'
import type { MutationOptions, QueryClient } from '@tanstack/react-query'

import type {
  BatchChange,
  BatchItem,
  BatchOutcome,
  CreatedIssue,
  DeleteIssueArgs,
  DeletedIssue,
  IssuePhase,
  SetSummaryArgs,
} from '../../shared/ipc'

/** Prefix of both phase queries and of every issue read on its own. */
export const issuesKey = ['issues'] as const
export const unresolvedKey = ['issues', 'unresolved'] as const
export const doneKey = ['issues', 'done'] as const

/** One issue with its description and subtasks, as the page reads it. */
export const issueDetailKey = (key: string) => ['issues', 'detail', key] as const

/** Prefix of the Sprint page's reads, one per sprint. */
export const sprintKey = ['sprint'] as const

/**
 * Marks every sprint read stale. An open Sprint page refetches at once; one that is not open
 * refetches when it opens. Each way an issue changes, which can change a sprint's rows and counts,
 * calls it: an edit, a create, a delete and a read of an issue that Jira changed on its own.
 */
export function invalidateSprints(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: sprintKey })
}

export const PHASES: readonly IssuePhase[] = ['unresolved', 'done']

export function phaseKey(phase: IssuePhase) {
  return phase === 'unresolved' ? unresolvedKey : doneKey
}

/** The phase a status category belongs to, as the two searches split them. */
const phaseOf = (issue: Issue): IssuePhase =>
  issue.status.category === 'done' ? 'done' : 'unresolved'

/** An edit in line: its arguments, naming it when it settles, and the call that lets it send. */
interface Flight {
  args: object
  go: () => void
}

/**
 * Edits in flight per issue and client, oldest first. It lives outside the mutation options
 * because a hook builds new options on every render, and two editors must queue in the same line.
 */
const inFlight = new WeakMap<QueryClient, Map<string, Flight[]>>()

function flights(client: QueryClient): Map<string, Flight[]> {
  const held = inFlight.get(client) ?? new Map<string, Flight[]>()
  inFlight.set(client, held)
  return held
}

interface Rollback {
  key: string
  /** The fields the edit changed, as it showed them. */
  patch: Partial<IssueDetail>
  /** The same fields as they were before. */
  previous: Partial<IssueDetail>
  /** The Sprint page reads the edit took the issue off, as they held it, for a refusal to put back. */
  left?: Left[]
}

interface Left {
  queryKey: readonly unknown[]
  issue: Issue
}

/** Fields only the page's own read holds. The listed issues have neither, so an edit never adds them. */
const DETAIL_ONLY = ['description', 'subtasks']

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Applies `edit` to the issue in every cache that holds it: each phase and its own read. `detail`
 * tells `edit` which kind of copy it has, since only the page's own read holds the description.
 */
function editEverywhere(
  client: QueryClient,
  key: string,
  edit: <T extends Issue>(issue: T, detail: boolean) => T,
) {
  for (const phase of PHASES) {
    client.setQueryData<Issue[]>(phaseKey(phase), (issues) =>
      issues?.map((issue) => (issue.key === key ? edit(issue, false) : issue)),
    )
  }
  client.setQueryData<IssueDetail>(issueDetailKey(key), (detail) => detail && edit(detail, true))
  // The Sprint page lists its own copies, which an edit made from its rows must show at once too.
  client.setQueriesData<SprintReport>({ queryKey: sprintKey }, (report) =>
    report?.issues.some((issue) => issue.key === key)
      ? {
          ...report,
          issues: report.issues.map((issue) => (issue.key === key ? edit(issue, false) : issue)),
        }
      : report,
  )
}

/**
 * Shows `count` as the issue's comment count in every cache that holds it, at once. The comment
 * list calls it after a post or delete; the next Tree refresh confirms the number.
 */
export function showCommentCount(client: QueryClient, key: string, count: number): void {
  editEverywhere(client, key, (issue) => ({ ...issue, commentCount: count }))
}

/**
 * Takes the issue off each Sprint page read whose sprint a `sprints` patch no longer lists, as a
 * move to another sprint or to Backlog does, so the row leaves at once. Returns the copies taken.
 */
function leaveSprints(client: QueryClient, key: string, patch: Partial<IssueDetail>): Left[] {
  const { sprints } = patch
  if (sprints === undefined) return []
  const left: Left[] = []
  for (const [queryKey, report] of client.getQueriesData<SprintReport>({ queryKey: sprintKey })) {
    const held = report?.issues.find((i) => i.key === key)
    if (report === undefined || held === undefined) continue
    if (sprints.some((s) => s.id === report.sprint.id)) continue
    left.push({ queryKey, issue: held })
    client.setQueryData<SprintReport>(queryKey, {
      ...report,
      issues: report.issues.filter((i) => i.key !== key),
    })
  }
  return left
}

/** The fields of `patch` that a listed issue has. */
function listFields(patch: Partial<IssueDetail>): Partial<IssueDetail> {
  return Object.fromEntries(Object.entries(patch).filter(([field]) => !DETAIL_ONLY.includes(field)))
}

/** The query keys of the caches that hold the issue now, the Sprint pages' reads included. */
function holding(client: QueryClient, key: string): (readonly unknown[])[] {
  const keys: (readonly unknown[])[] = PHASES.map(phaseKey).filter((phaseQuery) =>
    client.getQueryData<Issue[]>(phaseQuery)?.some((issue) => issue.key === key),
  )
  if (client.getQueryData(issueDetailKey(key)) !== undefined) keys.push(issueDetailKey(key))
  // A refetch of a sprint that lands mid-edit would bring back the old value over the optimistic one.
  for (const [queryKey, report] of client.getQueriesData<SprintReport>({ queryKey: sprintKey })) {
    if (report?.issues.some((issue) => issue.key === key) === true) keys.push(queryKey)
  }
  return keys
}

/** The issue as the caches show it now, or `undefined` when none holds it. */
export function current(client: QueryClient, key: string): Issue | undefined {
  for (const phase of PHASES) {
    const found = client.getQueryData<Issue[]>(phaseKey(phase))?.find((issue) => issue.key === key)
    if (found !== undefined) return found
  }
  const detail = client.getQueryData<IssueDetail>(issueDetailKey(key))
  if (detail !== undefined) return detail
  // An issue only an open Sprint page holds, such as a Done one before its phase loads.
  for (const [, report] of client.getQueriesData<SprintReport>({ queryKey: sprintKey })) {
    const found = report?.issues.find((issue) => issue.key === key)
    if (found !== undefined) return found
  }
  return undefined
}

/** True while an edit to the issue is in flight, so its optimistic value is not Jira's yet. */
export function isEditing(client: QueryClient, key: string): boolean {
  return flights(client).has(key)
}

/**
 * The fields of issue `key` that a mutation with these variables has changed on screen: its
 * optimistic patch, or the summary. Every other mutation, such as a create or another issue's
 * edit, changes none.
 */
export function pendingFields(key: string, variables: unknown): string[] {
  if (typeof variables !== 'object' || variables === null) return []
  if (!('key' in variables) || variables.key !== key) return []
  if ('patch' in variables && typeof variables.patch === 'object' && variables.patch !== null) {
    return Object.keys(variables.patch)
  }
  return 'summary' in variables ? ['summary'] : []
}

/**
 * Puts a read that was not asked for by an edit, such as a created issue's second read, into the
 * caches. While an edit of the issue is in flight the read would bring back the old value over the
 * optimistic one, so it is skipped: the edit reads the issue itself once it settles.
 */
export function applyUnaskedRead(client: QueryClient, fresh: IssueDetail): void {
  if (!isEditing(client, fresh.key)) applyFreshIssue(client, fresh)
}

/**
 * Puts an issue read afresh into the caches. The phase lists keep the plain issue, in the phase
 * its status category belongs to, so a transition to Done moves it across without reloading
 * either phase. The read itself replaces the page's copy.
 */
export function applyFreshIssue(client: QueryClient, fresh: IssueDetail): void {
  invalidateSprints(client)
  // The lists hold the plain issue; the description and subtasks stay with the page's own read.
  const plain: Partial<IssueDetail> = { ...fresh }
  delete plain.description
  delete plain.subtasks
  const issue = plain as Issue
  const target = phaseOf(issue)
  let moved = false
  for (const phase of PHASES) {
    const issues = client.getQueryData<Issue[]>(phaseKey(phase))
    if (issues === undefined) continue
    const held = issues.some((i) => i.key === issue.key)
    if (phase === target) {
      client.setQueryData<Issue[]>(
        phaseKey(phase),
        held ? issues.map((i) => (i.key === issue.key ? issue : i)) : [...issues, issue],
      )
    } else if (held) {
      moved = true
      client.setQueryData<Issue[]>(
        phaseKey(phase),
        issues.filter((i) => i.key !== issue.key),
      )
    }
  }
  // A phase still on its first load may have paged past the issue already, so it starts again.
  if (moved && client.getQueryData(phaseKey(target)) === undefined) {
    const queryKey = phaseKey(target)
    void client.cancelQueries({ queryKey }).then(() => client.invalidateQueries({ queryKey }))
  }
  client.setQueryData<IssueDetail>(issueDetailKey(issue.key), fresh)
}

/**
 * Joins the line of edits to `key`: the promise resolves when it is this edit's turn to send. It
 * queues before anything can wait, so edits send in the order they were made.
 */
function joinLine(client: QueryClient, key: string, args: object): Promise<void> {
  const queue = flights(client).get(key) ?? []
  flights(client).set(key, queue)
  const turn = new Promise<void>((go) => queue.push({ args, go }))
  if (queue.length === 1) queue[0]?.go()
  return turn
}

/**
 * Leaves the line once the edit `args` has settled, whatever the outcome. A read while another
 * edit is in flight would bring back Jira's old value over that edit's optimistic one, so this one
 * lets the next send and the last to settle reads. An edit whose `onMutate` threw settles before
 * its turn, so it leaves the line without starting anyone.
 */
async function leaveLine(
  client: QueryClient,
  key: string,
  args: object,
  reread: (key: string) => Promise<IssueDetail>,
): Promise<void> {
  const queue = flights(client).get(key) ?? []
  const at = queue.findIndex((flight) => flight.args === args)
  if (at !== -1) queue.splice(at, 1)
  if (queue.length > 0) {
    if (at === 0) queue[0]?.go()
    return
  }
  flights(client).delete(key)
  try {
    // An edit made while this read was out, such as a quick Cmd+Z, keeps its optimistic value
    // and reads the issue itself once it settles.
    applyUnaskedRead(client, await reread(key))
  } catch {
    if (isEditing(client, key)) return
    // The edit went through or was refused either way; the lists reload to show what Jira holds.
    await Promise.all(
      holding(client, key).map((queryKey) => client.invalidateQueries({ queryKey })),
    )
    invalidateSprints(client)
  }
}

/** Puts back the fields a refused edit changed, and only those that still show its value. */
function rollBack(client: QueryClient, rollback: Rollback): void {
  for (const { queryKey, issue } of rollback.left ?? []) {
    client.setQueryData<SprintReport>(queryKey, (report) =>
      report === undefined || report.issues.some((i) => i.key === issue.key)
        ? report
        : { ...report, issues: [...report.issues, issue] },
    )
  }
  editEverywhere(client, rollback.key, (issue, detail) => {
    const back: Partial<IssueDetail> = {}
    const fields = Object.keys(detail ? rollback.patch : listFields(rollback.patch))
    for (const field of fields as (keyof IssueDetail)[]) {
      const shown = (issue as Partial<IssueDetail>)[field]
      if (same(shown, rollback.patch[field])) {
        Object.assign(back, { [field]: rollback.previous[field] })
      }
    }
    return { ...issue, ...back }
  })
}

/**
 * An edit to one issue that shows at once, rolls back if Jira refuses, and then reads that issue
 * again. `patchOf` names the fields the edit changes, as the issue will show them. The patch goes
 * into every cache that holds the issue (each phase and the page's own read), and a refusal puts
 * back only the fields the edit changed, and only while they still show the optimistic value, so
 * a failure never undoes a later edit. Edits to one issue send one at a time, in the order they
 * were made, so Jira keeps the last one made. Once the last edit to that issue settles, whatever
 * the outcome, `reread` fetches the issue and the caches take Jira's answer, including anything
 * Jira changed on its own, such as a remaining estimate, unless another edit of the issue started
 * while the read was out. Only the one issue is read: no list is cancelled or reloaded unless the
 * read itself fails, so an edit never restarts the Done load.
 * An edit Jira accepted goes to `record` with the fields as it set them and as they were, which is
 * what an undo needs (D7). A refused edit, and one on an issue no cache holds, record nothing.
 */
export function issueMutation<A extends { key: string }>(
  client: QueryClient,
  send: (args: A) => Promise<unknown>,
  patchOf: (args: A) => Partial<IssueDetail>,
  reread: (key: string) => Promise<IssueDetail>,
  record?: (args: A, done: { patch: Partial<Issue>; before: Partial<Issue> }) => void,
): MutationOptions<unknown, JiraMgrError, A, Rollback | undefined> {
  return {
    mutationFn: send,
    async onMutate(args) {
      const { key } = args
      // Queued before anything can throw or wait, so the edits send in the order they were made.
      // Two sent at once can reach Jira in either order, and Jira keeps whichever lands last.
      const turn = joinLine(client, key, args)
      const patch = patchOf(args)
      // A refetch landing now would overwrite the optimistic value with Jira's old one.
      await Promise.all(holding(client, key).map((queryKey) => client.cancelQueries({ queryKey })))
      const before = current(client, key)
      if (before === undefined) {
        await turn
        return undefined
      }
      // The description and subtasks exist only on the page's own read, so a rollback takes them from it.
      const detail = client.getQueryData<IssueDetail>(issueDetailKey(key))
      const previous = Object.fromEntries(
        Object.keys(patch).map((field) => [
          field,
          (DETAIL_ONLY.includes(field) ? detail : (before as Partial<IssueDetail>))?.[
            field as keyof IssueDetail
          ],
        ]),
      ) as Partial<IssueDetail>
      const left = leaveSprints(client, key, patch)
      editEverywhere(client, key, (issue, detail) => ({
        ...issue,
        ...(detail ? patch : listFields(patch)),
      }))
      await turn
      return { key, patch, previous, left }
    },
    onSuccess(_data, args, rollback) {
      if (rollback !== undefined)
        record?.(args, { patch: rollback.patch, before: rollback.previous })
    },
    onError(_error, _args, rollback) {
      if (rollback !== undefined) rollBack(client, rollback)
    },
    onSettled: (_data, _error, args) => leaveLine(client, args.key, args, reread),
  }
}

/** The summary edit, kept as D1 built it: the other edits share its machinery. */
export function summaryMutation<A extends SetSummaryArgs>(
  client: QueryClient,
  send: (args: A) => Promise<unknown>,
  reread: (key: string) => Promise<IssueDetail>,
  record?: (args: A, done: { patch: Partial<Issue>; before: Partial<Issue> }) => void,
) {
  return issueMutation(client, send, ({ summary }) => ({ summary }), reread, record)
}

/** One issue of a batch: what to send and what to show while Jira works. */
export interface BatchRequestItem {
  key: string
  /** The issue's numeric id, which Jira's task results name it by. */
  id: string
  change: BatchChange
  /** The fields the change sets, as the issue will show them. */
  patch: Partial<Issue>
}

/** An issue Jira changed, with the fields as the batch set them and as they were. */
export interface BatchDone {
  key: string
  change: BatchChange
  patch: Partial<Issue>
  before: Partial<Issue>
}

export interface BatchRun {
  done: BatchDone[]
  /** Each issue Jira did not change, in the order sent, with the reason. */
  refused: { key: string; reason: string }[]
}

/** Issues re-read at once after a batch, so a batch of 1000 does not open 1000 reads together. */
const REREAD_AT_ONCE = 5

/**
 * A change to several issues that shows at once, rolls back for each issue Jira refuses, and then
 * reads each issue again, as `issueMutation` does for one. The batch takes its turn in the line of
 * every issue it holds, behind earlier edits and ahead of later ones, so Jira sees each issue's
 * edits in the order they were made, and the re-read of each skips while a later edit of it is in
 * flight. An issue no cache holds is refused without a request. A failure of the whole call
 * refuses every issue. The issues Jira changed go to `record`, which is what an undo needs.
 */
export async function batchMutation(
  client: QueryClient,
  send: (items: BatchItem[]) => Promise<BatchOutcome>,
  reread: (key: string) => Promise<IssueDetail>,
  requested: readonly BatchRequestItem[],
  record?: (done: BatchDone[]) => void,
): Promise<BatchRun> {
  // One line per issue: a key that repeats would wait on its own earlier turn forever.
  const seen = new Set<string>()
  const items = requested.filter(({ key }) => !seen.has(key) && seen.add(key))
  const line = {}
  await Promise.all(items.map(({ key }) => joinLine(client, key, line)))
  // Whatever happens from here, every line is left, so a later edit of these issues is never stuck.
  try {
    await Promise.all(
      items.flatMap(({ key }) =>
        holding(client, key).map((queryKey) => client.cancelQueries({ queryKey })),
      ),
    )
    const shown = new Map<string, Rollback>()
    const missing = new Set<string>()
    for (const { key, patch } of items) {
      const before = current(client, key)
      if (before === undefined) {
        missing.add(key)
        continue
      }
      const previous = Object.fromEntries(
        Object.keys(patch).map((field) => [field, before[field as keyof Issue]]),
      ) as Partial<IssueDetail>
      editEverywhere(client, key, (issue, detail) => ({
        ...issue,
        ...(detail ? patch : listFields(patch)),
      }))
      shown.set(key, { key, patch, previous })
    }

    const sent = items.filter(({ key }) => shown.has(key))
    let outcome: BatchOutcome = { done: [], refused: [] }
    try {
      if (sent.length > 0) {
        outcome = await send(sent.map(({ key, id, change }) => ({ key, id, change })))
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      outcome = { done: [], refused: sent.map(({ key }) => ({ key, reason })) }
    }
    const reasons = new Map(outcome.refused.map(({ key, reason }) => [key, reason]))
    for (const key of reasons.keys()) {
      const rollback = shown.get(key)
      if (rollback !== undefined) rollBack(client, rollback)
    }
    const changed = new Set(outcome.done)
    const done = sent.flatMap(({ key, change, patch }) =>
      changed.has(key) ? [{ key, change, patch, before: shown.get(key)?.previous ?? {} }] : [],
    )
    if (done.length > 0) record?.(done)
    return {
      done,
      refused: items.flatMap(({ key }) => {
        const reason = missing.has(key) ? 'It is no longer loaded.' : reasons.get(key)
        return reason === undefined ? [] : [{ key, reason }]
      }),
    }
  } finally {
    for (let at = 0; at < items.length; at += REREAD_AT_ONCE) {
      await Promise.all(
        items.slice(at, at + REREAD_AT_ONCE).map(({ key }) => leaveLine(client, key, line, reread)),
      )
    }
  }
}

/**
 * Puts a new issue into the caches without reloading a list: the read-back lands in the phase its
 * status belongs to, and the page's own read takes it too. A create whose read-back failed has no
 * issue to put, so the unresolved list reloads and shows what Jira holds.
 */
export function applyCreated(client: QueryClient, created: CreatedIssue): void {
  if (created.issue === null) {
    void client.invalidateQueries({ queryKey: unresolvedKey })
    invalidateSprints(client)
    return
  }
  applyFreshIssue(client, created.issue)
}

interface DeleteRollback {
  /** The issues taken out, with the phase each came from. */
  removed: { phase: IssuePhase; issue: Issue }[]
  /** Children that kept existing and lost their parent with it. */
  orphaned: string[]
  /** The deleted key, which the children's parent is restored to. */
  parentKey: string
}

/**
 * A delete that shows at once. The issue, and the subtasks the user chose to delete with it, leave
 * every list; the children that stay lose their parent, as Jira does for an Epic. A refusal puts
 * every one back. Only the caches that hold a deleted issue are cancelled, so a delete never
 * restarts a load of the other phase. Nothing is read afterwards: the next focus refetch reconciles
 * the unresolved list, and a phase still on its first load starts again once a delete of an issue
 * no loaded list held succeeds.
 */
export function deleteMutation(
  client: QueryClient,
  send: (args: DeleteIssueArgs) => Promise<DeletedIssue>,
): MutationOptions<DeletedIssue, JiraMgrError, DeleteIssueArgs, DeleteRollback> {
  return {
    mutationFn: send,
    async onMutate({ key, deleteSubtasks, subtasks }) {
      const gone = new Set([key, ...(deleteSubtasks ? subtasks : [])])
      const holders = PHASES.map(phaseKey).filter((queryKey) =>
        client.getQueryData<Issue[]>(queryKey)?.some((i) => gone.has(i.key)),
      )
      await Promise.all(holders.map((queryKey) => client.cancelQueries({ queryKey })))
      const removed: DeleteRollback['removed'] = []
      const orphaned: string[] = []
      for (const phase of PHASES) {
        const issues = client.getQueryData<Issue[]>(phaseKey(phase))
        if (issues === undefined) continue
        for (const issue of issues) {
          if (gone.has(issue.key)) removed.push({ phase, issue })
          else if (issue.parentKey === key) orphaned.push(issue.key)
        }
        client.setQueryData<Issue[]>(
          phaseKey(phase),
          issues
            .filter((i) => !gone.has(i.key))
            .map((i) => (i.parentKey === key ? { ...i, parentKey: null } : i)),
        )
      }
      return { removed, orphaned, parentKey: key }
    },
    onSuccess(_data, { key, deleteSubtasks, subtasks }, rollback) {
      invalidateSprints(client)
      // A phase still on its first load may have paged past an issue no loaded list held, so it
      // starts again. An issue that was in a loaded list cannot be in the phase still loading.
      const found = new Set(rollback.removed.map((r) => r.issue.key))
      const unseen = [key, ...(deleteSubtasks ? subtasks : [])].some((k) => !found.has(k))
      if (!unseen) return
      for (const queryKey of PHASES.map(phaseKey)) {
        if (client.getQueryData(queryKey) === undefined && client.isFetching({ queryKey }) > 0) {
          void client.cancelQueries({ queryKey }).then(() => client.invalidateQueries({ queryKey }))
        }
      }
    },
    onError(_error, _args, rollback) {
      if (rollback === undefined) return
      const { removed, orphaned, parentKey } = rollback
      for (const phase of PHASES) {
        client.setQueryData<Issue[]>(phaseKey(phase), (issues) => {
          if (issues === undefined) return issues
          const held = new Set(issues.map((i) => i.key))
          return [
            ...issues.map((i) =>
              orphaned.includes(i.key) && i.parentKey === null ? { ...i, parentKey } : i,
            ),
            ...removed
              .filter((r) => r.phase === phase && !held.has(r.issue.key))
              .map((r) => r.issue),
          ]
        })
      }
    },
  }
}
