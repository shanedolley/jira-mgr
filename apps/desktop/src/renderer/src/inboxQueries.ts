import type { JiraMgrError } from '@jira-mgr/core'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
} from '@tanstack/react-query'

import type { InboxEntry, MarkInboxAllReadArgs, MarkInboxReadArgs } from '../../shared/ipc'
import { call } from './ipc'

export const inboxKey = ['inbox'] as const

/** The Inbox looks again this often, besides on window focus, so the sidebar badge stays current. */
export const INBOX_POLL_MS = 5 * 60_000

/**
 * The Inbox, refetched on window focus and, with `poll`, every `INBOX_POLL_MS`. The sidebar polls;
 * the page reads the same query without a timer of its own, so one timer runs. TanStack Query
 * starts no second fetch while one runs, so a poll that falls on a running read is skipped.
 */
export function useInbox(poll = true) {
  return useQuery({
    queryKey: inboxKey,
    queryFn: () => call('inbox:list'),
    refetchInterval: poll ? INBOX_POLL_MS : false,
  })
}

export const unreadCount = (entries: readonly InboxEntry[]): number =>
  entries.filter((entry) => entry.unread).length

/** The newest `updated` time in the list, which Mark all read sends. `null` for an empty list. */
export function newestUpdated(entries: readonly InboxEntry[]): string | null {
  return entries.reduce<string | null>(
    (newest, { issue }) =>
      newest === null || Date.parse(issue.updated) > Date.parse(newest) ? issue.updated : newest,
    null,
  )
}

const read = (entry: InboxEntry): InboxEntry => ({ ...entry, unread: false, change: null })

/** Shows the entries a mark covers as read at once. Main writes the file, and the settle reads it back. */
async function showRead(
  client: QueryClient,
  covers: (entry: InboxEntry) => boolean,
): Promise<void> {
  // A fetch landing now would put the unread marks back until the write is done.
  await client.cancelQueries({ queryKey: inboxKey })
  client.setQueryData<InboxEntry[]>(inboxKey, (entries) =>
    entries?.map((entry) => (covers(entry) ? read(entry) : entry)),
  )
}

const settle = (client: QueryClient) => () => client.invalidateQueries({ queryKey: inboxKey })

/** Opening an entry: the issue is read up to the `updated` time the user saw. */
export function markReadMutation(
  client: QueryClient,
  send: (args: MarkInboxReadArgs) => Promise<null>,
): MutationOptions<null, JiraMgrError, MarkInboxReadArgs> {
  return {
    mutationFn: send,
    onMutate: ({ key, updated }) =>
      showRead(
        client,
        ({ issue }) => issue.key === key && Date.parse(issue.updated) <= Date.parse(updated),
      ),
    onSettled: settle(client),
  }
}

/** Mark all read: every entry updated up to `through` is read. */
export function markAllReadMutation(
  client: QueryClient,
  send: (args: MarkInboxAllReadArgs) => Promise<null>,
): MutationOptions<null, JiraMgrError, MarkInboxAllReadArgs> {
  return {
    mutationFn: send,
    onMutate: ({ through }) =>
      showRead(client, ({ issue }) => Date.parse(issue.updated) <= Date.parse(through)),
    onSettled: settle(client),
  }
}

export function useMarkInboxRead() {
  const client = useQueryClient()
  return useMutation(markReadMutation(client, (args) => call('inbox:markRead', args)))
}

export function useMarkInboxAllRead() {
  const client = useQueryClient()
  return useMutation(markAllReadMutation(client, (args) => call('inbox:markAllRead', args)))
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "now", "5m", "3h" or "2d": how long ago `iso` was. A future time reads as "now". */
export function age(iso: string, now: number): string {
  const elapsed = now - Date.parse(iso)
  if (elapsed < MINUTE) return 'now'
  if (elapsed < HOUR) return `${String(Math.floor(elapsed / MINUTE))}m`
  if (elapsed < DAY) return `${String(Math.floor(elapsed / HOUR))}h`
  return `${String(Math.floor(elapsed / DAY))}d`
}
