import { JiraMgrError, type Issue } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'
import type { SprintReport } from '@jira-mgr/core/sprints'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { BatchItem, BatchOutcome } from '../../shared/ipc'

import {
  applyCreated,
  applyFreshIssue,
  applyUnaskedRead,
  batchMutation,
  current,
  deleteMutation,
  doneKey,
  isEditing,
  issueDetailKey,
  issueMutation,
  pendingFields,
  sprintKey,
  summaryMutation,
  type BatchRequestItem,
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
    timeSpentSeconds: null,
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

  it('shows the new summary on an open Sprint page, and puts the old one back on a refusal', async () => {
    const { client, observer, request, answers } = setup()
    answers['PSAPAC-1'] = detail(issue('PSAPAC-1', 'One'))
    client.setQueryData(['sprint', 7], {
      sprint: { id: 7 },
      issues: [issue('PSAPAC-1', 'One'), issue('PSAPAC-2', 'Two')],
      stats: {},
    })
    const names = () =>
      client.getQueryData<{ issues: Issue[] }>(['sprint', 7])?.issues.map((i) => i.summary)
    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    await expect.poll(names).toEqual(['One, edited', 'Two'])
    request.reject(new JiraMgrError('validation_failed', 'Jira refused the summary.'))
    await expect(done).rejects.toMatchObject({ code: 'validation_failed' })
    expect(names()).toEqual(['One', 'Two'])
  })

  it('edits and records an issue that only an open Sprint page holds', async () => {
    const client = new QueryClient()
    client.setQueryData(['sprint', 7], {
      sprint: { id: 7 },
      issues: [issue('PSAPAC-9', 'Nine')],
      stats: {},
    })
    const request = deferred<null>()
    const { read } = reader({ 'PSAPAC-9': detail(issue('PSAPAC-9', 'Nine, edited')) })
    const record = vi.fn()
    const observer = new MutationObserver(
      client,
      summaryMutation(client, () => request.promise, read, record),
    )
    const names = () =>
      client.getQueryData<{ issues: Issue[] }>(['sprint', 7])?.issues.map((i) => i.summary)
    const done = observer.mutate({ key: 'PSAPAC-9', summary: 'Nine, edited' })
    await expect.poll(names).toEqual(['Nine, edited'])
    request.resolve(null)
    await done
    expect(record).toHaveBeenCalledWith(
      { key: 'PSAPAC-9', summary: 'Nine, edited' },
      { patch: { summary: 'Nine, edited' }, before: { summary: 'Nine' } },
    )
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

  it('keeps an edit made while the edit before it reads the issue back', async () => {
    const { client, observer, request, summaries, read, answers } = setup()
    const stale = deferred<IssueDetail>()
    read.mockReturnValueOnce(stale.promise)
    const first = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    request.resolve(null)
    await expect.poll(() => read.mock.calls.length).toBe(1)

    // Cmd+Z lands before the first edit's read answers, and Jira has not answered the undo yet.
    const held = deferred<null>()
    const undo = new MutationObserver(
      client,
      summaryMutation(client, () => held.promise, read),
    )
    const undone = undo.mutate({ key: 'PSAPAC-1', summary: 'One' })
    await expect.poll(summaries).toEqual(['One', 'Two'])
    stale.resolve(detail(issue('PSAPAC-1', 'One, edited')))
    await first
    expect(summaries()).toEqual(['One', 'Two'])

    answers['PSAPAC-1'] = detail(issue('PSAPAC-1', 'One'))
    held.resolve(null)
    await undone
    expect(read).toHaveBeenCalledTimes(2)
    expect(summaries()).toEqual(['One', 'Two'])
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

  it('sends an edit of an issue only once Jira has answered the edit before it, even a refusal', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    const gates = [deferred<null>(), deferred<null>()]
    let answered = 0
    const sent: { labels: string[] | undefined; answered: number }[] = []
    const send = ({ patch }: Args) => {
      sent.push({ labels: patch.labels, answered })
      return gates[sent.length - 1]?.promise ?? Promise.resolve(null)
    }
    const { read } = reader({ 'PSAPAC-1': detail(issue('PSAPAC-1', 'One', { labels: ['b'] })) })
    const first = new MutationObserver(client, options(client, send, read))
    const second = new MutationObserver(client, options(client, send, read))
    const labels = () => client.getQueryData<Issue[]>(unresolvedKey)?.[0]?.labels

    const firstDone = first.mutate({ key: 'PSAPAC-1', patch: { labels: ['a'] } })
    const secondDone = second.mutate({ key: 'PSAPAC-1', patch: { labels: ['b'] } })
    await expect.poll(labels).toEqual(['b'])
    await expect.poll(() => sent.length).toBe(1)

    // The refusal leaves the later edit showing, and only then does that edit go out.
    answered = 1
    gates[0]?.reject(new JiraMgrError('validation_failed', 'Jira refused the labels.'))
    await expect(firstDone).rejects.toBeInstanceOf(JiraMgrError)
    expect(labels()).toEqual(['b'])
    await expect.poll(() => sent.length).toBe(2)
    expect(read).not.toHaveBeenCalled()

    gates[1]?.resolve(null)
    await secondDone
    expect(sent).toEqual([
      { labels: ['a'], answered: 0 },
      { labels: ['b'], answered: 1 },
    ])
    expect(read).toHaveBeenCalledOnce()
  })

  it('keeps the line when a queued edit throws before its turn', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    const gate = deferred<null>()
    let answered = false
    const sent: { labels: string[] | undefined; answered: boolean }[] = []
    const send = ({ patch }: Args) => {
      sent.push({ labels: patch.labels, answered })
      return sent.length === 1 ? gate.promise : Promise.resolve(null)
    }
    const { read } = reader({ 'PSAPAC-1': detail(issue('PSAPAC-1', 'One', { labels: ['c'] })) })
    const patchOf = ({ patch }: Args) => {
      if (patch.labels?.includes('bad') === true) throw new Error('No patch for this edit.')
      return patch
    }
    const observer = () => new MutationObserver(client, issueMutation(client, send, patchOf, read))

    const firstDone = observer().mutate({ key: 'PSAPAC-1', patch: { labels: ['a'] } })
    await expect.poll(() => sent.length).toBe(1)
    // The second edit throws in onMutate while the first is in flight, behind it in the line.
    await expect(
      observer().mutate({ key: 'PSAPAC-1', patch: { labels: ['bad'] } }),
    ).rejects.toThrow('No patch for this edit.')
    const thirdDone = observer().mutate({ key: 'PSAPAC-1', patch: { labels: ['c'] } })
    await expect.poll(() => client.getQueryData<Issue[]>(unresolvedKey)?.[0]?.labels).toEqual(['c'])
    expect(sent).toHaveLength(1)
    expect(read).not.toHaveBeenCalled()

    answered = true
    gate.resolve(null)
    await Promise.all([firstDone, thirdDone])
    expect(sent).toEqual([
      { labels: ['a'], answered: false },
      { labels: ['c'], answered: true },
    ])
    expect(read).toHaveBeenCalledOnce()
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
      subtasks: [{ key: 'PSAPAC-9', summary: 'Sub', status: 'To Do', done: false }],
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

describe('a Sprint page copy', () => {
  const report = (...issues: Issue[]): SprintReport =>
    ({ sprint: { id: 5 }, issues, stats: {} }) as unknown as SprintReport
  const sprintCopy = (client: QueryClient) =>
    client.getQueryData<SprintReport>([...sprintKey, 5])?.issues.map((i) => i.summary)

  it('shows an edit at once and takes it back when Jira refuses, even for an issue no list holds', async () => {
    const client = new QueryClient()
    client.setQueryData(unresolvedKey, [issue('PSAPAC-2', 'Two')])
    client.setQueryData(
      [...sprintKey, 5],
      report(issue('PSAPAC-1', 'One'), issue('PSAPAC-2', 'Two')),
    )
    const request = deferred<null>()
    const { read } = reader()
    const observer = new MutationObserver(
      client,
      summaryMutation(client, () => request.promise, read),
    )

    const done = observer.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    await expect.poll(() => sprintCopy(client)).toEqual(['One, edited', 'Two'])
    request.reject(new JiraMgrError('validation_failed', 'Jira refused the summary.'))
    await expect(done).rejects.toMatchObject({ code: 'validation_failed' })
    expect(sprintCopy(client)).toEqual(['One', 'Two'])
  })
})

describe('a move out of the sprint on a Sprint page copy', () => {
  const report = (...issues: Issue[]): SprintReport =>
    ({ sprint: { id: 5 }, issues, stats: {} }) as unknown as SprintReport
  const keys = (client: QueryClient) =>
    client.getQueryData<SprintReport>([...sprintKey, 5])?.issues.map((i) => i.key)
  const inSprint = (key: string) =>
    issue(key, key, { sprints: [{ id: 5, name: 'Sprint 5', state: 'active', endDate: null }] })

  function setup() {
    const client = new QueryClient()
    client.setQueryData([...sprintKey, 5], report(inSprint('PSAPAC-1'), inSprint('PSAPAC-2')))
    client.setQueryData([...sprintKey, 6], { ...report(), sprint: { id: 6 } })
    const request = deferred<null>()
    const { read } = reader()
    const observer = new MutationObserver(
      client,
      issueMutation(
        client,
        () => request.promise,
        ({ patch }: { key: string; patch: Partial<Issue> }) => patch,
        read,
      ),
    )
    return { client, request, observer }
  }

  it('takes the row off at once, whatever the issue lists, and puts it back when Jira refuses', async () => {
    const { client, request, observer } = setup()

    const done = observer.mutate({ key: 'PSAPAC-1', patch: { sprints: [] } })
    await expect.poll(() => keys(client)).toEqual(['PSAPAC-2'])
    request.reject(new JiraMgrError('validation_failed', 'Jira refused the move.'))
    await expect(done).rejects.toMatchObject({ code: 'validation_failed' })
    expect(keys(client)).toEqual(['PSAPAC-2', 'PSAPAC-1'])
    // As it was before the move, not as the move showed it.
    expect(
      client.getQueryData<SprintReport>([...sprintKey, 5])?.issues.at(-1)?.sprints,
    ).toHaveLength(1)
  })

  it('keeps the row when the patch still lists the sprint, and ignores edits that do not set sprints', async () => {
    const { client, request, observer } = setup()
    const patch = { sprints: inSprint('x').sprints }

    const done = observer.mutate({ key: 'PSAPAC-1', patch })
    await expect.poll(() => keys(client)).toEqual(['PSAPAC-1', 'PSAPAC-2'])
    request.resolve(null)
    await done
    await observer.mutate({ key: 'PSAPAC-2', patch: { summary: 'Two, edited' } })
    expect(keys(client)).toEqual(['PSAPAC-1', 'PSAPAC-2'])
  })
})

describe('a Sprint page read in flight', () => {
  it('is cancelled by an edit of an issue it holds, so it cannot bring back the old value', async () => {
    const client = new QueryClient()
    const queryKey = [...sprintKey, 5]
    const held = { sprint: { id: 5 }, issues: [issue('PSAPAC-1', 'One')], stats: {} }
    client.setQueryData(queryKey, held)
    const read = deferred<typeof held>()
    const observer = new QueryObserver(client, { queryKey, queryFn: () => read.promise })
    const stop = observer.subscribe(() => undefined)
    await client.invalidateQueries({ queryKey, refetchType: 'none' })
    void observer.refetch()
    await expect.poll(() => client.getQueryState(queryKey)?.fetchStatus).toBe('fetching')

    const edit = new MutationObserver(
      client,
      summaryMutation(client, () => deferred<null>().promise, reader().read),
    )
    void edit.mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    await expect.poll(() => client.getQueryState(queryKey)?.fetchStatus).toBe('idle')
    stop()
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
      subtasks: [{ key: 'PSAPAC-2', summary: 'Sub', status: 'To Do', done: false }],
    }
    applyFreshIssue(client, fresh)
    expect(client.getQueryData<Issue[]>(unresolvedKey)?.[0]).not.toHaveProperty('subtasks')
    expect(client.getQueryData<IssueDetail>(issueDetailKey('PSAPAC-1'))?.subtasks).toHaveLength(1)
  })
})

describe('applyUnaskedRead', () => {
  const options = (client: QueryClient, send: () => Promise<unknown>) =>
    issueMutation(
      client,
      send,
      () => ({ summary: 'Edited' }),
      () => Promise.resolve(detail(issue('PSAPAC-1', 'Edited'))),
    )

  it('puts the read into the caches when no edit of the issue is in flight', () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])

    applyUnaskedRead(client, detail(issue('PSAPAC-1', 'Read')))

    expect(summariesOf(client, unresolvedKey)).toEqual(['Read'])
  })

  it('leaves the optimistic value of an edit in flight alone, and takes reads again once it settles', async () => {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [issue('PSAPAC-1', 'One')])
    const request = deferred<null>()
    const edit = new MutationObserver(
      client,
      options(client, () => request.promise),
    )
    const done = edit.mutate({ key: 'PSAPAC-1' })
    await expect.poll(() => summariesOf(client, unresolvedKey)).toEqual(['Edited'])

    applyUnaskedRead(client, detail(issue('PSAPAC-1', 'Stale')))
    expect(summariesOf(client, unresolvedKey)).toEqual(['Edited'])
    expect(client.getQueryData(issueDetailKey('PSAPAC-1'))).toBeUndefined()

    request.resolve(null)
    await done
    applyUnaskedRead(client, detail(issue('PSAPAC-1', 'Later')))
    expect(summariesOf(client, unresolvedKey)).toEqual(['Later'])
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

const isEditingKey = (client: QueryClient, key: string) => isEditing(client, key)

describe('batchMutation', () => {
  const DONE = { id: '3', name: 'Done', category: 'done' } as const
  const TODO = { id: '1', name: 'To Do', category: 'new' } as const

  const toDone = (key: string): BatchRequestItem => ({
    key,
    id: `10${key.slice(-1)}`,
    change: { kind: 'status', statusId: DONE.id },
    patch: { status: DONE },
  })

  /** Three open issues in the list, and a reader that answers each as Jira would after the batch. */
  function setupBatch(answer: Record<string, Partial<Issue>> = {}) {
    const client = new QueryClient()
    client.setQueryData<Issue[]>(unresolvedKey, [
      issue('PSAPAC-1', 'One'),
      issue('PSAPAC-2', 'Two'),
      issue('PSAPAC-3', 'Three'),
    ])
    const { read } = reader(
      Object.fromEntries(
        ['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-3'].map((key) => [
          key,
          detail(issue(key, key, { status: TODO, ...answer[key] })),
        ]),
      ),
    )
    const statuses = () =>
      ['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-3'].map(
        (key) => `${key}:${current(client, key)?.status.name ?? 'gone'}`,
      )
    return { client, read, statuses }
  }

  it('shows every change before Jira answers, sends the items, and reports what changed', async () => {
    const { client, read, statuses } = setupBatch({
      'PSAPAC-1': { status: DONE },
      'PSAPAC-2': { status: DONE },
    })
    const request = deferred<BatchOutcome>()
    const send = vi.fn<(items: BatchItem[]) => Promise<BatchOutcome>>(() => request.promise)
    const record = vi.fn()
    const run = batchMutation(client, send, read, [toDone('PSAPAC-1'), toDone('PSAPAC-2')], record)
    await expect.poll(statuses).toEqual(['PSAPAC-1:Done', 'PSAPAC-2:Done', 'PSAPAC-3:To Do'])
    expect(send).toHaveBeenCalledExactlyOnceWith([
      { key: 'PSAPAC-1', id: '101', change: { kind: 'status', statusId: '3' } },
      { key: 'PSAPAC-2', id: '102', change: { kind: 'status', statusId: '3' } },
    ])
    request.resolve({ done: ['PSAPAC-1', 'PSAPAC-2'], refused: [] })

    const result = await run
    expect(result.refused).toEqual([])
    expect(result.done.map(({ key }) => key)).toEqual(['PSAPAC-1', 'PSAPAC-2'])
    expect(result.done[0]).toMatchObject({ patch: { status: DONE }, before: { status: TODO } })
    expect(record).toHaveBeenCalledExactlyOnceWith(result.done)
  })

  it('puts back only the issues Jira refused, and names each with its reason', async () => {
    const { client, read, statuses } = setupBatch({ 'PSAPAC-1': { status: DONE } })
    // The read-back fails, so what the caches show is the rollback's doing alone.
    read.mockRejectedValue(new Error('Jira is down.'))
    const run = batchMutation(
      client,
      () =>
        Promise.resolve({
          done: ['PSAPAC-1'],
          refused: [
            { key: 'PSAPAC-2', reason: 'No transition.' },
            { key: 'PSAPAC-3', reason: 'Jira skipped it.' },
          ],
        }),
      read,
      ['PSAPAC-1', 'PSAPAC-2', 'PSAPAC-3'].map(toDone),
    )
    const result = await run
    expect(result.refused).toEqual([
      { key: 'PSAPAC-2', reason: 'No transition.' },
      { key: 'PSAPAC-3', reason: 'Jira skipped it.' },
    ])
    expect(statuses()).toEqual(['PSAPAC-1:Done', 'PSAPAC-2:To Do', 'PSAPAC-3:To Do'])
  })

  it('refuses every issue and puts each back when the whole call fails', async () => {
    const { client, read, statuses } = setupBatch()
    read.mockRejectedValue(new Error('Jira is down.'))
    const record = vi.fn()
    const result = await batchMutation(
      client,
      () => Promise.reject(new JiraMgrError('validation_failed', 'Not in the project.')),
      read,
      ['PSAPAC-1', 'PSAPAC-2'].map(toDone),
      record,
    )
    expect(result.done).toEqual([])
    expect(result.refused.map(({ key, reason }) => [key, reason])).toEqual([
      ['PSAPAC-1', 'Not in the project.'],
      ['PSAPAC-2', 'Not in the project.'],
    ])
    expect(statuses()).toEqual(['PSAPAC-1:To Do', 'PSAPAC-2:To Do', 'PSAPAC-3:To Do'])
    expect(record).not.toHaveBeenCalled()
  })

  it('leaves a later edit of a refused issue alone', async () => {
    const { client, read, statuses } = setupBatch()
    // The read-back fails, so what the caches show is the rollback's doing alone.
    read.mockRejectedValue(new Error('Jira is down.'))
    const request = deferred<BatchOutcome>()
    const run = batchMutation(client, () => request.promise, read, [toDone('PSAPAC-1')])
    await expect.poll(statuses).toEqual(['PSAPAC-1:Done', 'PSAPAC-2:To Do', 'PSAPAC-3:To Do'])
    // Someone moves the issue on while the batch is out.
    const doing = { id: '2', name: 'In Progress', category: 'indeterminate' } as const
    client.setQueryData<Issue[]>(unresolvedKey, (issues) =>
      issues?.map((i) => (i.key === 'PSAPAC-1' ? { ...i, status: doing } : i)),
    )
    request.resolve({ done: [], refused: [{ key: 'PSAPAC-1', reason: 'No.' }] })
    await run
    expect(statuses()[0]).toBe('PSAPAC-1:In Progress')
  })

  it('reads each issue back afterwards and takes what Jira holds', async () => {
    const { client, read, statuses } = setupBatch({
      'PSAPAC-1': { status: { id: '2', name: 'In Progress', category: 'indeterminate' } },
    })
    await batchMutation(
      client,
      () => Promise.resolve({ done: ['PSAPAC-1', 'PSAPAC-2'], refused: [] }),
      read,
      ['PSAPAC-1', 'PSAPAC-2'].map(toDone),
    )
    expect(read.mock.calls.map(([key]) => key).sort()).toEqual(['PSAPAC-1', 'PSAPAC-2'])
    // Jira's own answers: a cascade made the first In Progress, and the second is back at To Do.
    expect(statuses()).toEqual(['PSAPAC-1:In Progress', 'PSAPAC-2:To Do', 'PSAPAC-3:To Do'])
  })

  it('refuses an issue no cache holds without sending it', async () => {
    const { client, read } = setupBatch()
    const send = vi.fn(() => Promise.resolve({ done: ['PSAPAC-1'], refused: [] }))
    const result = await batchMutation(client, send, read, ['PSAPAC-1', 'PSAPAC-9'].map(toDone))
    expect(send).toHaveBeenCalledExactlyOnceWith([
      { key: 'PSAPAC-1', id: '101', change: { kind: 'status', statusId: '3' } },
    ])
    expect(result.refused).toEqual([{ key: 'PSAPAC-9', reason: 'It is no longer loaded.' }])
  })

  it('waits for an earlier edit of an issue to settle before it sends, and holds the read until then', async () => {
    const { client, read } = setupBatch({ 'PSAPAC-1': { status: DONE } })
    const held = deferred<null>()
    const edit = new MutationObserver(
      client,
      issueMutation(
        client,
        () => held.promise,
        ({ patch }: { key: string; patch: Partial<Issue> }) => patch,
        read,
      ),
    )
    const editing = edit.mutate({ key: 'PSAPAC-1', patch: { summary: 'Edited' } })
    await expect
      .poll(() => client.getQueryData<Issue[]>(unresolvedKey)?.[0]?.summary)
      .toBe('Edited')

    const send = vi.fn(() => Promise.resolve({ done: ['PSAPAC-1'], refused: [] }))
    const run = batchMutation(client, send, read, [toDone('PSAPAC-1')])
    // The batch has not sent: the earlier edit has not been answered.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(send).not.toHaveBeenCalled()

    held.resolve(null)
    await editing
    await run
    expect(send).toHaveBeenCalledOnce()
    // Both settled: the issue is read once, after the last of them.
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('makes an edit made after it wait, and skips the read while that edit is in flight', async () => {
    const { client, read } = setupBatch({ 'PSAPAC-1': { status: DONE } })
    const request = deferred<BatchOutcome>()
    const run = batchMutation(client, () => request.promise, read, [toDone('PSAPAC-1')])
    await expect.poll(() => isEditingKey(client, 'PSAPAC-1')).toBe(true)

    const next = deferred<null>()
    const edit = new MutationObserver(
      client,
      issueMutation(
        client,
        () => next.promise,
        ({ patch }: { key: string; patch: Partial<Issue> }) => patch,
        read,
      ),
    )
    const editing = edit.mutate({ key: 'PSAPAC-1', patch: { summary: 'Later' } })
    request.resolve({ done: ['PSAPAC-1'], refused: [] })
    await run
    // The batch left its turn to the later edit and did not read over it.
    expect(read).not.toHaveBeenCalled()
    next.resolve(null)
    await editing
    expect(read).toHaveBeenCalledExactlyOnceWith('PSAPAC-1')
  })

  it('leaves every edit line when record throws, so the next edit of the issue still sends', async () => {
    const { client, read } = setupBatch()
    await expect(
      batchMutation(
        client,
        () => Promise.resolve({ done: ['PSAPAC-1'], refused: [] }),
        read,
        [toDone('PSAPAC-1')],
        () => {
          throw new Error('record failed')
        },
      ),
    ).rejects.toThrow('record failed')
    expect(isEditingKey(client, 'PSAPAC-1')).toBe(false)

    const edit = new MutationObserver(
      client,
      issueMutation(
        client,
        () => Promise.resolve(null),
        ({ patch }: { key: string; patch: Partial<Issue> }) => patch,
        read,
      ),
    )
    await edit.mutate({ key: 'PSAPAC-1', patch: { summary: 'After' } })
    expect(current(client, 'PSAPAC-1')?.summary).toBe('PSAPAC-1')
  })

  it('treats a repeated key as one issue instead of waiting on its own turn', async () => {
    const { client, read, statuses } = setupBatch({ 'PSAPAC-1': { status: DONE } })
    const send = vi.fn<(items: BatchItem[]) => Promise<BatchOutcome>>(() =>
      Promise.resolve({ done: ['PSAPAC-1'], refused: [] }),
    )
    const run = await batchMutation(client, send, read, [toDone('PSAPAC-1'), toDone('PSAPAC-1')])
    expect(send).toHaveBeenCalledExactlyOnceWith([
      { key: 'PSAPAC-1', id: '101', change: { kind: 'status', statusId: '3' } },
    ])
    expect(run.done).toHaveLength(1)
    expect(statuses()[0]).toBe('PSAPAC-1:Done')
    expect(isEditingKey(client, 'PSAPAC-1')).toBe(false)
  })

  it('does not let its late read-back overwrite a newer edit of the issue', async () => {
    const { client, read } = setupBatch()
    const stale = deferred<IssueDetail>()
    read.mockReturnValueOnce(stale.promise)
    const run = batchMutation(
      client,
      () => Promise.resolve({ done: ['PSAPAC-1'], refused: [] }),
      read,
      [toDone('PSAPAC-1')],
    )
    await expect.poll(() => read.mock.calls.length).toBe(1)

    // A newer edit of the issue starts while the batch's read is out, and is shown at once.
    const held = deferred<null>()
    const edit = new MutationObserver(
      client,
      issueMutation(
        client,
        () => held.promise,
        ({ patch }: { key: string; patch: Partial<Issue> }) => patch,
        read,
      ),
    )
    const editing = edit.mutate({ key: 'PSAPAC-1', patch: { summary: 'Newer' } })
    await expect.poll(() => current(client, 'PSAPAC-1')?.summary).toBe('Newer')

    stale.resolve(detail(issue('PSAPAC-1', 'Old, from the batch read', { status: DONE })))
    await run
    expect(current(client, 'PSAPAC-1')?.summary).toBe('Newer')

    held.resolve(null)
    await editing
  })

  it('reads at most five issues at once', async () => {
    const client = new QueryClient()
    const keys = Array.from({ length: 12 }, (_, n) => `PSAPAC-${String(n + 1)}`)
    client.setQueryData<Issue[]>(
      unresolvedKey,
      keys.map((key) => issue(key, key)),
    )
    let running = 0
    let peak = 0
    const read = vi.fn(async (key: string) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return detail(issue(key, key))
    })
    await batchMutation(
      client,
      () => Promise.resolve({ done: keys, refused: [] }),
      read,
      keys.map(toDone),
    )
    expect(read).toHaveBeenCalledTimes(12)
    expect(peak).toBeLessThanOrEqual(5)
  })
})

describe('pendingFields', () => {
  it('names the fields an edit of the issue has changed on screen', () => {
    expect(
      pendingFields('P-1', { key: 'P-1', changes: {}, patch: { priority: null, labels: [] } }),
    ).toEqual(['priority', 'labels'])
    expect(pendingFields('P-1', { key: 'P-1', summary: 'New' })).toEqual(['summary'])
  })

  it('names none for another issue, a create, a delete or nothing', () => {
    expect(pendingFields('P-1', { key: 'P-2', patch: { priority: null } })).toEqual([])
    expect(pendingFields('P-1', { type: 'Story', summary: 'New' })).toEqual([])
    expect(pendingFields('P-1', { key: 'P-1', deleteSubtasks: false, subtasks: [] })).toEqual([])
    expect(pendingFields('P-1', undefined)).toEqual([])
  })
})
