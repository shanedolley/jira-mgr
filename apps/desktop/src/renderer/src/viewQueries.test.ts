import { JiraMgrError } from '@jira-mgr/core'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { SavedView } from '../../shared/ipc'
import {
  createViewMutation,
  deleteViewMutation,
  duplicateViewMutation,
  moveViewMutation,
  renameViewMutation,
  updateViewMutation,
  viewsKey,
} from './viewQueries'

const TOGGLES = { hideDone: true, assigneeMe: false, hideEmptyCustomers: true }
const view = (id: string, name = id): SavedView => ({ id, name, filters: {}, toggles: TOGGLES })
const stored = [view('a', 'Alpha'), view('b', 'Beta'), view('c', 'Gamma')]

/** A client whose cache holds `views` and whose refetch reads `file`, as `views:list` reads the file. */
function setup(file: () => SavedView[] = () => stored, gate?: Promise<void>) {
  const client = new QueryClient()
  client.setQueryData(viewsKey, stored)
  // A refetch waits on `gate` when a test holds one, so it can look at the cache before the file is read.
  const read = vi.fn(async () => {
    await gate
    return file()
  })
  const observer = new QueryObserver(client, { queryKey: viewsKey, queryFn: read })
  const unsubscribe = observer.subscribe(() => undefined)
  return { client, read, unsubscribe }
}
const cached = (client: QueryClient) => client.getQueryData<SavedView[]>(viewsKey)
const refusal = () => new JiraMgrError('validation_failed', 'A view named "Beta" already exists.')

/** A call that stays open until the test settles it. */
function held<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('renameViewMutation', () => {
  it('shows the new name at once, before the write answers', async () => {
    const { client, unsubscribe } = setup()
    const write = held<SavedView>()
    const done = new MutationObserver(
      client,
      renameViewMutation(client, () => write.promise),
    ).mutate({ id: 'b', name: ' Bravo ' })
    await expect.poll(() => cached(client)?.map((v) => v.name)).toEqual(['Alpha', 'Bravo', 'Gamma'])
    write.resolve(view('b', 'Bravo'))
    await done
    unsubscribe()
  })

  it('puts the old name back when the write is refused, and reads the file again', async () => {
    const { client, read, unsubscribe } = setup()
    const failing = new MutationObserver(
      client,
      renameViewMutation(client, () => Promise.reject(refusal())),
    )
    await expect(failing.mutate({ id: 'a', name: 'Beta' })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    expect(cached(client)).toEqual(stored)
    await expect.poll(() => read.mock.calls.length).toBeGreaterThan(1)
    unsubscribe()
  })

  it('does not undo a later edit when an earlier one fails', async () => {
    // The file holds the second rename once it is sent: main writes in call order, and reads after it.
    const file = [...stored]
    const refetch = held<undefined>()
    const { client, read, unsubscribe } = setup(() => file, refetch.promise)
    const first = held<SavedView>()
    const second = held<SavedView>()
    let sent = 0
    const options = renameViewMutation(client, () => {
      sent += 1
      if (sent === 1) return first.promise
      file[1] = view('b', 'Two')
      return second.promise
    })
    const one = new MutationObserver(client, options).mutate({ id: 'a', name: 'One' })
    one.catch(() => undefined)
    await expect.poll(() => cached(client)?.map((v) => v.name)).toEqual(['One', 'Beta', 'Gamma'])
    const two = new MutationObserver(client, options).mutate({ id: 'b', name: 'Two' })
    await expect.poll(() => cached(client)?.map((v) => v.name)).toEqual(['One', 'Two', 'Gamma'])

    const reads = read.mock.calls.length
    first.reject(refusal())
    // The refetch is the step after the rollback, and it waits: Alpha is back, the second rename stays.
    await expect.poll(() => read.mock.calls.length).toBeGreaterThan(reads)
    await expect.poll(() => cached(client)?.map((v) => v.name)).toEqual(['Alpha', 'Two', 'Gamma'])
    refetch.resolve(undefined)
    await expect(one).rejects.toBeInstanceOf(JiraMgrError)
    second.resolve(view('b', 'Two'))
    await two
    unsubscribe()
  })
})

describe('renaming one view twice', () => {
  it('a failed first rename leaves the second rename of the same view alone', async () => {
    const file = [...stored]
    const refetch = held<undefined>()
    const { client, read, unsubscribe } = setup(() => file, refetch.promise)
    const first = held<SavedView>()
    let sent = 0
    const options = renameViewMutation(client, () => {
      sent += 1
      if (sent === 1) return first.promise
      file[0] = view('a', 'Second')
      return Promise.resolve(view('a', 'Second'))
    })
    const one = new MutationObserver(client, options).mutate({ id: 'a', name: 'First' })
    one.catch(() => undefined)
    await expect.poll(() => cached(client)?.[0]?.name).toBe('First')
    const two = new MutationObserver(client, options).mutate({ id: 'a', name: 'Second' })
    await expect.poll(() => sent).toBe(2)

    const reads = read.mock.calls.length
    first.reject(refusal())
    await expect.poll(() => read.mock.calls.length).toBeGreaterThan(reads)
    expect(cached(client)?.[0]?.name).toBe('Second')
    refetch.resolve(undefined)
    await expect(one).rejects.toBeInstanceOf(JiraMgrError)
    await two
    unsubscribe()
  })
})

describe('deleteViewMutation', () => {
  it('removes the view at once, before the write answers', async () => {
    const { client, unsubscribe } = setup()
    const write = held<null>()
    const done = new MutationObserver(
      client,
      deleteViewMutation(client, () => write.promise),
    ).mutate({ id: 'b' })
    await expect.poll(() => cached(client)?.map((v) => v.id)).toEqual(['a', 'c'])
    write.resolve(null)
    await done
    unsubscribe()
  })

  it('brings the view back, in its place, when the delete fails', async () => {
    const refetch = held<undefined>()
    const { client, read, unsubscribe } = setup(() => stored, refetch.promise)
    const failing = new MutationObserver(
      client,
      deleteViewMutation(client, () => Promise.reject(new JiraMgrError('internal', 'Disk full.'))),
    )
    const result = failing.mutate({ id: 'b' })
    result.catch(() => undefined)
    // The rollback comes before the refetch, which waits here, so the cache shows the rollback alone.
    await expect.poll(() => read.mock.calls.length).toBeGreaterThan(1)
    expect(cached(client)?.map((v) => v.id)).toEqual(['a', 'b', 'c'])
    refetch.resolve(undefined)
    await expect(result).rejects.toMatchObject({ code: 'internal' })
    unsubscribe()
  })

  it('does not add the view twice when a refetch already brought it back', async () => {
    const refetch = held<undefined>()
    const { client, read, unsubscribe } = setup(() => stored, refetch.promise)
    const write = held<null>()
    const done = new MutationObserver(
      client,
      deleteViewMutation(client, () => write.promise),
    ).mutate({ id: 'b' })
    done.catch(() => undefined)
    await expect.poll(() => cached(client)?.map((v) => v.id)).toEqual(['a', 'c'])
    client.setQueryData(viewsKey, stored)

    const reads = read.mock.calls.length
    write.reject(new JiraMgrError('internal', 'Disk full.'))
    await expect.poll(() => read.mock.calls.length).toBeGreaterThan(reads)
    expect(cached(client)?.map((v) => v.id)).toEqual(['a', 'b', 'c'])
    refetch.resolve(undefined)
    await expect(done).rejects.toMatchObject({ code: 'internal' })
    unsubscribe()
  })

  it('shows what the file holds once the delete settles', async () => {
    const file = [...stored]
    const { client, unsubscribe } = setup(() => file)
    await new MutationObserver(
      client,
      deleteViewMutation(client, () => {
        file.splice(1, 1)
        return Promise.resolve(null)
      }),
    ).mutate({ id: 'b' })
    await expect.poll(() => cached(client)?.map((v) => v.id)).toEqual(['a', 'c'])
    unsubscribe()
  })
})

describe('createViewMutation', () => {
  const args = { name: 'Delta', filters: {}, toggles: TOGGLES }

  it('adds the view only once the write answers, without waiting for the refetch', async () => {
    const refetch = held<undefined>()
    const { client, read, unsubscribe } = setup(
      () => [...stored, view('d', 'Delta')],
      refetch.promise,
    )
    const write = held<SavedView>()
    const done = new MutationObserver(
      client,
      createViewMutation(client, () => write.promise),
    ).mutate(args)
    expect(cached(client)).toEqual(stored)
    const reads = read.mock.calls.length
    write.resolve(view('d', 'Delta'))
    await expect.poll(() => read.mock.calls.length).toBeGreaterThan(reads)
    // The refetch is still waiting, so the new row comes from the answer to the write.
    expect(cached(client)?.map((v) => v.id)).toEqual(['a', 'b', 'c', 'd'])
    refetch.resolve(undefined)
    await done
    unsubscribe()
  })

  it('does not show the view twice when a refetch lands before the answer', async () => {
    const refetch = held<undefined>()
    const withDelta = [...stored, view('d', 'Delta')]
    const { client, read, unsubscribe } = setup(() => withDelta, refetch.promise)
    const write = held<SavedView>()
    const done = new MutationObserver(
      client,
      createViewMutation(client, () => write.promise),
    ).mutate(args)
    // The file already holds the view, and a refetch reads it before the write's answer arrives.
    client.setQueryData(viewsKey, withDelta)
    const reads = read.mock.calls.length
    write.resolve(view('d', 'Delta'))
    await expect.poll(() => read.mock.calls.length).toBeGreaterThan(reads)
    expect(cached(client)?.map((v) => v.id)).toEqual(['a', 'b', 'c', 'd'])
    refetch.resolve(undefined)
    await done
    unsubscribe()
  })

  it('leaves the list alone when the write is refused', async () => {
    const { client, unsubscribe } = setup()
    const failing = new MutationObserver(
      client,
      createViewMutation(client, () => Promise.reject(refusal())),
    )
    await expect(failing.mutate(args)).rejects.toMatchObject({ code: 'validation_failed' })
    expect(cached(client)).toEqual(stored)
    unsubscribe()
  })
})

describe('moveViewMutation', () => {
  it('shows the new order at once, before the write answers', async () => {
    const { client, unsubscribe } = setup()
    const write = held<SavedView[]>()
    const done = new MutationObserver(
      client,
      moveViewMutation(client, () => write.promise),
    ).mutate({ id: 'a', toIndex: 2 })
    await expect.poll(() => cached(client)?.map((v) => v.id)).toEqual(['b', 'c', 'a'])
    write.resolve([stored[1], stored[2], stored[0]] as SavedView[])
    await done
    unsubscribe()
  })

  it('puts the old order back when the write is refused', async () => {
    const { client, read, unsubscribe } = setup()
    const failing = new MutationObserver(
      client,
      moveViewMutation(client, () => Promise.reject(refusal())),
    )
    await expect(failing.mutate({ id: 'a', toIndex: 2 })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    expect(cached(client)).toEqual(stored)
    await expect.poll(() => read.mock.calls.length).toBeGreaterThan(0)
    unsubscribe()
  })
})

describe('updateViewMutation', () => {
  const args = { id: 'b', filters: { type: ['Bug'] }, toggles: TOGGLES }

  it('shows the new filters once the write answers, without waiting for the refetch', async () => {
    const updated = { ...view('b', 'Beta'), filters: { type: ['Bug'] } }
    const gate = held<undefined>()
    const { client, unsubscribe } = setup(
      () => [stored[0], updated, stored[2]] as SavedView[],
      gate.promise,
    )
    const done = new MutationObserver(
      client,
      updateViewMutation(client, () => Promise.resolve(updated)),
    ).mutate(args)
    await expect.poll(() => cached(client)?.[1]).toEqual(updated)
    gate.resolve(undefined)
    await done
    unsubscribe()
  })

  it('leaves the list alone when the write is refused', async () => {
    const { client, unsubscribe } = setup()
    const failing = new MutationObserver(
      client,
      updateViewMutation(client, () => Promise.reject(refusal())),
    )
    await expect(failing.mutate(args)).rejects.toMatchObject({ code: 'validation_failed' })
    expect(cached(client)).toEqual(stored)
    unsubscribe()
  })
})

describe('duplicateViewMutation', () => {
  it('reads the file again to place the copy', async () => {
    const copy = view('b-copy', 'Beta copy')
    const file = [stored[0], stored[1], copy, stored[2]] as SavedView[]
    const { client, unsubscribe } = setup(() => file)
    await new MutationObserver(
      client,
      duplicateViewMutation(client, () => Promise.resolve(copy)),
    ).mutate({
      id: 'b',
    })
    await expect.poll(() => cached(client)?.map((v) => v.id)).toEqual(['a', 'b', 'b-copy', 'c'])
    unsubscribe()
  })
})
