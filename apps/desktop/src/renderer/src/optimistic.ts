import type { Issue, JiraMgrError } from '@jira-mgr/core'
import type { MutationOptions, QueryClient } from '@tanstack/react-query'

import type { SetSummaryArgs } from '../../shared/ipc'

export const issuesKey = ['issues'] as const
const summaryKey = ['setSummary'] as const

interface Rollback {
  key: string
  previous: string
  optimistic: string
}

function withSummary(issues: Issue[] | undefined, key: string, summary: string) {
  return issues?.map((issue) => (issue.key === key ? { ...issue, summary } : issue))
}

/**
 * Edits a summary in the cached list at once, sends the change, and puts the old summary back
 * if Jira refuses. Only that issue is touched, and only while it still shows the optimistic
 * text, so a failure never undoes a later edit or a refetch. The list refetches once the last
 * edit in flight settles, whatever the outcome, so the cache ends up as Jira has it.
 */
export function summaryMutation(
  client: QueryClient,
  send: (args: SetSummaryArgs) => Promise<unknown>,
): MutationOptions<unknown, JiraMgrError, SetSummaryArgs, Rollback | undefined> {
  return {
    mutationKey: summaryKey,
    mutationFn: send,
    async onMutate({ key, summary }) {
      // A refetch landing now would overwrite the optimistic text with Jira's old one.
      await client.cancelQueries({ queryKey: issuesKey })
      const previous = client.getQueryData<Issue[]>(issuesKey)?.find((i) => i.key === key)?.summary
      client.setQueryData<Issue[]>(issuesKey, (issues) => withSummary(issues, key, summary))
      return previous === undefined ? undefined : { key, previous, optimistic: summary }
    },
    onError(_error, _args, rollback) {
      if (rollback === undefined) return
      client.setQueryData<Issue[]>(issuesKey, (issues) => {
        const current = issues?.find((i) => i.key === rollback.key)?.summary
        return current === rollback.optimistic
          ? withSummary(issues, rollback.key, rollback.previous)
          : issues
      })
    },
    async onSettled() {
      // This mutation still counts as pending here. A refetch while another edit is in flight
      // would bring back Jira's old summary over that edit's optimistic one; the last to settle refetches.
      if (client.isMutating({ mutationKey: summaryKey }) > 1) return
      await client.invalidateQueries({ queryKey: issuesKey })
    },
  }
}
