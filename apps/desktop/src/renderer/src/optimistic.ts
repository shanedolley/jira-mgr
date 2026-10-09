import type { Issue, JiraMgrError } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'
import type { MutationOptions, QueryClient } from '@tanstack/react-query'

import type {
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

export const PHASES: readonly IssuePhase[] = ['unresolved', 'done']

export function phaseKey(phase: IssuePhase) {
  return phase === 'unresolved' ? unresolvedKey : doneKey
}

/** The phase a status category belongs to, as the two searches split them. */
const phaseOf = (issue: Issue): IssuePhase =>
  issue.status.category === 'done' ? 'done' : 'unresolved'

/**
 * Edits in flight per issue and client. It lives outside the mutation options because a hook
 * builds new options on every render, and two editors must count against the same total.
 */
const inFlight = new WeakMap<QueryClient, Map<string, number>>()

function flights(client: QueryClient): Map<string, number> {
  const held = inFlight.get(client) ?? new Map<string, number>()
  inFlight.set(client, held)
  return held
}

interface Rollback {
  key: string
  /** The fields the edit changed, as it showed them. */
  patch: Partial<IssueDetail>
  /** The same fields as they were before. */
  previous: Partial<IssueDetail>
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
}

/** The fields of `patch` that a listed issue has. */
function listFields(patch: Partial<IssueDetail>): Partial<IssueDetail> {
  return Object.fromEntries(Object.entries(patch).filter(([field]) => !DETAIL_ONLY.includes(field)))
}

/** The query keys of the caches that hold the issue now. */
function holding(client: QueryClient, key: string): (readonly string[])[] {
  const keys: (readonly string[])[] = PHASES.map(phaseKey).filter((phaseQuery) =>
    client.getQueryData<Issue[]>(phaseQuery)?.some((issue) => issue.key === key),
  )
  if (client.getQueryData(issueDetailKey(key)) !== undefined) keys.push(issueDetailKey(key))
  return keys
}

/**
 * The issue as the caches show it now, or `undefined` when none holds it. The page's own read
 * comes first, since it alone has the description, so a rollback restores the one it showed.
 */
export function current(client: QueryClient, key: string): IssueDetail | Issue | undefined {
  const detail = client.getQueryData<IssueDetail>(issueDetailKey(key))
  if (detail !== undefined) return detail
  for (const phase of PHASES) {
    const found = client.getQueryData<Issue[]>(phaseKey(phase))?.find((issue) => issue.key === key)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Puts an issue read afresh into the caches. The phase lists keep the plain issue, in the phase
 * its status category belongs to, so a transition to Done moves it across without reloading
 * either phase. The read itself replaces the page's copy.
 */
export function applyFreshIssue(client: QueryClient, fresh: IssueDetail): void {
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
 * An edit to one issue that shows at once, rolls back if Jira refuses, and then reads that issue
 * again. `patchOf` names the fields the edit changes, as the issue will show them. The patch goes
 * into every cache that holds the issue (each phase and the page's own read), and a refusal puts
 * back only the fields the edit changed, and only while they still show the optimistic value, so
 * a failure never undoes a later edit. Once the last edit to that issue settles, whatever the
 * outcome, `reread` fetches the issue and the caches take Jira's answer, including anything Jira
 * changed on its own, such as a remaining estimate. Only the one issue is read: no list is
 * cancelled or reloaded unless the read itself fails, so an edit never restarts the Done load.
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
      const patch = patchOf(args)
      // Counted before the first await, so every edit is counted before any of them settles.
      flights(client).set(key, (flights(client).get(key) ?? 0) + 1)
      // A refetch landing now would overwrite the optimistic value with Jira's old one.
      await Promise.all(holding(client, key).map((queryKey) => client.cancelQueries({ queryKey })))
      const before = current(client, key)
      if (before === undefined) return undefined
      const previous = Object.fromEntries(
        Object.keys(patch).map((field) => [field, before[field as keyof Issue]]),
      ) as Partial<IssueDetail>
      editEverywhere(client, key, (issue, detail) => ({
        ...issue,
        ...(detail ? patch : listFields(patch)),
      }))
      return { key, patch, previous }
    },
    onSuccess(_data, args, rollback) {
      if (rollback !== undefined)
        record?.(args, { patch: rollback.patch, before: rollback.previous })
    },
    onError(_error, _args, rollback) {
      if (rollback === undefined) return
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
    },
    async onSettled(_data, _error, { key }) {
      // A read while another edit is in flight would bring back Jira's old value over that
      // edit's optimistic one. The last to settle reads, even when edits settle in one tick.
      const left = (flights(client).get(key) ?? 1) - 1
      if (left > 0) {
        flights(client).set(key, left)
        return
      }
      flights(client).delete(key)
      try {
        applyFreshIssue(client, await reread(key))
      } catch {
        // The edit went through or was refused either way; the lists reload to show what Jira holds.
        await Promise.all(
          holding(client, key).map((queryKey) => client.invalidateQueries({ queryKey })),
        )
      }
    },
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

/**
 * Puts a new issue into the caches without reloading a list: the read-back lands in the phase its
 * status belongs to, and the page's own read takes it too. A create whose read-back failed has no
 * issue to put, so the unresolved list reloads and shows what Jira holds.
 */
export function applyCreated(client: QueryClient, created: CreatedIssue): void {
  if (created.issue === null) {
    void client.invalidateQueries({ queryKey: unresolvedKey })
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
