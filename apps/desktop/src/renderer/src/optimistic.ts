import type { Issue, JiraMgrError } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'
import type { MutationOptions, QueryClient } from '@tanstack/react-query'

import type { IssuePhase, SetSummaryArgs } from '../../shared/ipc'

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
  patch: Partial<Issue>
  /** The same fields as they were before. */
  previous: Partial<Issue>
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Applies `edit` to the issue in every cache that holds it: each phase and its own read. */
function editEverywhere(client: QueryClient, key: string, edit: <T extends Issue>(issue: T) => T) {
  for (const phase of PHASES) {
    client.setQueryData<Issue[]>(phaseKey(phase), (issues) =>
      issues?.map((issue) => (issue.key === key ? edit(issue) : issue)),
    )
  }
  client.setQueryData<IssueDetail>(issueDetailKey(key), (detail) => detail && edit(detail))
}

/** The query keys of the caches that hold the issue now. */
function holding(client: QueryClient, key: string): (readonly string[])[] {
  const keys: (readonly string[])[] = PHASES.map(phaseKey).filter((phaseQuery) =>
    client.getQueryData<Issue[]>(phaseQuery)?.some((issue) => issue.key === key),
  )
  if (client.getQueryData(issueDetailKey(key)) !== undefined) keys.push(issueDetailKey(key))
  return keys
}

function current(client: QueryClient, key: string): Issue | undefined {
  for (const phase of PHASES) {
    const found = client.getQueryData<Issue[]>(phaseKey(phase))?.find((issue) => issue.key === key)
    if (found !== undefined) return found
  }
  return client.getQueryData<IssueDetail>(issueDetailKey(key))
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
 */
export function issueMutation<A extends { key: string }>(
  client: QueryClient,
  send: (args: A) => Promise<unknown>,
  patchOf: (args: A) => Partial<Issue>,
  reread: (key: string) => Promise<IssueDetail>,
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
      ) as Partial<Issue>
      editEverywhere(client, key, (issue) => ({ ...issue, ...patch }))
      return { key, patch, previous }
    },
    onError(_error, _args, rollback) {
      if (rollback === undefined) return
      editEverywhere(client, rollback.key, (issue) => {
        const back: Partial<Issue> = {}
        for (const field of Object.keys(rollback.patch) as (keyof Issue)[]) {
          if (same(issue[field], rollback.patch[field])) {
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
export function summaryMutation(
  client: QueryClient,
  send: (args: SetSummaryArgs) => Promise<unknown>,
  reread: (key: string) => Promise<IssueDetail>,
) {
  return issueMutation(client, send, ({ summary }) => ({ summary }), reread)
}
