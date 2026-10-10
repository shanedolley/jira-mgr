import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { StartTimerArgs, StopTimerArgs, SwitchTimerArgs, TimerOutcome } from '../../shared/ipc'
import { readIssue } from './activityQueries'
import { call } from './ipc'
import { worklogsKey } from './queries'

export const timerKey = ['timer'] as const

/** `jm timer` shares the file, so the app looks again this often and on window focus. */
const POLL_MS = 5000

export function useTimer() {
  return useQuery({
    queryKey: timerKey,
    queryFn: () => call('timer:get'),
    refetchInterval: POLL_MS,
  })
}

/** Shows the timer file the call left, and reads what a logged worklog changed on its issue. */
function settle(client: QueryClient, outcome: TimerOutcome): void {
  client.setQueryData(timerKey, outcome.snapshot)
  if (outcome.logged === null || outcome.stopped === null) return
  const key = outcome.stopped.issueKey
  void client.invalidateQueries({ queryKey: worklogsKey(key) })
  void readIssue(client, key)
}

export function useStartTimer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: StartTimerArgs) => call('timer:start', args),
    onSuccess: (outcome) => {
      settle(client, outcome)
    },
    onError: () => client.invalidateQueries({ queryKey: timerKey }),
  })
}

export function useStopTimer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: StopTimerArgs) => call('timer:stop', args),
    onSuccess: (outcome) => {
      settle(client, outcome)
    },
    onError: () => client.invalidateQueries({ queryKey: timerKey }),
  })
}

export function useSwitchTimer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: SwitchTimerArgs) => call('timer:switch', args),
    onSuccess: (outcome) => {
      settle(client, outcome)
    },
    onError: () => client.invalidateQueries({ queryKey: timerKey }),
  })
}
