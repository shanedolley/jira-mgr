import { JiraMgrError, type Issue } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  applyFreshIssue,
  doneKey,
  issueDetailKey,
  issueMutation,
  summaryMutation,
  unresolvedKey,
} from './optimistic'

function issue(key: string, summary: string, extra: Partial<Issue> = {}): Issue {
  return {
    key,
    summary,
    status: { id: '1', name: 'To Do', category: 'new' },
    assignee: null,
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null,
    ...extra,
  } as Issue
}

const detail = (base: Issue): IssueDetail => ({ ...base, description: null, subtasks: [] })

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

/** A read of one issue that answers with whatever the test has set, and counts its calls. */
function reader(answers: Record<string, IssueDetail> = {}) {
  const read = vi.fn((key: string) => {
    const answer = answers[key]
    return answer === undefined
      ? Promise.reject(new JiraMgrError('not_found', 'No such issue.'))
      : Promise.resolve(answer)
  })
  return { read, answers }
}

const summariesOf = (client: QueryClient, key: readonly string[]) =>
  client.getQueryData<Issue[]>(key)?.map((i) => i.summary)

function setup() {
  const client = new QueryClient()
  client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One'), issue('PSAPAC-2', 'Two')])
  const request = deferred<null>()
  const { read, answers } = reader({
    'PSAPAC-1': detail(issue('PSAPAC-1', 'One, edited')),
  })
  const observer = new MutationObserver(
    client,
    summaryMutation(client, () => request.promise, read),
  )
  const summaries = () => summariesOf(client, unresolvedKey)
  return { client, observer, request, summaries, read, answers }
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

  it('reads the edited issue after a save, and no list', async () => {
    const { client, observer, request, read } = setup()
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    request.resolve(null)
    await done
    expect(read).toHaveBeenCalledExactlyOnceWith('PSAPAC-1')
    expect(client.getQueryState(unresolvedKey)?.isInvalidated).toBe(false)
  })

  it('takes what Jira holds after the save, not the optimistic text', async () => {
    const { observer, request, summaries, answers } = setup()
    answers['PSAPAC-1'] = detail(issue('PSAPAC-1', 'One, as Jira saved it'))
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    request.resolve(null)
    await done
    expect(summaries()).toEqual(['One, as Jira saved it', 'Two'])
  })

  it('puts the old summary back when Jira refuses, passes the error on, and reads the issue', async () => {
    const { observer, request, summaries, read, answers } = setup()
    answers['PSAPAC-1'] = detail(issue('PSAPAC-1', 'One'))
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    await expect.poll(summaries).toEqual(['One, edited', 'Two'])
    request.reject(new JiraMgrError('validation_failed', 'Jira refused the summary.'))
    await expect(done).rejects.toMatchObject({ code: 'validation_failed' })
    expect(summaries()).toEqual(['One', 'Two'])
    expect(read).toHaveBeenCalledOnce()
  })

  it('leaves a later edit alone when an earlier one fails', async () => {
    const { client, observer, request, summaries, read } = setup()
    // Held, so the lists show what the rollback left before Jira's answer replaces it.
    const answer = deferred<IssueDetail>()
    read.mockReturnValueOnce(answer.promise)
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    await expect.poll(summaries).toEqual(['One, edited', 'Two'])
    // A second edit of the same issue lands while the first is in flight.
    client.setQueryData<Issue[]>(unresolvedKey, (issues) =>
      issues?.map((i) => (i.key === 'PSAPAC-1' ? { ...i, summary: 'One, edited again' } : i)),
    )
    request.reject(new JiraMgrError('jira_error', 'Jira is down.'))
    await expect.poll(() => read.mock.calls.length).toBe(1)
    expect(summaries()).toEqual(['One, edited again', 'Two'])
    answer.resolve(detail(issue('PSAPAC-1', 'One, edited again')))
    await expect(done).rejects.toBeInstanceOf(JiraMgrError)
  })
})

describe('issueMutation', () => {
  interface Args {
    key: string
    patch: Partial<Issue>
  }
  const options = (
    client: QueryClient,
    send: (args: Args) => Promise<unknown>,
    read: (key: string) => Promise<IssueDetail>,
  ) => issueMutation(client, send, ({ patch }) => patch, read)

  it('puts back only the fields the failed edit changed', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    const assign = deferred<null>()
    const move = deferred<null>()
    const { read, answers } = reader()
    const first = new MutationObserver(
      client,
      options(client, () => assign.promise, read),
    )
    const second = new MutationObserver(
      client,
      options(client, () => move.promise, read),
    )
    const person = { accountId: 'u1', displayName: 'Ann', avatarUrl: null }

    const assigning = first.mutate({ key: 'PSAPAC-1', patch: { assignee: person } })
    const moving = second.mutate({
      key: 'PSAPAC-1',
      patch: { status: { id: '2', name: 'In Progress', category: 'indeterminate' } },
    })
    const shown = () => client.getQueryData<Issue[]>(unresolvedKey)?.[0]
    await expect.poll(() => shown()?.status.name).toBe('In Progress')
    expect(shown()?.assignee?.accountId).toBe('u1')

    // The assignment is refused while the status move is still in flight.
    assign.reject(new JiraMgrError('validation_failed', 'Cannot assign.'))
    await expect(assigning).rejects.toBeInstanceOf(JiraMgrError)
    expect(shown()?.assignee).toBeNull()
    expect(shown()?.status.name).toBe('In Progress')

    answers['PSAPAC-1'] = detail(
      issue('PSAPAC-1', 'One', {
        status: { id: '2', name: 'In Progress', category: 'indeterminate' },
      }),
    )
    move.resolve(null)
    await moving
  })

  it('reads the issue once, after the last of its edits settles', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    const gates = [deferred<null>(), deferred<null>()]
    let next = 0
    const send = () => gates[next++]?.promise ?? Promise.resolve(null)
    const { read } = reader({ 'PSAPAC-1': detail(issue('PSAPAC-1', 'One')) })
    // Each hook render builds its own options, so the edits must be counted per client.
    const first = new MutationObserver(client, options(client, send, read))
    const second = new MutationObserver(client, options(client, send, read))

    const firstDone = first.mutate({ key: 'PSAPAC-1', patch: { labels: ['a'] } })
    const secondDone = second.mutate({ key: 'PSAPAC-1', patch: { labels: ['a', 'b'] } })
    await expect
      .poll(() => client.getQueryData<Issue[]>(unresolvedKey)?.[0]?.labels)
      .toEqual(['a', 'b'])

    // The first settles while the second is in flight: a read now would bring back the old labels.
    gates[0]?.resolve(null)
    await firstDone
    expect(read).not.toHaveBeenCalled()

    gates[1]?.resolve(null)
    await secondDone
    expect(read).toHaveBeenCalledExactlyOnceWith('PSAPAC-1')
  })

  it('reads each issue as its own last edit settles, whatever the others are doing', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [
      issue('PSAPAC-1', 'One'),
      issue('PSAPAC-2', 'Two'),
    ])
    const gates = { 'PSAPAC-1': deferred<null>(), 'PSAPAC-2': deferred<null>() }
    const send = ({ key }: Args) => gates[key as keyof typeof gates].promise
    const { read } = reader({
      'PSAPAC-1': detail(issue('PSAPAC-1', 'One')),
      'PSAPAC-2': detail(issue('PSAPAC-2', 'Two')),
    })
    const first = new MutationObserver(client, options(client, send, read))
    const second = new MutationObserver(client, options(client, send, read))

    const firstDone = first.mutate({ key: 'PSAPAC-1', patch: { labels: ['a'] } })
    const secondDone = second.mutate({ key: 'PSAPAC-2', patch: { labels: ['b'] } })
    await expect.poll(() => client.getQueryData<Issue[]>(unresolvedKey)?.[1]?.labels).toEqual(['b'])

    gates['PSAPAC-1'].resolve(null)
    await firstDone
    expect(read).toHaveBeenCalledExactlyOnceWith('PSAPAC-1')

    gates['PSAPAC-2'].resolve(null)
    await secondDone
    expect(read).toHaveBeenLastCalledWith('PSAPAC-2')
  })

  it('reads once when two edits of one issue settle in the same tick', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    const gate = deferred<null>()
    const { read } = reader({ 'PSAPAC-1': detail(issue('PSAPAC-1', 'One')) })
    const first = new MutationObserver(
      client,
      options(client, () => gate.promise, read),
    )
    const second = new MutationObserver(
      client,
      options(client, () => gate.promise, read),
    )

    const firstDone = first.mutate({ key: 'PSAPAC-1', patch: { labels: ['a'] } })
    const secondDone = second.mutate({ key: 'PSAPAC-1', patch: { labels: ['b'] } })
    await expect.poll(() => client.getQueryData<Issue[]>(unresolvedKey)?.[0]?.labels).toEqual(['b'])

    gate.resolve(null)
    await Promise.all([firstDone, secondDone])
    expect(read).toHaveBeenCalledOnce()
  })

  it("takes Jira's cascade from the read, such as a remaining estimate", async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [
      issue('PSAPAC-1', 'One', { originalEstimateSeconds: 3600, remainingEstimateSeconds: 3600 }),
    ])
    const request = deferred<null>()
    const { read } = reader({
      'PSAPAC-1': detail(
        issue('PSAPAC-1', 'One', { originalEstimateSeconds: 7200, remainingEstimateSeconds: 7200 }),
      ),
    })
    const observer = new MutationObserver(
      client,
      options(client, () => request.promise, read),
    )

    const done = observer.mutate({ key: 'PSAPAC-1', patch: { originalEstimateSeconds: 7200 } })
    const shown = () => client.getQueryData<Issue[]>(unresolvedKey)?.[0]
    await expect.poll(() => shown()?.originalEstimateSeconds).toBe(7200)
    // Only the original estimate is guessed; the remaining estimate waits for Jira.
    expect(shown()?.remainingEstimateSeconds).toBe(3600)

    request.resolve(null)
    await done
    expect(shown()?.remainingEstimateSeconds).toBe(7200)
  })

  it("patches the page's own read of the issue too, and keeps its description", async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    client.setQueryData<IssueDetail>(issueDetailKey('PSAPAC-1'), {
      ...detail(issue('PSAPAC-1', 'One')),
      subtasks: [{ key: 'PSAPAC-9', summary: 'Sub', status: 'To Do' }],
    })
    const request = deferred<null>()
    const { read } = reader({ 'PSAPAC-1': detail(issue('PSAPAC-1', 'One', { labels: ['a'] })) })
    const observer = new MutationObserver(
      client,
      options(client, () => request.promise, read),
    )

    const done = observer.mutate({ key: 'PSAPAC-1', patch: { labels: ['a'] } })
    await expect
      .poll(() => client.getQueryData<IssueDetail>(issueDetailKey('PSAPAC-1'))?.labels)
      .toEqual(['a'])
    expect(client.getQueryData<IssueDetail>(issueDetailKey('PSAPAC-1'))?.subtasks).toHaveLength(1)
    request.resolve(null)
    await done
  })

  it('falls back to reloading the lists that hold the issue when the read fails', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    client.setQueryData<Issue[]>(doneKey, [issue('PSAPAC-2', 'Two')])
    const request = deferred<null>()
    const { read } = reader()
    const observer = new MutationObserver(
      client,
      options(client, () => request.promise, read),
    )
    const done = observer.mutate({ key: 'PSAPAC-1', patch: { labels: ['a'] } })
    request.resolve(null)
    await done
    expect(client.getQueryState(unresolvedKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(doneKey)?.isInvalidated).toBe(false)
  })

  describe('across phases', () => {
    it('patches and cancels every phase that holds the issue', async () => {
      const client = new QueryClient()
      client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
      client.setQueryData<Issue[]>(doneKey, [issue('PSAPAC-2', 'Two'), issue('PSAPAC-1', 'One')])
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
      const request = deferred<null>()
      const { read } = reader({ 'PSAPAC-1': detail(issue('PSAPAC-1', 'One, edited')) })
      const observer = new MutationObserver(
        client,
        summaryMutation(client, () => request.promise, read),
      )

      const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
      await expect.poll(() => summariesOf(client, unresolvedKey)).toEqual(['One, edited'])
      expect(summariesOf(client, doneKey)).toEqual(['Two', 'One, edited'])
      expect(client.isFetching()).toBe(0)

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
      const { read } = reader({ 'PSAPAC-1': detail(issue('PSAPAC-1', 'One, edited')) })
      const observer = new MutationObserver(
        client,
        summaryMutation(client, () => request.promise, read),
      )

      const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
      await expect.poll(() => summariesOf(client, unresolvedKey)).toEqual(['One, edited'])
      expect(client.getQueryState(doneKey)?.fetchStatus).toBe('fetching')

      request.resolve(null)
      await done
      expect(client.getQueryState(doneKey)?.isInvalidated).toBe(false)
      expect(client.getQueryState(doneKey)?.fetchStatus).toBe('fetching')
      doneLoad.resolve([])
      watcher()
    })

    it('moves an issue resolved by the edit from the unresolved phase to Done, reloading neither', async () => {
      const client = new QueryClient()
      client.setQueryData<Issue[]>(unresolvedKey, [
        issue('PSAPAC-1', 'One'),
        issue('PSAPAC-2', 'Two'),
      ])
      client.setQueryData<Issue[]>(doneKey, [issue('PSAPAC-3', 'Three')])
      const request = deferred<null>()
      const finished = issue('PSAPAC-1', 'One', {
        status: { id: '3', name: 'Done', category: 'done' },
      })
      const { read } = reader({ 'PSAPAC-1': detail(finished) })
      const observer = new MutationObserver(
        client,
        options(client, () => request.promise, read),
      )

      const done = observer.mutate({
        key: 'PSAPAC-1',
        patch: { status: { id: '3', name: 'Done', category: 'done' } },
      })
      request.resolve(null)
      await done

      expect(summariesOf(client, unresolvedKey)).toEqual(['Two'])
      expect(summariesOf(client, doneKey)).toEqual(['Three', 'One'])
      expect(client.getQueryState(unresolvedKey)?.isInvalidated).toBe(false)
      expect(client.getQueryState(doneKey)?.isInvalidated).toBe(false)
    })

    it('puts the old value back in every phase when Jira refuses', async () => {
      const client = new QueryClient()
      client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
      client.setQueryData<Issue[]>(doneKey, [issue('PSAPAC-2', 'Two'), issue('PSAPAC-1', 'One')])
      const request = deferred<null>()
      // The read fails, so the lists show what the rollback left.
      const { read } = reader()
      const observer = new MutationObserver(
        client,
        summaryMutation(client, () => request.promise, read),
      )
      const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
      await expect.poll(() => summariesOf(client, doneKey)).toEqual(['Two', 'One, edited'])
      request.reject(new JiraMgrError('jira_error', 'Jira is down.'))
      await expect(done).rejects.toBeInstanceOf(JiraMgrError)
      expect(summariesOf(client, unresolvedKey)).toEqual(['One'])
      expect(summariesOf(client, doneKey)).toEqual(['Two', 'One'])
    })
  })
})

describe('applyFreshIssue', () => {
  it('starts the Done load again when an issue reaches Done while that phase is still loading', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    const load = vi.fn(() => new Promise<Issue[]>(() => undefined))
    const watcher = new QueryObserver(client, { queryKey: doneKey, queryFn: load }).subscribe(
      () => undefined,
    )
    await expect.poll(() => load.mock.calls.length).toBe(1)

    applyFreshIssue(
      client,
      detail(issue('PSAPAC-1', 'One', { status: { id: '3', name: 'Done', category: 'done' } })),
    )

    expect(summariesOf(client, unresolvedKey)).toEqual([])
    await expect.poll(() => load.mock.calls.length).toBe(2)
    watcher()
  })

  it('keeps the description and subtasks out of the lists and in the page read', () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    const fresh: IssueDetail = {
      ...detail(issue('PSAPAC-1', 'One')),
      subtasks: [{ key: 'PSAPAC-2', summary: 'Sub', status: 'To Do' }],
    }
    applyFreshIssue(client, fresh)
    expect(client.getQueryData<Issue[]>(unresolvedKey)?.[0]).not.toHaveProperty('subtasks')
    expect(client.getQueryData<IssueDetail>(issueDetailKey('PSAPAC-1'))?.subtasks).toHaveLength(1)
  })
})
