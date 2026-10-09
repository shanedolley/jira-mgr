import type { Issue } from '@jira-mgr/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { LoginArgs, SessionState } from '../../shared/ipc'
import { call } from './ipc'
import { issuesKey, summaryMutation } from './optimistic'

export const sessionKey = ['session'] as const

/** Who is logged in. It changes only when this app logs in or out, so it never refetches by itself. */
export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: () => call('session:get'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useIssues() {
  return useQuery({ queryKey: issuesKey, queryFn: () => call('issues:list') })
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: LoginArgs) => call('session:login', args),
    onSuccess: (state: SessionState) => {
      client.setQueryData(sessionKey, state)
    },
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => call('session:logout'),
    onSuccess: (state: SessionState) => {
      // The next account must not see this one's issues.
      client.removeQueries({ queryKey: issuesKey })
      client.setQueryData(sessionKey, state)
    },
  })
}

export function useSetSummary() {
  const client = useQueryClient()
  return useMutation(summaryMutation(client, (args) => call('issues:setSummary', args)))
}

export type { Issue }
