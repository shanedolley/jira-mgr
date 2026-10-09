import { JiraMgrError, type Issue } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  applyCreated,
  applyFreshIssue,
  deleteMutation,
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

describe('applyCreated', () => {
  it('puts the read-back into the list of its phase and the page cache, with no reload', () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    client.setQueryData<Issue[]>(doneKey, [])
    const fresh = detail(issue('PSAPAC-9', 'New'))

    applyCreated(client, { key: 'PSAPAC-9', issue: fresh, warning: null })

    expect(summariesOf(client, unresolvedKey)).toEqual(['One', 'New'])
    expect(summariesOf(client, doneKey)).toEqual([])
    expect(client.getQueryData(issueDetailKey('PSAPAC-9'))).toBe(fresh)
    expect(client.getQueryState(unresolvedKey)?.isInvalidated).toBe(false)
  })

  it('reloads the unresolved list when the read-back failed, since there is no issue to put', () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])

    applyCreated(client, { key: 'PSAPAC-9', issue: null, warning: 'Could not read.' })

    expect(summariesOf(client, unresolvedKey)).toEqual(['One'])
    expect(client.getQueryState(unresolvedKey)?.isInvalidated).toBe(true)
  })
})

/** The query keys `cancelQueries` is called with from now on. */
function spyCancelled(client: QueryClient): unknown[] {
  const cancelled: unknown[] = []
  const original = client.cancelQueries.bind(client)
  client.cancelQueries = (filters, options) => {
    cancelled.push(filters?.queryKey)
    return original(filters, options)
  }
  return cancelled
}

describe('deleteMutation', () => {
  const sub = (key: string, parent: string) =>
    issue(key, key, { parentKey: parent, issueType: { subtask: true } as Issue['issueType'] })

  function deleteSetup() {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [
      issue('PSAPAC-1', 'Epic'),
      issue('PSAPAC-2', 'Child', { parentKey: 'PSAPAC-1' }),
      issue('PSAPAC-3', 'Story'),
      sub('PSAPAC-4', 'PSAPAC-3'),
    ])
    client.setQueryData<Issue[]>(doneKey, [
      issue('PSAPAC-5', 'Finished', { parentKey: 'PSAPAC-1' }),
    ])
    const request = deferred<{ key: string; deletedSubtasks: string[] }>()
    const observer = new MutationObserver(
      client,
      deleteMutation(client, () => request.promise),
    )
    const keys = (list: readonly string[]) => client.getQueryData<Issue[]>(list)?.map((i) => i.key)
    return { client, observer, request, keys }
  }

  it('takes the issue out of the list before Jira answers', async () => {
    const { observer, request, keys } = deleteSetup()
    const done = observer.mutate({ key: 'PSAPAC-3', deleteSubtasks: false, subtasks: [] })
    await expect.poll(() => keys(unresolvedKey)).toEqual(['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-4'])
    request.resolve({ key: 'PSAPAC-3', deletedSubtasks: [] })
    await done
    expect(keys(unresolvedKey)).toEqual(['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-4'])
  })

  it('takes the subtasks the user chose out with it, from either list', async () => {
    const { observer, request, keys } = deleteSetup()
    const done = observer.mutate({
      key: 'PSAPAC-3',
      deleteSubtasks: true,
      subtasks: ['PSAPAC-4'],
    })
    await expect.poll(() => keys(unresolvedKey)).toEqual(['PSAPAC-1', 'PSAPAC-2'])
    request.resolve({ key: 'PSAPAC-3', deletedSubtasks: ['PSAPAC-4'] })
    await done
  })

  it('leaves a subtask in the list when the user did not choose to delete it', async () => {
    const { observer, request, keys } = deleteSetup()
    const done = observer.mutate({ key: 'PSAPAC-3', deleteSubtasks: false, subtasks: ['PSAPAC-4'] })
    await expect.poll(() => keys(unresolvedKey)).not.toContain('PSAPAC-3')
    expect(keys(unresolvedKey)).toContain('PSAPAC-4')
    request.resolve({ key: 'PSAPAC-3', deletedSubtasks: [] })
    await done
  })

  it('leaves the children of a deleted Epic without a parent, in both lists', async () => {
    const { client, observer, request } = deleteSetup()
    const done = observer.mutate({ key: 'PSAPAC-1', deleteSubtasks: false, subtasks: [] })
    await expect
      .poll(() => client.getQueryData<Issue[]>(unresolvedKey)?.map((i) => i.key))
      .not.toContain('PSAPAC-1')
    const parents = (list: readonly string[]) =>
      client.getQueryData<Issue[]>(list)?.map((i) => [i.key, i.parentKey])
    expect(parents(unresolvedKey)).toContainEqual(['PSAPAC-2', null])
    expect(parents(doneKey)).toEqual([['PSAPAC-5', null]])
    request.resolve({ key: 'PSAPAC-1', deletedSubtasks: [] })
    await done
  })

  it('puts everything back when Jira refuses', async () => {
    const { client, observer, request, keys } = deleteSetup()
    const done = observer.mutate({ key: 'PSAPAC-1', deleteSubtasks: false, subtasks: [] })
    await expect.poll(() => keys(unresolvedKey)).not.toContain('PSAPAC-1')
    request.reject(new JiraMgrError('permission_denied', 'Not allowed.'))
    await expect(done).rejects.toMatchObject({ code: 'permission_denied' })

    expect(keys(unresolvedKey)?.sort()).toEqual(['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-3', 'PSAPAC-4'])
    const parents = client.getQueryData<Issue[]>(doneKey)?.map((i) => i.parentKey)
    expect(parents).toEqual(['PSAPAC-1'])
    expect(
      client.getQueryData<Issue[]>(unresolvedKey)?.find((i) => i.key === 'PSAPAC-2')?.parentKey,
    ).toBe('PSAPAC-1')
  })

  it('puts a refused cascade back, subtasks included', async () => {
    const { observer, request, keys } = deleteSetup()
    const done = observer.mutate({ key: 'PSAPAC-3', deleteSubtasks: true, subtasks: ['PSAPAC-4'] })
    await expect.poll(() => keys(unresolvedKey)).toEqual(['PSAPAC-1', 'PSAPAC-2'])
    request.reject(new JiraMgrError('jira_error', 'Jira is down.'))
    await expect(done).rejects.toBeInstanceOf(JiraMgrError)
    expect(keys(unresolvedKey)?.sort()).toEqual(['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-3', 'PSAPAC-4'])
  })

  it('starts a phase still on its first load again once the delete succeeds', async () => {
    const { client, observer, request } = deleteSetup()
    client.removeQueries({ queryKey: doneKey })
    const load = vi.fn(() => new Promise<Issue[]>(() => undefined))
    const watcher = new QueryObserver(client, { queryKey: doneKey, queryFn: load }).subscribe(
      () => undefined,
    )
    await expect.poll(() => load.mock.calls.length).toBe(1)

    // PSAPAC-99 is in no loaded list, so the phase still loading may hold it.
    const cancelled = spyCancelled(client)
    const done = observer.mutate({ key: 'PSAPAC-99', deleteSubtasks: false, subtasks: [] })
    request.resolve({ key: 'PSAPAC-99', deletedSubtasks: [] })
    await done
    expect(cancelled).toContainEqual(doneKey)
    await expect.poll(() => load.mock.calls.length).toBe(2)
    watcher()
  })

  it('leaves a phase still loading alone when the issue was in a loaded list', async () => {
    const { client, observer, request } = deleteSetup()
    client.removeQueries({ queryKey: doneKey })
    const load = vi.fn(() => new Promise<Issue[]>(() => undefined))
    const watcher = new QueryObserver(client, { queryKey: doneKey, queryFn: load }).subscribe(
      () => undefined,
    )
    await expect.poll(() => load.mock.calls.length).toBe(1)

    const cancelled = spyCancelled(client)
    const done = observer.mutate({ key: 'PSAPAC-3', deleteSubtasks: false, subtasks: [] })
    request.resolve({ key: 'PSAPAC-3', deletedSubtasks: [] })
    await done
    expect(cancelled).not.toContainEqual(doneKey)
    expect(load).toHaveBeenCalledOnce()
    watcher()
  })

  it('leaves a phase alone that has data and only refetches in the background', async () => {
    const { client, observer, request } = deleteSetup()
    const load = vi.fn(() => new Promise<Issue[]>(() => undefined))
    const watcher = new QueryObserver(client, {
      queryKey: doneKey,
      queryFn: load,
      staleTime: 0,
    }).subscribe(() => undefined)
    await expect.poll(() => load.mock.calls.length).toBe(1)
    const cancelled = spyCancelled(client)

    const done = observer.mutate({ key: 'PSAPAC-99', deleteSubtasks: false, subtasks: [] })
    request.resolve({ key: 'PSAPAC-99', deletedSubtasks: [] })
    await done
    expect(cancelled).not.toContainEqual(doneKey)
    watcher()
  })

  it('does not reload a phase still loading when the delete fails', async () => {
    const { client, observer, request } = deleteSetup()
    client.removeQueries({ queryKey: doneKey })
    const load = vi.fn(() => new Promise<Issue[]>(() => undefined))
    const watcher = new QueryObserver(client, { queryKey: doneKey, queryFn: load }).subscribe(
      () => undefined,
    )
    await expect.poll(() => load.mock.calls.length).toBe(1)

    const done = observer.mutate({ key: 'PSAPAC-99', deleteSubtasks: false, subtasks: [] })
    request.reject(new JiraMgrError('jira_error', 'Down.'))
    await expect(done).rejects.toBeInstanceOf(JiraMgrError)
    expect(load).toHaveBeenCalledOnce()
    watcher()
  })

  it('does not cancel the list of a phase that holds none of the issues', async () => {
    const { client, observer, request } = deleteSetup()
    const cancelled: unknown[] = []
    const original = client.cancelQueries.bind(client)
    client.cancelQueries = (filters, options) => {
      cancelled.push(filters?.queryKey)
      return original(filters, options)
    }
    const done = observer.mutate({ key: 'PSAPAC-3', deleteSubtasks: false, subtasks: [] })
    request.resolve({ key: 'PSAPAC-3', deletedSubtasks: [] })
    await done
    expect(cancelled).toEqual([unresolvedKey])
  })
})

describe('issueMutation record', () => {
  function recording(cache: Issue[] = [issue('PSAPAC-1', 'One')]) {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, cache)
    const request = deferred<null>()
    const record = vi.fn()
    const { read } = reader({ 'PSAPAC-1': detail(issue('PSAPAC-1', 'One, edited')) })
    const observer = new MutationObserver(
      client,
      summaryMutation(client, () => request.promise, read, record),
    )
    return { observer, request, record }
  }

  it('hands an accepted edit its new and old fields', async () => {
    const { observer, request, record } = recording()
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    request.resolve(null)
    await done
    expect(record).toHaveBeenCalledExactlyOnceWith(
      { key: 'PSAPAC-1', summary: 'One, edited' },
      { patch: { summary: 'One, edited' }, before: { summary: 'One' } },
    )
  })

  it('records nothing for an edit Jira refused', async () => {
    const { observer, request, record } = recording()
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    request.reject(new JiraMgrError('validation_failed', 'No.'))
    await expect(done).rejects.toBeInstanceOf(JiraMgrError)
    expect(record).not.toHaveBeenCalled()
  })

  it('records nothing for an issue no cache holds, which has no old value to keep', async () => {
    const { observer, request, record } = recording([])
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    request.resolve(null)
    await done
    expect(record).not.toHaveBeenCalled()
  })
})

describe('a description edit', () => {
  const doc = (text: string) => ({
    version: 1 as const,
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })

  function describeSetup() {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    client.setQueryData<IssueDetail>(issueDetailKey('PSAPAC-1'), {
      ...detail(issue('PSAPAC-1', 'One')),
      description: doc('old'),
    })
    const request = deferred<null>()
    const { read } = reader({
      'PSAPAC-1': { ...detail(issue('PSAPAC-1', 'One')), description: doc('new') },
    })
    const observer = new MutationObserver(
      client,
      issueMutation<{ key: string; description: unknown }>(
        client,
        () => request.promise,
        ({ description }) => ({ description: description as IssueDetail['description'] }),
        read,
      ),
    )
    const descriptionOf = () =>
      client.getQueryData<IssueDetail>(issueDetailKey('PSAPAC-1'))?.description
    return { client, observer, request, descriptionOf }
  }

  it("patches the page's read and leaves the listed issues alone", async () => {
    const { client, observer, request, descriptionOf } = describeSetup()
    const done = observer.mutate({ key: 'PSAPAC-1', description: doc('new') })
    await expect.poll(descriptionOf).toEqual(doc('new'))
    const listed = client.getQueryData<Issue[]>(unresolvedKey)?.[0]
    expect(listed).not.toHaveProperty('description')
    request.resolve(null)
    await done
    expect(client.getQueryData<Issue[]>(unresolvedKey)?.[0]).not.toHaveProperty('description')
  })

  it('a refused description edit restores the previous description', async () => {
    const { client, request, descriptionOf } = describeSetup()
    const answer = deferred<IssueDetail>()
    const mutation = new MutationObserver(
      client,
      issueMutation<{ key: string; description: unknown }>(
        client,
        () => request.promise,
        ({ description }) => ({ description: description as IssueDetail['description'] }),
        () => answer.promise,
      ),
    )
    const done = mutation.mutate({ key: 'PSAPAC-1', description: doc('new') })
    await expect.poll(descriptionOf).toEqual(doc('new'))
    request.reject(new JiraMgrError('validation_failed', 'Jira refused the description.'))
    await expect.poll(descriptionOf).toEqual(doc('old'))
    answer.resolve({ ...detail(issue('PSAPAC-1', 'One')), description: doc('old') })
    await expect(done).rejects.toMatchObject({ code: 'validation_failed' })
    expect(descriptionOf()).toEqual(doc('old'))
  })
})
