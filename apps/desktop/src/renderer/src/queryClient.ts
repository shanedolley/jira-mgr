import type { JiraMgrError } from '@jira-mgr/core'
import { QueryClient } from '@tanstack/react-query'

declare module '@tanstack/react-query' {
  interface Register {
    /** `call` rejects with the core error shape, so every query and mutation fails with one. */
    defaultError: JiraMgrError
  }
}

/** Live fetch (ADR-0002): data is stale at once, and a window that regains focus refetches it. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // A Jira failure here is a state to show with a Retry button, not something to hide by retrying.
      queries: { refetchOnWindowFocus: true, staleTime: 0, retry: false },
    },
  })
}
