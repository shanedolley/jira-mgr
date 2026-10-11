import { JiraMgrError, type Issue } from '@jira-mgr/core'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { InboxEntry } from '../../shared/ipc'
import {
  age,
  inboxKey,
  markAllReadMutation,
  markReadMutation,
  newestUpdated,
  unreadCount,
} from './inboxQueries'

const entry = (key: string, updated: string, unread = true): InboxEntry => ({
  issue: { key, updated, summary: key, status: { name: 'To Do' } } as Issue,
  unread,
  change: unread ? { by: 'Ben Carey', summary: 'Status: To Do to Done', at: updated } : null,
})

const A = entry('PSAPAC-1', '2026-10-10T01:00:00.000Z')
const B = entry('PSAPAC-2', '2026-10-10T02:00:00.000Z')
const C = entry('PSAPAC-3', '2026-10-10T03:00:00.000Z')
const stored = [C, B, A]

/** A client whose cache holds `stored` and whose refetch reads `file`, as `inbox:list` reads the file. */
function setup(file: () => InboxEntry[] = () => stored) {
  const client = new QueryClient()
  client.setQueryData(inboxKey, stored)
  const read = vi.fn(() => Promise.resolve(file()))
  const observer = new QueryObserver(client, { queryKey: inboxKey, queryFn: read })
  const unsubscribe = observer.subscribe(() => undefined)
  return { client, read, unsubscribe }
}
const cached = (client: QueryClient) => client.getQueryData<InboxEntry[]>(inboxKey)
const unreadKeys = (client: QueryClient) =>
  cached(client)
    ?.filter((e) => e.unread)
    .map((e) => e.issue.key)

function held<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('unreadCount and newestUpdated', () => {
  it('counts the unread entries', () => {
    expect(unreadCount([A, B, entry('PSAPAC-4', A.issue.updated, false)])).toBe(2)
    expect(unreadCount([])).toBe(0)
  })

  it('finds the newest updated time, whatever the order, and none in an empty list', () => {
    expect(newestUpdated([A, C, B])).toBe('2026-10-10T03:00:00.000Z')
    expect(newestUpdated([])).toBeNull()
  })
})

describe('age', () => {
  const now = Date.parse('2026-10-11T12:00:00.000Z')
  it.each([
    ['2026-10-11T11:59:30.000Z', 'now'],
    ['2026-10-11T12:05:00.000Z', 'now'],
    ['2026-10-11T11:55:00.000Z', '5m'],
    ['2026-10-11T09:30:00.000Z', '2h'],
    ['2026-10-09T12:00:00.000Z', '2d'],
    ['2026-09-27T12:00:00.000Z', '14d'],
  ])('reads %s as %s', (iso, text) => {
    expect(age(iso, now)).toBe(text)
  })
})

describe('markReadMutation', () => {
  it('shows the entry read at once, before the write answers', async () => {
    const { client, unsubscribe } = setup()
    const write = held<null>()
    const done = new MutationObserver(
      client,
      markReadMutation(client, () => write.promise),
    ).mutate({ key: 'PSAPAC-2', updated: B.issue.updated })
    await expect.poll(() => unreadKeys(client)).toEqual(['PSAPAC-3', 'PSAPAC-1'])
    expect(cached(client)?.find((e) => e.issue.key === 'PSAPAC-2')?.change).toBeNull()
    write.resolve(null)
    await done
    unsubscribe()
  })

  it('leaves an entry that changed after the time the user saw unread', async () => {
    const { client, unsubscribe } = setup()
    await new MutationObserver(
      client,
      markReadMutation(client, () => Promise.resolve(null)),
    ).mutate({ key: 'PSAPAC-2', updated: '2026-10-10T01:59:59.000Z' })
    expect(unreadKeys(client)).toContain('PSAPAC-2')
    unsubscribe()
  })

  it('reads the file again once it settles, and again when the write is refused', async () => {
    const { client, read, unsubscribe } = setup(() => [C, B, A])
    // The observer's own first fetch.
    await expect.poll(() => read.mock.calls.length).toBe(1)
    await new MutationObserver(
      client,
      markReadMutation(client, () => Promise.resolve(null)),
    ).mutate({ key: 'PSAPAC-1', updated: A.issue.updated })
    await expect.poll(() => read.mock.calls.length).toBe(2)

    await expect(
      new MutationObserver(
        client,
        markReadMutation(client, () =>
          Promise.reject(new JiraMgrError('internal', 'Cannot write inbox.json.')),
        ),
      ).mutate({ key: 'PSAPAC-1', updated: A.issue.updated }),
    ).rejects.toMatchObject({ code: 'internal' })
    // The refusal puts the file's marks back on screen.
    await expect.poll(() => read.mock.calls.length).toBe(3)
    await expect.poll(() => unreadKeys(client)).toEqual(['PSAPAC-3', 'PSAPAC-2', 'PSAPAC-1'])
    unsubscribe()
  })
})

describe('markAllReadMutation', () => {
  it('shows every entry up to the time read, and a newer one unread', async () => {
    const { client, unsubscribe } = setup()
    const write = held<null>()
    const done = new MutationObserver(
      client,
      markAllReadMutation(client, () => write.promise),
    ).mutate({ through: B.issue.updated })
    await expect.poll(() => unreadKeys(client)).toEqual(['PSAPAC-3'])
    write.resolve(null)
    await done
    unsubscribe()
  })
})
