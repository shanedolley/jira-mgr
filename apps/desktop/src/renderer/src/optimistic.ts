import type { Issue, JiraMgrError } from '@jira-mgr/core'
import type { MutationOptions, QueryClient } from '@tanstack/react-query'

import type { IssuePhase, SetSummaryArgs } from '../../shared/ipc'

/** Prefix of both phase queries. */
export const issuesKey = ['issues'] as const
export const unresolvedKey = ['issues', 'unresolved'] as const
export const doneKey = ['issues', 'done'] as const

export const PHASES: readonly IssuePhase[] = ['unresolved', 'done']

export function phaseKey(phase: IssuePhase) {
  return phase === 'unresolved' ? unresolvedKey : doneKey
}

/**
 * Edits in flight per client. It lives outside `summaryMutation` because the hook builds new
 * options on every render, and two editors must count against the same total.
 */
const inFlight = new WeakMap<QueryClient, number>()
/** The phases edits in flight touched, which the last edit to settle refetches. */
const touched = new WeakMap<QueryClient, Set<IssuePhase>>()

interface Rollback {
  key: string
  optimistic: string
  /** The summary each patched phase held before the edit. */
  phases: { phase: IssuePhase; previous: string }[]
}

function withSummary(issues: Issue[] | undefined, key: string, summary: string) {
  return issues?.map((issue) => (issue.key === key ? { ...issue, summary } : issue))
}

/**
 * Edits a summary in every phase cache that holds the issue at once (usually one, both while the
 * merge dedupes it), sends the change, and puts the old summary back if Jira refuses. Only that
 * issue is touched, and only while it still shows the optimistic text, so a failure never undoes
 * a later edit or a refetch. The touched phases refetch once the last edit in flight settles,
 * whatever the outcome, so the cache ends up as Jira has it. A phase the issue is not in is
 * neither cancelled nor refetched, so an edit to an open issue never restarts the Done load.
 */
export function summaryMutation(
  client: QueryClient,
  send: (args: SetSummaryArgs) => Promise<unknown>,
): MutationOptions<unknown, JiraMgrError, SetSummaryArgs, Rollback | undefined> {
  return {
    mutationFn: send,
    async onMutate({ key, summary }) {
      // Counted before the first await, so every edit is counted before any of them settles.
      inFlight.set(client, (inFlight.get(client) ?? 0) + 1)
      const holding = PHASES.filter((phase) =>
        client.getQueryData<Issue[]>(phaseKey(phase))?.some((i) => i.key === key),
      )
      const phases = touched.get(client) ?? new Set<IssuePhase>()
      for (const phase of holding) phases.add(phase)
      touched.set(client, phases)
      // A refetch landing now would overwrite the optimistic text with Jira's old one.
      await Promise.all(holding.map((phase) => client.cancelQueries({ queryKey: phaseKey(phase) })))
      const rollback: Rollback = { key, optimistic: summary, phases: [] }
      for (const phase of holding) {
        const previous = client
          .getQueryData<Issue[]>(phaseKey(phase))
          ?.find((i) => i.key === key)?.summary
        if (previous === undefined) continue
        rollback.phases.push({ phase, previous })
        client.setQueryData<Issue[]>(phaseKey(phase), (issues) => withSummary(issues, key, summary))
      }
      return rollback.phases.length === 0 ? undefined : rollback
    },
    onError(_error, _args, rollback) {
      if (rollback === undefined) return
      for (const { phase, previous } of rollback.phases) {
        client.setQueryData<Issue[]>(phaseKey(phase), (issues) => {
          const current = issues?.find((i) => i.key === rollback.key)?.summary
          return current === rollback.optimistic
            ? withSummary(issues, rollback.key, previous)
            : issues
        })
      }
    },
    async onSettled() {
      // A refetch while another edit is in flight would bring back Jira's old summary over that
      // edit's optimistic one. The last to settle refetches, even when edits settle in one tick.
      const left = (inFlight.get(client) ?? 1) - 1
      inFlight.set(client, left)
      if (left > 0) return
      const phases = [...(touched.get(client) ?? [])]
      touched.delete(client)
      await Promise.all(
        phases.map((phase) => client.invalidateQueries({ queryKey: phaseKey(phase) })),
      )
    },
  }
}
