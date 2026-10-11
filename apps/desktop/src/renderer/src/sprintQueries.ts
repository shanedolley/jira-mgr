import { useQuery } from '@tanstack/react-query'

import { call } from './ipc'

/**
 * One sprint with its issues and counts. It reads again each time the page opens (ADR-0002), and
 * the page shows the last copy meanwhile.
 */
export function useSprintReport(id: number) {
  return useQuery({
    queryKey: ['sprint', id],
    queryFn: () => call('sprints:get', { id }),
  })
}
