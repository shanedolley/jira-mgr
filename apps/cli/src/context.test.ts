import { describe, expect, it } from 'vitest'

import { readLimited } from './context.js'

/** An endless stream of 1 KiB chunks that counts how many were pulled. */
function endless() {
  const pulled = { chunks: 0 }
  async function* chunks() {
    for (;;) {
      await Promise.resolve()
      pulled.chunks++
      yield Buffer.alloc(1024, 'a')
    }
  }
  return { pulled, chunks: chunks() }
}

describe('readLimited', () => {
  it('stops pulling once past the limit and returns one byte more than it', async () => {
    const { pulled, chunks } = endless()
    const text = await readLimited(chunks, 2500)
    expect(Buffer.byteLength(text)).toBe(2501)
    expect(pulled.chunks).toBe(3)
  })

  it('returns all of a stream within the limit', async () => {
    async function* small() {
      await Promise.resolve()
      yield Buffer.from('hello ')
      yield Buffer.from('world')
    }
    expect(await readLimited(small(), 11)).toBe('hello world')
  })

  it('returns exactly the limit when the stream is that long', async () => {
    async function* exact() {
      await Promise.resolve()
      yield Buffer.from('abcd')
    }
    expect(Buffer.byteLength(await readLimited(exact(), 4))).toBe(4)
  })
})
