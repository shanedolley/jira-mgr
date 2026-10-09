import { JiraMgrError, type Issue } from '@jira-mgr/core'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { doneKey, summaryMutation, unresolvedKey } from './optimistic'

function issue(key: string, summary: string): Issue {
  return { key, summary } as Issue
}

/** A promise settled by hand, so a test can look at the cache while a request is in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup() {
  const client = new QueryClient()
  client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One'), issue('PSAPAC-2', 'Two')])
  const request = deferred<null>()
  const observer = new MutationObserver(
    client,
    summaryMutation(client, () => request.promise),
  )
  const summaries = () => client.getQueryData<Issue[]>(unresolvedKey)?.map((i) => i.summary)
  return { client, observer, request, summaries }
}

const summariesOf = (client: QueryClient, key: readonly string[]) =>
  client.getQueryData<Issue[]>(key)?.map((i) => i.summary)

describe('summaryMutation', () => {
  it('shows the new summary before Jira answers', async () => {
    const { observer, request, summaries } = setup()
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    await expect.poll(summaries).toEqual(['One, edited', 'Two'])
    request.resolve(null)
    await done
    expect(summaries()).toEqual(['One, edited', 'Two'])
  })

  it('marks the list stale after a save, so the next view reads what Jira holds', async () => {
    const { client, observer, request } = setup()
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    request.resolve(null)
    await done
    expect(client.getQueryState(unresolvedKey)?.isInvalidated).toBe(true)
  })

  it('puts the old summary back when Jira refuses, and passes the error on', async () => {
    const { observer, request, summaries } = setup()
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    await expect.poll(summaries).toEqual(['One, edited', 'Two'])
    request.reject(new JiraMgrError('validation_failed', 'Jira refused the summary.'))
    await expect(done).rejects.toMatchObject({ code: 'validation_failed' })
    expect(summaries()).toEqual(['One', 'Two'])
  })

  it('leaves a later edit alone when an earlier one fails', async () => {
    const { client, observer, request, summaries } = setup()
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    await expect.poll(summaries).toEqual(['One, edited', 'Two'])
    // A second edit of the same issue lands while the first is in flight.
    client.setQueryData<Issue[]>(unresolvedKey, (issues) =>
      issues?.map((i) => (i.key === 'PSAPAC-1' ? { ...i, summary: 'One, edited again' } : i)),
    )
    request.reject(new JiraMgrError('jira_error', 'Jira is down.'))
    await expect(done).rejects.toBeInstanceOf(JiraMgrError)
    expect(summaries()).toEqual(['One, edited again', 'Two'])
  })

  it('refetches only once the last edit in flight settles', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [
      issue('PSAPAC-1', 'One'),
      issue('PSAPAC-2', 'Two'),
    ])
    const requests = { 'PSAPAC-1': deferred<null>(), 'PSAPAC-2': deferred<null>() }
    const send = ({ key }: { key: string }) => requests[key as keyof typeof requests].promise
    // Each hook render builds its own options, so the edits must be counted per client.
    const first = new MutationObserver(client, summaryMutation(client, send))
    const second = new MutationObserver(client, summaryMutation(client, send))
    const stale = () => client.getQueryState(unresolvedKey)?.isInvalidated

    const firstDone = first.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    const secondDone = second.mutate({ key: 'PSAPAC-2', summary: 'Two, edited' })
    await expect
      .poll(() => client.getQueryData<Issue[]>(unresolvedKey)?.map((i) => i.summary))
      .toEqual(['One, edited', 'Two, edited'])

    // The first edit settles while the second is in flight: a refetch now would bring back "Two".
    requests['PSAPAC-1'].resolve(null)
    await firstDone
    expect(stale()).toBe(false)

    requests['PSAPAC-2'].resolve(null)
    await secondDone
    expect(stale()).toBe(true)
  })

  it('refetches when two edits settle in the same tick', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [
      issue('PSAPAC-1', 'One'),
      issue('PSAPAC-2', 'Two'),
    ])
    const gate = deferred<null>()
    const options = summaryMutation(client, () => gate.promise)
    // Each hook render builds its own options, so the two edits must still be counted together.
    const first = new MutationObserver(
      client,
      summaryMutation(client, () => gate.promise),
    )
    const second = new MutationObserver(client, options)

    const firstDone = first.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    const secondDone = second.mutate({ key: 'PSAPAC-2', summary: 'Two, edited' })
    await expect
      .poll(() => client.getQueryData<Issue[]>(unresolvedKey)?.map((i) => i.summary))
      .toEqual(['One, edited', 'Two, edited'])

    gate.resolve(null)
    await Promise.all([firstDone, secondDone])
    expect(client.getQueryState(unresolvedKey)?.isInvalidated).toBe(true)
  })

  describe('across phases', () => {
    function phased() {
      const client = new QueryClient()
      client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
      client.setQueryData<Issue[]>(doneKey, [issue('PSAPAC-2', 'Two'), issue('PSAPAC-1', 'One')])
      const request = deferred<null>()
      const observer = new MutationObserver(
        client,
        summaryMutation(client, () => request.promise),
      )
      return { client, observer, request }
    }

    it('patches and cancels every phase that holds the issue', async () => {
      const { client, observer, request } = phased()
      // Both phases have a load in flight, which the edit must cancel.
      const unresolvedLoad = deferred<Issue[]>()
      const doneLoad = deferred<Issue[]>()
      const watchers = [
        new QueryObserver(client, {
          queryKey: unresolvedKey,
          queryFn: () => unresolvedLoad.promise,
        }),
        new QueryObserver(client, { queryKey: doneKey, queryFn: () => doneLoad.promise }),
      ].map((w) => w.subscribe(() => undefined))
      await expect.poll(() => client.isFetching()).toBe(2)

      const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
      await expect.poll(() => summariesOf(client, unresolvedKey)).toEqual(['One, edited'])
      expect(summariesOf(client, doneKey)).toEqual(['Two', 'One, edited'])
      expect(client.isFetching()).toBe(0)

      // Settling refetches both phases, so let those loads answer.
      unresolvedLoad.resolve([])
      doneLoad.resolve([])
      request.resolve(null)
      await done
      for (const unsubscribe of watchers) unsubscribe()
    })

    it('an edit to an unresolved issue leaves the Done load running', async () => {
      const client = new QueryClient()
      client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
      const doneLoad = deferred<Issue[]>()
      const watcher = new QueryObserver(client, {
        queryKey: doneKey,
        queryFn: () => doneLoad.promise,
      }).subscribe(() => undefined)
      await expect.poll(() => client.getQueryState(doneKey)?.fetchStatus).toBe('fetching')
      const request = deferred<null>()
      const observer = new MutationObserver(
        client,
        summaryMutation(client, () => request.promise),
      )

      const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
      await expect.poll(() => summariesOf(client, unresolvedKey)).toEqual(['One, edited'])
      expect(client.getQueryState(doneKey)?.fetchStatus).toBe('fetching')

      request.resolve(null)
      // The unresolved phase refetched (nothing watches it here); the Done load was never restarted.
      await done
      expect(client.getQueryState(doneKey)?.isInvalidated).toBe(false)
      expect(client.getQueryState(doneKey)?.fetchStatus).toBe('fetching')
      doneLoad.resolve([])
      watcher()
    })

    it('refetches only the touched phases once the last edit settles', async () => {
      const client = new QueryClient()
      client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
      client.setQueryData<Issue[]>(doneKey, [issue('PSAPAC-2', 'Two')])
      const requests = { 'PSAPAC-1': deferred<null>(), 'PSAPAC-2': deferred<null>() }
      const send = ({ key }: { key: string }) => requests[key as keyof typeof requests].promise
      const first = new MutationObserver(client, summaryMutation(client, send))
      const second = new MutationObserver(client, summaryMutation(client, send))
      const stale = (key: readonly string[]) => client.getQueryState(key)?.isInvalidated

      const firstDone = first.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
      const secondDone = second.mutate({ key: 'PSAPAC-2', summary: 'Two, edited' })
      await expect.poll(() => summariesOf(client, doneKey)).toEqual(['Two, edited'])

      requests['PSAPAC-1'].resolve(null)
      await firstDone
      expect([stale(unresolvedKey), stale(doneKey)]).toEqual([false, false])

      requests['PSAPAC-2'].resolve(null)
      await secondDone
      expect([stale(unresolvedKey), stale(doneKey)]).toEqual([true, true])
    })

    it('leaves a phase alone when no edit touched it', async () => {
      const { client, observer, request } = phased()
      client.setQueryData<Issue[]>(doneKey, [issue('PSAPAC-2', 'Two')])
      const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
      request.resolve(null)
      await done
      expect(client.getQueryState(unresolvedKey)?.isInvalidated).toBe(true)
      expect(client.getQueryState(doneKey)?.isInvalidated).toBe(false)
    })

    it('puts the old summary back in every phase when Jira refuses', async () => {
      const { client, observer, request } = phased()
      const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
      await expect.poll(() => summariesOf(client, doneKey)).toEqual(['Two', 'One, edited'])
      request.reject(new JiraMgrError('jira_error', 'Jira is down.'))
      await expect(done).rejects.toBeInstanceOf(JiraMgrError)
      expect(summariesOf(client, unresolvedKey)).toEqual(['One'])
      expect(summariesOf(client, doneKey)).toEqual(['Two', 'One'])
    })
  })
})
