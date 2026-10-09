import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'

import { bridgeWindowFocus } from './focus'
import { createQueryClient } from './queryClient'

let client: QueryClient | undefined
afterEach(() => {
  client?.unmount()
  client?.clear()
})

/** Mounts a client whose focus follows the returned `emit`, with one query counting its fetches. */
function setup() {
  let emit: (focused: boolean) => void = () => undefined
  // The same shape as window.jm.onWindowFocus: subscribe, get an unsubscribe function back.
  bridgeWindowFocus((listener) => {
    emit = listener
    return () => undefined
  })
  client = createQueryClient()
  client.mount()
  const state = { fetches: 0 }
  const observer = new QueryObserver(client, {
    queryKey: ['probe'],
    queryFn: () => ++state.fetches,
  })
  const unsubscribe = observer.subscribe(() => undefined)
  return {
    emit: (focused: boolean) => {
      emit(focused)
    },
    state,
    unsubscribe,
  }
}

describe('bridgeWindowFocus', () => {
  it('refetches a mounted query when the Electron window regains focus', async () => {
    const { emit, state, unsubscribe } = setup()
    await expect.poll(() => state.fetches).toBe(1)

    emit(false)
    emit(true)
    await expect.poll(() => state.fetches).toBe(2)
    unsubscribe()
  })

  it('does not refetch while the window stays unfocused', async () => {
    const { emit, state, unsubscribe } = setup()
    await expect.poll(() => state.fetches).toBe(1)

    emit(false)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(state.fetches).toBe(1)
    unsubscribe()
  })
})
