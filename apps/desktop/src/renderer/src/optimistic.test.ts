import { JiraMgrError, type Issue } from '@jira-mgr/core'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { issuesKey, summaryMutation } from './optimistic'

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
  client.setQueryData<Issue[]>(issuesKey, [issue('PSAPAC-1', 'One'), issue('PSAPAC-2', 'Two')])
  const request = deferred<null>()
  const observer = new MutationObserver(
    client,
    summaryMutation(client, () => request.promise),
  )
  const summaries = () => client.getQueryData<Issue[]>(issuesKey)?.map((i) => i.summary)
  return { client, observer, request, summaries }
}

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
    expect(client.getQueryState(issuesKey)?.isInvalidated).toBe(true)
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
    client.setQueryData<Issue[]>(issuesKey, (issues) =>
      issues?.map((i) => (i.key === 'PSAPAC-1' ? { ...i, summary: 'One, edited again' } : i)),
    )
    request.reject(new JiraMgrError('jira_error', 'Jira is down.'))
    await expect(done).rejects.toBeInstanceOf(JiraMgrError)
    expect(summaries()).toEqual(['One, edited again', 'Two'])
  })
})
