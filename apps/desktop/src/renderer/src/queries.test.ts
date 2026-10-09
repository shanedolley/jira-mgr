import { JiraMgrError, type Issue } from '@jira-mgr/core'
import { CancelledError, QueryClient, MutationObserver, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { Toggles } from '../../shared/ipc'
import { doneKey, unresolvedKey } from './optimistic'
import {
  clearAccountData,
  createLoadTracker,
  customersKey,
  doneQuery,
  loginMutation,
  logoutMutation,
  meKey,
  sessionKey,
  togglesKey,
  togglesMutation,
  unresolvedQuery,
} from './queries'

const login = {
  siteUrl: 'https://x.test',
  projectKey: 'P',
  email: 'me@example.com',
  token: 'secret',
}
const state = {
  loggedIn: true,
  session: { siteUrl: login.siteUrl, projectKey: 'P', email: login.email },
} as const

describe('loginMutation', () => {
  it('stores the session it gets back', async () => {
    const client = new QueryClient()
    await new MutationObserver(
      client,
      loginMutation(client, () => Promise.resolve(state)),
    ).mutate(login)
    expect(client.getQueryData(sessionKey)).toEqual(state)
  })

  it('drops the mutation, and the token in its variables, once nothing observes it', async () => {
    const client = new QueryClient()
    const observer = new MutationObserver(
      client,
      loginMutation(client, () => Promise.resolve(state)),
    )
    const unsubscribe = observer.subscribe(() => undefined)
    await observer.mutate(login)
    expect(client.getMutationCache().getAll()).toHaveLength(1)

    unsubscribe()
    await expect.poll(() => client.getMutationCache().getAll()).toHaveLength(0)
  })
})

const issue = (key: string, status = 'To Do') => ({ key, status: { name: status } }) as Issue
const keysOf = (issues: Issue[] | undefined) => issues?.map((i) => i.key).sort()

describe('doneQuery', () => {
  it('waits for the unresolved phase', async () => {
    const client = new QueryClient()
    const load = vi.fn(() => Promise.resolve([issue('PSAPAC-9', 'Done')]))
    const observer = new QueryObserver(client, doneQuery(false, load))
    const unsubscribe = observer.subscribe(() => undefined)
    await Promise.resolve()
    expect(load).not.toHaveBeenCalled()

    observer.setOptions(doneQuery(true, load))
    await expect.poll(() => client.getQueryData(doneKey)).toBeDefined()
    expect(load).toHaveBeenCalledWith('done')
    unsubscribe()
  })
})

describe('unresolvedQuery', () => {
  it('copies an issue that left the unresolved set into Done, then invalidates Done', async () => {
    const client = new QueryClient()
    client.setQueryData(unresolvedKey, [issue('PSAPAC-1'), issue('PSAPAC-2', 'In Progress')])
    client.setQueryData(doneKey, [issue('PSAPAC-3', 'Done')])

    // PSAPAC-2 was resolved since the last load, so the new unresolved set lacks it.
    await client.query(unresolvedQuery(client, () => Promise.resolve([issue('PSAPAC-1')])))

    const done = client.getQueryData<Issue[]>(doneKey)
    expect(keysOf(done)).toEqual(['PSAPAC-2', 'PSAPAC-3'])
    // The copy keeps the status it was last loaded with, until Done reloads.
    expect(done?.find((i) => i.key === 'PSAPAC-2')?.status.name).toBe('In Progress')
    expect(client.getQueryState(doneKey)?.isInvalidated).toBe(true)
  })

  it('leaves Done alone while it holds no data', async () => {
    const client = new QueryClient()
    client.setQueryData(unresolvedKey, [issue('PSAPAC-1'), issue('PSAPAC-2')])

    await client.query(unresolvedQuery(client, () => Promise.resolve([issue('PSAPAC-1')])))

    expect(client.getQueryData(doneKey)).toBeUndefined()
  })

  it('does nothing when no issue left', async () => {
    const client = new QueryClient()
    client.setQueryData(unresolvedKey, [issue('PSAPAC-1')])
    client.setQueryData(doneKey, [issue('PSAPAC-3', 'Done')])

    await client.query(unresolvedQuery(client, () => Promise.resolve([issue('PSAPAC-1')])))

    expect(client.getQueryState(doneKey)?.isInvalidated).toBe(false)
  })
})

describe('createLoadTracker', () => {
  it('ignores progress from another load id', () => {
    const tracker = createLoadTracker()
    const first = tracker.begin('done')
    const second = tracker.begin('done')
    tracker.report({ phase: 'done', loadId: second, loaded: 300 })
    // The superseded load reports late and must not set the count back.
    tracker.report({ phase: 'done', loadId: first, loaded: 100 })
    expect(tracker.loaded('done')).toBe(300)
  })

  it('counts each phase on its own and starts again from 0', () => {
    const tracker = createLoadTracker()
    const unresolved = tracker.begin('unresolved')
    tracker.report({ phase: 'unresolved', loadId: unresolved, loaded: 700 })
    const done = tracker.begin('done')
    tracker.report({ phase: 'done', loadId: done, loaded: 200 })
    expect([tracker.loaded('unresolved'), tracker.loaded('done')]).toEqual([700, 200])

    tracker.begin('done')
    expect(tracker.loaded('done')).toBe(0)
    expect(tracker.loaded('unresolved')).toBe(700)
  })

  it('tells subscribers when the count changes', () => {
    const tracker = createLoadTracker()
    const listener = vi.fn()
    const unsubscribe = tracker.subscribe(listener)
    const id = tracker.begin('done')
    tracker.report({ phase: 'done', loadId: id, loaded: 100 })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    tracker.report({ phase: 'done', loadId: id, loaded: 200 })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('togglesMutation', () => {
  const stored: Toggles = { hideDone: true, assigneeMe: false, hideEmptyCustomers: true }
  const pressed: Toggles = { ...stored, assigneeMe: true }

  it('shows the toggle at once, before the write answers', async () => {
    const client = new QueryClient()
    client.setQueryData(togglesKey, stored)
    let finish!: () => void
    const write = new Promise<Toggles>((resolve) => {
      finish = () => {
        resolve(pressed)
      }
    })
    const done = new MutationObserver(
      client,
      togglesMutation(client, () => write),
    ).mutate(pressed)
    await expect.poll(() => client.getQueryData(togglesKey)).toEqual(pressed)
    finish()
    await done
  })

  it('a failed toggle write refetches the toggles', async () => {
    const client = new QueryClient()
    client.setQueryData(togglesKey, stored)
    // The file still holds `stored`, since the write failed.
    const read = vi.fn(() => Promise.resolve(stored))
    const observer = new QueryObserver(client, {
      queryKey: togglesKey,
      queryFn: read,
      staleTime: Infinity,
    })
    const unsubscribe = observer.subscribe(() => undefined)

    const failing = new MutationObserver(
      client,
      togglesMutation(client, () => Promise.reject(new JiraMgrError('internal', 'Disk full.'))),
    )
    await expect(failing.mutate(pressed)).rejects.toBeInstanceOf(JiraMgrError)

    expect(read).toHaveBeenCalled()
    await expect.poll(() => client.getQueryData(togglesKey)).toEqual(stored)
    unsubscribe()
  })
})

describe('clearAccountData', () => {
  it('logout removes the issues, me and customers queries', () => {
    const client = new QueryClient()
    client.setQueryData(unresolvedKey, [issue('PSAPAC-1')])
    client.setQueryData(doneKey, [issue('PSAPAC-2', 'Done')])
    client.setQueryData(meKey, { accountId: 'u1', displayName: 'Me' })
    client.setQueryData(customersKey, [])
    client.setQueryData(togglesKey, { hideDone: true, assigneeMe: false, hideEmptyCustomers: true })

    clearAccountData(client)

    expect(client.getQueryData(unresolvedKey)).toBeUndefined()
    expect(client.getQueryData(doneKey)).toBeUndefined()
    expect(client.getQueryData(meKey)).toBeUndefined()
    expect(client.getQueryData(customersKey)).toBeUndefined()
    // The toggles live in the settings file, not with the account.
    expect(client.getQueryData(togglesKey)).toBeDefined()
  })
})

describe('logoutMutation', () => {
  it('a failed logout leaves the issue queries idle, not fetching', async () => {
    const client = new QueryClient()
    let load!: { reject: (reason: unknown) => void }
    const watcher = new QueryObserver(client, {
      queryKey: unresolvedKey,
      queryFn: () =>
        new Promise<Issue[]>((_resolve, reject) => {
          load = { reject }
        }),
    }).subscribe(() => undefined)
    await expect.poll(() => client.getQueryState(unresolvedKey)?.fetchStatus).toBe('fetching')

    // Main aborts the load and answers it with null, which the renderer ends silently. Then the
    // logout itself fails.
    const failing = new MutationObserver(
      client,
      logoutMutation(client, () => {
        load.reject(new CancelledError({ silent: true }))
        return Promise.reject(new JiraMgrError('internal', 'Keychain locked.'))
      }),
    )
    await expect(failing.mutate()).rejects.toBeInstanceOf(JiraMgrError)

    await expect.poll(() => client.getQueryState(unresolvedKey)?.fetchStatus).toBe('idle')
    watcher()
  })

  it('removes the account data once the logout succeeds', async () => {
    const client = new QueryClient()
    client.setQueryData(unresolvedKey, [issue('PSAPAC-1')])
    const state = { loggedIn: false, prefill: {} } as const

    await new MutationObserver(
      client,
      logoutMutation(client, () => Promise.resolve(state)),
    ).mutate()

    expect(client.getQueryData(unresolvedKey)).toBeUndefined()
    expect(client.getQueryData(sessionKey)).toEqual(state)
  })
})
