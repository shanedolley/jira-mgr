import { useQuery } from '@tanstack/react-query'

import { call } from './ipc'
import { sprintKey } from './optimistic'

/**
 * One sprint with its issues and counts. It reads again each time the page opens (ADR-0002), and
 * the page shows the last copy meanwhile.
 */
export function useSprintReport(id: number) {
  return useQuery({
    queryKey: [...sprintKey, id],
    queryFn: () => call('sprints:get', { id }),
  })
}
