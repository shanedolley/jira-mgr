import { QueryClient, MutationObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { loginMutation, sessionKey } from './queries'

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
